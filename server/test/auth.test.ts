// UI-T2 集成测试：账号与会话 —— spec §3（内置账号表/bcrypt/httpOnly cookie/服务端可吊销
// sessions/登录慢响应+限速）+ §4（/api/me、/api/sessions CRUD 仅限本人）。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { login, request, startBff, type BffHandle } from "./helpers.ts";

const openHandles: BffHandle[] = [];

afterEach(async () => {
  for (const h of openHandles.splice(0)) await h.close();
});

async function bff(): Promise<BffHandle> {
  const h = await startBff();
  openHandles.push(h);
  return h;
}

test("登录成功：httpOnly+SameSite=Lax cookie、sessions 表登记（7 天）、/api/me 返回 username", async () => {
  const app = await bff();
  app.store.upsertUser("zhang", (await import("bcryptjs")).hashSync("correct-horse-9", 10));

  const res = await login(app.port, "zhang", "correct-horse-9");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { username: "zhang" });

  const setCookies = (res.headers["set-cookie"] ?? []) as string[];
  assert.ok(setCookies.some((c) => /sid=[0-9a-f]{32}/.test(c)), "sid 为 128bit 随机 hex");
  assert.ok(setCookies.some((c) => c.includes("HttpOnly")), "cookie HttpOnly");
  assert.ok(setCookies.some((c) => c.includes("SameSite=Lax")), "cookie SameSite=Lax");

  const sid = res.sid!;
  const sess = app.store.findSession(sid);
  assert.ok(sess, "sessions 表已登记");
  assert.equal(sess!.username, "zhang");
  const ttl = sess!.expires_at - Date.now();
  assert.ok(ttl > 6.9 * 86400_000 && ttl < 7.1 * 86400_000, `7 天过期（实际 ${(ttl / 3600_000).toFixed(1)}h）`);

  const me = await request(app.port, "GET", "/api/me", { cookie: `sid=${sid}` });
  assert.equal(me.status, 200);
  assert.deepEqual(me.body, { username: "zhang" });
});

test("登录失败：错密码/未知用户统一 401 封闭集，响应 ≥400ms（防爆破计时），不种 cookie", async () => {
  const app = await bff();
  app.store.upsertUser("zhang", (await import("bcryptjs")).hashSync("correct-horse-9", 10));

  for (const [username, password] of [["zhang", "wrong-password"], ["nosuch", "whatever-123"]] as const) {
    const t0 = Date.now();
    const res = await request(app.port, "POST", "/api/auth/login", { body: { username, password } });
    const elapsed = Date.now() - t0;
    assert.equal(res.status, 401, `${username} → 401`);
    assert.deepEqual(res.body, { error: { code: "UNAUTHORIZED", message: "invalid username or password" } });
    assert.ok(elapsed >= 390, `失败响应人为慢（实际 ${elapsed}ms ≥ 400ms 量级）`);
    assert.equal(res.headers["set-cookie"], undefined, "失败不种会话 cookie");
  }
});

test("登录限速：同用户名第 6 次/分钟 → 429；缺字段/非字符串 → 400", async () => {
  const app = await bff();
  app.store.upsertUser("zhang", (await import("bcryptjs")).hashSync("correct-horse-9", 10));

  // 5 次/分钟窗口内：1 次成功 + 4 次失败（每次失败 ~400ms，总 <2s）
  assert.equal((await login(app.port, "zhang", "correct-horse-9")).status, 200);
  for (let i = 0; i < 4; i++) {
    assert.equal((await request(app.port, "POST", "/api/auth/login", { body: { username: "zhang", password: "x".repeat(9) } })).status, 401);
  }
  const r6 = await request(app.port, "POST", "/api/auth/login", { body: { username: "zhang", password: "correct-horse-9" } });
  assert.equal(r6.status, 429);
  assert.deepEqual(r6.body, { error: { code: "RATE_LIMIT", message: "too many login attempts, retry later" } });

  // 其他用户名独立配额
  app.store.upsertUser("li", (await import("bcryptjs")).hashSync("pw-li-12345", 10));
  assert.equal((await login(app.port, "li", "pw-li-12345")).status, 200);

  // 参数校验（不消耗限速配额的快速拒绝）
  assert.equal((await request(app.port, "POST", "/api/auth/login", { body: { username: "zhang" } })).status, 400);
  assert.equal((await request(app.port, "POST", "/api/auth/login", { body: { username: "", password: "x".repeat(9) } })).status, 400);
  assert.equal((await request(app.port, "POST", "/api/auth/login", { body: { username: 42, password: "x".repeat(9) } })).status, 400);
});

test("会话门禁：无 cookie/伪造 sid/过期会话 → 401；/api/health 免鉴权", async () => {
  const app = await bff();
  app.store.upsertUser("zhang", (await import("bcryptjs")).hashSync("correct-horse-9", 10));
  const sid = (await login(app.port, "zhang", "correct-horse-9")).sid!;

  assert.equal((await request(app.port, "GET", "/api/me")).status, 401);
  assert.equal((await request(app.port, "GET", "/api/sessions")).status, 401);
  assert.equal((await request(app.port, "GET", "/api/me", { cookie: "sid=" + "f".repeat(32) })).status, 401, "库里不存在的 sid");

  // 已过期会话：直接落一行过去时刻的 sessions
  app.store.createSession("e".repeat(32), "zhang", Date.now() - 1000);
  assert.equal((await request(app.port, "GET", "/api/me", { cookie: `sid=${"e".repeat(32)}` })).status, 401, "过期会话 401");

  const health = await request(app.port, "GET", "/api/health");
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);

  const ok = await request(app.port, "GET", "/api/me", { cookie: `sid=${sid}` });
  assert.equal(ok.status, 200);
});

test("登出：删 sessions 行并清 cookie，旧 sid 立即失效", async () => {
  const app = await bff();
  app.store.upsertUser("zhang", (await import("bcryptjs")).hashSync("correct-horse-9", 10));
  const sid = (await login(app.port, "zhang", "correct-horse-9")).sid!;

  const out = await request(app.port, "POST", "/api/auth/logout", { cookie: `sid=${sid}` });
  assert.equal(out.status, 204);
  assert.equal(app.store.findSession(sid), undefined, "sessions 行已删（服务端可吊销）");
  const setCookies = (out.headers["set-cookie"] ?? []) as string[];
  assert.ok(setCookies.some((c) => /sid=;/.test(c)), "清 cookie");
  assert.equal((await request(app.port, "GET", "/api/me", { cookie: `sid=${sid}` })).status, 401, "旧 sid 立即失效");
});

test("ui_sessions CRUD：建/列/改/删仅限本人，删除级联清 messages；非法 title → 400", async () => {
  const app = await bff();
  app.store.upsertUser("zhang", (await import("bcryptjs")).hashSync("correct-horse-9", 10));
  app.store.upsertUser("li", (await import("bcryptjs")).hashSync("pw-li-12345", 10));
  const zhang = (await login(app.port, "zhang", "correct-horse-9")).sid!;
  const li = (await login(app.port, "li", "pw-li-12345")).sid!;

  // 建：带 title / 不带 title（默认“新会话”）
  const created = await request(app.port, "POST", "/api/sessions", { cookie: `sid=${zhang}`, body: { title: "瓷砖库存分析" } });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, "瓷砖库存分析");
  assert.match(created.body.id, /^us-/);
  const created2 = await request(app.port, "POST", "/api/sessions", { cookie: `sid=${zhang}` });
  assert.equal(created2.status, 201);
  assert.equal(created2.body.title, "新会话");

  // 非法 title
  assert.equal((await request(app.port, "POST", "/api/sessions", { cookie: `sid=${zhang}`, body: { title: "" } })).status, 400);
  assert.equal((await request(app.port, "POST", "/api/sessions", { cookie: `sid=${zhang}`, body: { title: 42 } })).status, 400);

  // 列表只见自己的
  app.store.createUiSession("li", "李的会话");
  const listZ = await request(app.port, "GET", "/api/sessions", { cookie: `sid=${zhang}` });
  assert.equal(listZ.status, 200);
  assert.deepEqual(listZ.body.map((s: any) => s.username), ["zhang", "zhang"]);
  const listL = await request(app.port, "GET", "/api/sessions", { cookie: `sid=${li}` });
  assert.deepEqual(listL.body.map((s: any) => s.username), ["li"]);

  // 改名：本人 200；他人 404（不泄露存在性）
  const renamed = await request(app.port, "PATCH", `/api/sessions/${created.body.id}`, { cookie: `sid=${zhang}`, body: { title: "改名后" } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.title, "改名后");
  assert.equal(app.store.getUiSession(created.body.id)!.title, "改名后");
  assert.equal((await request(app.port, "PATCH", `/api/sessions/${created.body.id}`, { cookie: `sid=${li}`, body: { title: "抢注" } })).status, 404);
  assert.equal((await request(app.port, "PATCH", "/api/sessions/us-not-exist", { cookie: `sid=${zhang}`, body: { title: "x" } })).status, 404);

  // 删除：本人 204 且级联清 messages；他人 404 且不动
  app.store.insertMessage({
    uiSessionId: created.body.id,
    runId: "run-x1",
    gatewaySessionId: "sess-g1",
    question: "测试问题",
  });
  assert.equal((await request(app.port, "DELETE", `/api/sessions/${created.body.id}`, { cookie: `sid=${li}` })).status, 404);
  assert.ok(app.store.getUiSession(created.body.id), "他人删除不影响");
  assert.equal((await request(app.port, "DELETE", `/api/sessions/${created.body.id}`, { cookie: `sid=${zhang}` })).status, 204);
  assert.equal(app.store.getUiSession(created.body.id), undefined);
  assert.deepEqual(app.store.listMessages(created.body.id), [], "删除级联清 messages");
});
