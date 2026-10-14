// 会话生命周期闭环测试（停用/改密/单会话三项缺口修复）：
// 1) 停用即时生效——admin disable 后存量会话立刻 401、login_log 全标终态、启用后可再登录；
// 2) 门禁纵深——只改 disabled 位不删会话（绕过端点直写库）门禁回查也拦得住；
// 3) 改密即吊销——reset-password 后旧会话 401、旧密码 401、新密码可登录；
// 4) 单会话策略——新登录踢旧：第一个 sid 401、第二个 200，login_log 旧行标终态新行存活；
// 5) SSE 看门狗——停用后在途流被掐断（下游 end + 上游 abort），不等任务跑完。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { hashPw, login, request, startBff, startMockGateway, type BffHandle, type MockGateway } from "./helpers.ts";

const openBff: BffHandle[] = [];
const openGw: MockGateway[] = [];

afterEach(async () => {
  for (const h of openBff.splice(0)) await h.close();
  for (const g of openGw.splice(0)) await g.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 5000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(15);
  }
}

/** 标准 fixture：boss（管理员）+ zhang（普通用户），返回 boss 的 cookie。 */
async function setup(): Promise<{ bff: BffHandle; boss: string }> {
  const bff = await startBff();
  openBff.push(bff);
  bff.store.upsertUser("boss", hashPw("pw-boss-12345"), { isAdmin: true });
  bff.store.upsertUser("zhang", hashPw("pw-zhang-12345"));
  const boss = (await login(bff.port, "boss", "pw-boss-12345")).sid!;
  return { bff, boss };
}

test("停用即时生效：存量会话立刻 401、sessions 行已删、login_log 全标终态；启用后可再登录", async () => {
  const { bff, boss } = await setup();
  const sid = (await login(bff.port, "zhang", "pw-zhang-12345")).sid!;
  assert.equal((await request(bff.port, "GET", "/api/me", { cookie: `sid=${sid}` })).status, 200, "停用前正常");

  const disable = await request(bff.port, "POST", "/api/admin/users/zhang/disable", { cookie: `sid=${boss}` });
  assert.equal(disable.status, 200);
  assert.equal((await request(bff.port, "GET", "/api/me", { cookie: `sid=${sid}` })).status, 401, "停用后存量会话立即失效（不再撑到 7 天过期）");
  assert.equal(bff.store.findSession(sid), undefined, "sessions 行已删");
  assert.ok(bff.store.listLogins("zhang", 10).every((r) => r.logout_at !== null), "login_log 全部标终态");

  await request(bff.port, "POST", "/api/admin/users/zhang/enable", { cookie: `sid=${boss}` });
  assert.equal((await login(bff.port, "zhang", "pw-zhang-12345")).status, 200, "启用后恢复登录");
});

test("门禁纵深：只改 disabled 位不删会话（绕过端点直写库）也拦得住", async () => {
  const { bff } = await setup();
  const sid = (await login(bff.port, "zhang", "pw-zhang-12345")).sid!;
  bff.store.setDisabled("zhang", true); // 只改位、不动 sessions——门禁每请求回查必须兜住
  assert.equal((await request(bff.port, "GET", "/api/me", { cookie: `sid=${sid}` })).status, 401);
});

test("改密即吊销：重置密码后旧会话 401、旧密码 401、新密码可登录", async () => {
  const { bff, boss } = await setup();
  const sid = (await login(bff.port, "zhang", "pw-zhang-12345")).sid!;
  const reset = await request(bff.port, "POST", "/api/admin/users/zhang/reset-password", {
    cookie: `sid=${boss}`,
    body: { password: "pw-new-123456" },
  });
  assert.equal(reset.status, 200);
  assert.equal((await request(bff.port, "GET", "/api/me", { cookie: `sid=${sid}` })).status, 401, "旧会话立即失效（旧 cookie 照用的缺口已堵）");
  assert.equal((await login(bff.port, "zhang", "pw-zhang-12345")).status, 401, "旧密码 401");
  assert.equal((await login(bff.port, "zhang", "pw-new-123456")).status, 200, "新密码可登录");
});

test("单会话策略：新登录踢旧——第一个 sid 401、第二个 200；login_log 旧行标终态、新行存活", async () => {
  const { bff } = await setup();
  const sid1 = (await login(bff.port, "zhang", "pw-zhang-12345")).sid!;
  const sid2 = (await login(bff.port, "zhang", "pw-zhang-12345")).sid!;
  assert.notEqual(sid1, sid2);
  assert.equal((await request(bff.port, "GET", "/api/me", { cookie: `sid=${sid1}` })).status, 401, "旧会话被顶替（防一号多人）");
  assert.equal((await request(bff.port, "GET", "/api/me", { cookie: `sid=${sid2}` })).status, 200, "新会话存活");
  const rows = bff.store.listLogins("zhang", 10); // 新到旧
  assert.equal(rows.length, 2);
  assert.ok(rows[0].logout_at === null, "最新登录存活");
  assert.ok(rows[1].logout_at !== null, "被顶替登录已标终态");
});

test("SSE 看门狗：停用后在途流被掐断（下游 end + 上游 abort），不等任务跑完", async () => {
  let upstreamClosed = false;
  const gw = await startMockGateway((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`id: 1\nevent: stage\ndata: {"stage":"analyzing"}\n\n`);
    req.on("close", () => (upstreamClosed = true)); // BFF abort 后 mock 侧连接关闭
    // 永不主动关流（模拟进行中的长任务）
  });
  openGw.push(gw);
  const bff = await startBff({ gatewayUrl: gw.url, sseWatchdogMs: 100 });
  openBff.push(bff);
  bff.store.upsertUser("boss", hashPw("pw-boss-12345"), { isAdmin: true });
  bff.store.upsertUser("zhang", hashPw("pw-zhang-12345"));
  const boss = (await login(bff.port, "boss", "pw-boss-12345")).sid!;
  const sid = (await login(bff.port, "zhang", "pw-zhang-12345")).sid!;

  const chunks: Buffer[] = [];
  let clientEnded = false;
  const status = await new Promise<number>((resolve, reject) => {
    const rq = http.get(
      { host: "127.0.0.1", port: bff.port, path: "/api/tasks/run-wd-1/events", headers: { cookie: `sid=${sid}` } },
      (res) => {
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => (clientEnded = true));
        resolve(res.statusCode ?? 0);
      },
    );
    rq.on("error", reject);
  });
  assert.equal(status, 200);
  await waitFor(() => chunks.length > 0, 3000, "首帧到达（流已建立）");

  const disable = await request(bff.port, "POST", "/api/admin/users/zhang/disable", { cookie: `sid=${boss}` });
  assert.equal(disable.status, 200);
  await waitFor(() => clientEnded, 3000, "下游流被掐断");
  await waitFor(() => upstreamClosed, 3000, "上游连接被销毁");

  // 断流后浏览器 EventSource 会自动重连（同 cookie）——重连请求必须拿到 401 JSON 而非
  // 事件流（useTaskStream 的 CLOSED 分支：BFF 非 200 → 关流走 status 兜底 → 401 → 弹回登录）。
  const reconnect = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const rq = http.get(
      { host: "127.0.0.1", port: bff.port, path: "/api/tasks/run-wd-1/events", headers: { cookie: `sid=${sid}` } },
      (res) => {
        const cs: Buffer[] = [];
        res.on("data", (c: Buffer) => cs.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(cs).toString("utf8") }));
      },
    );
    rq.on("error", reject);
  });
  assert.equal(reconnect.status, 401, "重连被门禁拒绝");
  assert.deepEqual(JSON.parse(reconnect.body), { error: { code: "UNAUTHORIZED", message: "login required" } });
});

// ── 并发与事务边界（登录写前复核 + tx 成组写）──────────────────────────────────────

test("两账号并发登录互不干扰；同账号并发登录恰好存活一个会话（后到整体顶替先到）", async () => {
  const { bff } = await setup();
  bff.store.upsertUser("li", hashPw("pw-li-123456"));

  const [a1, a2, b1] = await Promise.all([
    login(bff.port, "zhang", "pw-zhang-12345"),
    login(bff.port, "zhang", "pw-zhang-12345"),
    login(bff.port, "li", "pw-li-123456"),
  ]);
  assert.equal(a1.status, 200);
  assert.equal(a2.status, 200);
  assert.equal(b1.status, 200);

  // 不同账号互不干扰
  assert.equal((await request(bff.port, "GET", "/api/me", { cookie: `sid=${b1.sid}` })).status, 200);
  // 同账号：同步写块串行，后到者整体顶替——sessions 恰好 1 行，两个 sid 恰好一个活
  assert.equal(bff.db.prepare("SELECT COUNT(*) c FROM sessions WHERE username = 'zhang'").get().c, 1);
  const r1 = await request(bff.port, "GET", "/api/me", { cookie: `sid=${a1.sid}` });
  const r2 = await request(bff.port, "GET", "/api/me", { cookie: `sid=${a2.sid}` });
  assert.equal([r1, r2].filter((r) => r.status === 200).length, 1, "两个并发会话恰好一个存活（单会话不变量）");
});

test("登录 × 停用并发：await compare 期间被停用 → 写前复核拒绝（401 同形），无残留会话", async () => {
  const { bff, boss } = await setup();

  // 同时发起：disable 走快速路径（无 bcrypt），login 的 compare 需上百 ms——停用先落地，
  // 登录写前复核（app.ts）必须看到 disabled=1 而拒绝。
  const [disableRes, loginRes] = await Promise.all([
    request(bff.port, "POST", "/api/admin/users/zhang/disable", { cookie: `sid=${boss}` }),
    login(bff.port, "zhang", "pw-zhang-12345"),
  ]);
  assert.equal(disableRes.status, 200);
  assert.equal(loginRes.status, 401, "竞态窗口内被停用的登录必须被写前复核拒绝");
  assert.ok(!loginRes.sid, "不种 cookie");
  assert.equal(
    bff.db.prepare("SELECT COUNT(*) c FROM sessions WHERE username = 'zhang'").get().c,
    0,
    "无残留会话行",
  );
  assert.ok(
    bff.store.listLogins("zhang", 10).every((r) => r.logout_at !== null),
    "login_log 无谎报存活行",
  );
});

test("登录 × 改密并发：无论交错序，旧密码拿到的会话必死、旧密码重登 401、新密码可登录", async () => {
  const { bff, boss } = await setup();

  // 两者各带一次 bcrypt（hash vs compare），交错序不定——断言终态不变量而非顺序：
  // 1) 登录先完成 → 改密事务随后删其会话；2) 改密先完成 → 登录写前复核发现 hash 已变 → 401。
  const [, loginRes] = await Promise.all([
    request(bff.port, "POST", "/api/admin/users/zhang/reset-password", {
      cookie: `sid=${boss}`,
      body: { password: "pw-new-123456" },
    }),
    login(bff.port, "zhang", "pw-zhang-12345"),
  ]);

  if (loginRes.status === 200 && loginRes.sid) {
    assert.equal(
      (await request(bff.port, "GET", "/api/me", { cookie: `sid=${loginRes.sid}` })).status,
      401,
      "旧凭据竞态拿到的会话必须已死（改密事务吊销）",
    );
  } else {
    assert.equal(loginRes.status, 401, "被复核拒绝时必须 401 同形");
  }
  assert.equal((await login(bff.port, "zhang", "pw-zhang-12345")).status, 401, "旧密码重登 401");
  assert.equal((await login(bff.port, "zhang", "pw-new-123456")).status, 200, "新密码可登录");
});
