// M4-B3 审计端点测试：BFF 只读直连网关库的三种查法（按用户/按任务/按日期）+
// suggest 前缀补全；GW_DB_PATH 未设置 → 503 GW_DB_UNSET；守卫 401/403。
// 网关侧数据来自自建 fixture sqlite（与生产网关同构 schema），绝不触真库。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSync } from "bcryptjs";
import { buildStandardGwFixture, login, request, startBff, type BffHandle } from "./helpers.ts";

const openHandles: { bff?: BffHandle; dirs: string[] }[] = [];
const openDirs: string[] = [];

afterEach(async () => {
  for (const h of openHandles.splice(0)) if (h.bff) await h.bff.close();
  for (const d of openDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 带 fixture 网关库的 BFF（boss=管理员，zhang/li=普通）。 */
async function bffWithGw(): Promise<{ app: BffHandle; gw: ReturnType<typeof buildStandardGwFixture>; boss: string }> {
  const gwDir = mkdtempSync(join(tmpdir(), "bff-gw-"));
  openDirs.push(gwDir);
  const gw = buildStandardGwFixture(gwDir);
  const h = await startBff({ gwDbPath: gw.file });
  openHandles.push({ bff: h });
  h.store.upsertUser("boss", hashSync("pw-boss-12345", 10), { isAdmin: true });
  h.store.upsertUser("zhang", hashSync("pw-zhang-12345", 10));
  h.store.upsertUser("li", hashSync("pw-li-1234567", 10));
  // BFF 记账：zhang 今日登录 + li 昨日登录；zhang 的 UI 会话与 run-aaa 消息（关联查询用）
  h.store.recordLogin("zhang", "abc123", gw.aaa - 30 * 60_000, gw.aaa + 7 * 86_400_000);
  h.store.recordLogin("li", "def456", gw.ccc - 60 * 60_000, gw.ccc + 7 * 86_400_000);
  const ui = h.store.createUiSession("zhang", "瓷砖销量如何");
  h.store.insertMessage({ uiSessionId: ui.id, runId: "run-aaa-1111", gatewaySessionId: "sess-run-aaa", question: "本月瓷砖销量如何" });
  const boss = (await login(h.port, "boss", "pw-boss-12345")).sid!;
  return { app: h, gw, boss };
}

test("GW_DB_PATH 未设置：audit* 全部 503 GW_DB_UNSET", async () => {
  const app = await startBff();
  openHandles.push({ bff: app });
  app.store.upsertUser("boss", hashSync("pw-boss-12345", 10), { isAdmin: true });
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;

  for (const path of [
    "/api/admin/audit/user?name=zhang",
    "/api/admin/audit/run/run-aaa-1111",
    "/api/admin/audit/date?date=2026-09-20",
    "/api/admin/audit/suggest?q=a",
    "/api/admin/stats",
  ]) {
    const res = await request(app.port, "GET", path, { cookie: `sid=${boss}` });
    assert.equal(res.status, 503, `${path} → 503`);
    assert.deepEqual(res.body, { error: { code: "GW_DB_UNSET", message: "gateway db path not configured" } }, `${path} 错误体`);
  }
});

test("守卫：未登录 401；普通用户 403（审计端点也不放过）", async () => {
  const { app } = await bffWithGw();
  assert.equal((await request(app.port, "GET", "/api/admin/audit/user?name=zhang")).status, 401);
  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  for (const path of ["/api/admin/audit/user?name=zhang", "/api/admin/audit/run/run-aaa-1111", `/api/admin/audit/date?date=2026-09-20`, "/api/admin/audit/suggest?q=a", "/api/admin/stats"]) {
    assert.equal((await request(app.port, "GET", path, { cookie: `sid=${zhang}` })).status, 403, `${path} 普通用户 403`);
  }
});

test("按用户：任务时间线（终态/attempt/耗时/SQL 行数序列/答案摘要/报告路径）+ login_log 并入，按时间排序", async () => {
  const { app, gw, boss } = await bffWithGw();

  for (const path of [
    "/api/admin/audit/user",
    "/api/admin/audit/user?name=",
    "/api/admin/audit/user?name=zhang&since=2026/09/01",
    "/api/admin/audit/user?since=2026-09-01",
  ]) {
    const res = await request(app.port, "GET", path, { cookie: `sid=${boss}` });
    assert.equal(res.status, 400, `${path} → 400`);
  }

  const res = await request(app.port, "GET", "/api/admin/audit/user?name=zhang", { cookie: `sid=${boss}` });
  assert.equal(res.status, 200);
  assert.equal(res.body.user, "zhang");
  assert.equal(res.body.since, null);
  const items = res.body.items;
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].ts <= items[i].ts, "时间线按 ts 升序");

  const aaa = items.find((it: any) => it.kind === "task" && it.run_id === "run-aaa-1111");
  assert.ok(aaa, "run-aaa 在时间线");
  assert.equal(aaa.status, "succeeded");
  assert.equal(aaa.attempt, 1);
  assert.equal(aaa.elapsed_ms, 300_000, "耗时取 done 事件");
  assert.equal(aaa.sql_count, 2);
  assert.deepEqual(aaa.sql_rows, [5, 0], "SQL 序列行数");
  assert.ok(aaa.answer_excerpt.includes("瓷砖销量上升"), "答案摘要（压单行）");
  assert.ok(!aaa.answer_excerpt.includes("\n"), "摘要已压单行");
  assert.equal(aaa.report_path, "reports/run-aaa-1111.html", "报告路径（publications 优先）");

  const bbb = items.find((it: any) => it.kind === "task" && it.run_id === "run-bbb-2222");
  assert.equal(bbb.elapsed_ms, 120_000, "无 done 事件退回墙钟（updated-created）");
  assert.equal(bbb.error_code, "ENGINE_TIMEOUT");
  assert.equal(bbb.error_message, "执行超时");

  assert.ok(items.some((it: any) => it.kind === "account"), "开户事件并入");
  const loginItem = items.find((it: any) => it.kind === "login");
  assert.equal(loginItem.token_prefix, "abc123");
  assert.equal(loginItem.logout_at, null);
  assert.ok(!items.some((it: any) => it.kind === "task" && it.run_id === "run-ccc-3333"), "不含他人任务");

  // since：从明天起 → 全部任务被过滤
  const future = new Date(gw.today);
  future.setDate(future.getDate() + 1);
  const sinceStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}`;
  const sinceRes = await request(app.port, "GET", `/api/admin/audit/user?name=zhang&since=${sinceStr}`, { cookie: `sid=${boss}` });
  assert.equal(sinceRes.status, 200);
  assert.ok(!sinceRes.body.items.some((it: any) => it.kind === "task"), "since 过滤掉全部任务");
});

test("按任务：任务行 + 事件流逐条（payload 已解析）+ BFF 关联；未知 run 404", async () => {
  const { app, boss } = await bffWithGw();

  assert.equal((await request(app.port, "GET", "/api/admin/audit/run/run-nosuch", { cookie: `sid=${boss}` })).status, 404);

  const res = await request(app.port, "GET", "/api/admin/audit/run/run-aaa-1111", { cookie: `sid=${boss}` });
  assert.equal(res.status, 200);
  const t = res.body.task;
  assert.equal(t.run_id, "run-aaa-1111");
  assert.equal(t.user, "zhang");
  assert.equal(t.session_id, "sess-run-aaa-1111");
  assert.equal(t.status, "succeeded");
  assert.equal(t.attempt, 1);
  assert.ok(!("lease_owner" in t) && !("client_submission_id" in t), "租约/幂等键等内部字段不出端点");
  assert.equal(res.body.report_path, "reports/run-aaa-1111.html");
  assert.equal(res.body.elapsed_ms, 300_000);

  const evs = res.body.events;
  assert.equal(evs.length, 6);
  assert.deepEqual(evs.map((e: any) => e.seq), [1, 2, 3, 4, 5, 6], "seq 升序");
  assert.equal(evs[1].type, "sql");
  assert.equal(evs[1].payload.rows, 5, "payload 已从 JSON 字符串解析为对象");
  assert.equal(evs[3].type, "answer");
  assert.ok(evs[3].payload.markdown.includes("瓷砖销量上升"));
  assert.equal(evs[5].type, "done");
  assert.equal(evs[5].payload.tokens.input, 1200);

  assert.ok(res.body.bff, "BFF 关联存在");
  assert.equal(res.body.bff.ui_session.title, "瓷砖销量如何");
  assert.equal(res.body.bff.message.id.startsWith("msg-"), true);
});

test("按日期：当日全员行为一览（任务+BFF 开户/登录/新会话），汇总正确；非法日期 400", async () => {
  const { app, gw, boss } = await bffWithGw();

  for (const q of ["", "?date=2026-9-20", "?date=not-a-date"]) {
    const res = await request(app.port, "GET", `/api/admin/audit/date${q}`, { cookie: `sid=${boss}` });
    assert.equal(res.status, 400, `date="${q}" → 400`);
  }

  const res = await request(app.port, "GET", `/api/admin/audit/date?date=${gw.today}`, { cookie: `sid=${boss}` });
  assert.equal(res.status, 200);
  assert.equal(res.body.date, gw.today);
  assert.equal(res.body.summary.tasks, 3, "今日三任务（ccc 在昨日）");
  assert.deepEqual(res.body.summary.by_status, { succeeded: 1, failed: 1, queued: 1 });
  assert.deepEqual(res.body.summary.by_user, [
    { user: "zhang", n: 2 },
    { user: "li", n: 1 },
  ]);
  const items = res.body.items;
  for (let i = 1; i < items.length; i++) assert.ok(items[i - 1].ts <= items[i].ts, "升序");
  assert.equal(items.filter((it: any) => it.kind === "task").length, 3);
  assert.ok(items.some((it: any) => it.kind === "login" && it.username === "zhang" && it.token_prefix === "abc123"), "当日登录并入");
  assert.ok(items.some((it: any) => it.kind === "ui_session" && it.username === "zhang"), "当日新 UI 会话并入");
  assert.ok(items.some((it: any) => it.kind === "account"), "当日开户并入（种子用户 created_at=今日）");

  const yday = await request(app.port, "GET", `/api/admin/audit/date?date=${gw.yesterday}`, { cookie: `sid=${boss}` });
  assert.equal(yday.body.summary.tasks, 1, "昨日只有 ccc");
  assert.ok(yday.body.items.some((it: any) => it.kind === "task" && it.run_id === "run-ccc-3333"));
  assert.ok(yday.body.items.some((it: any) => it.kind === "login" && it.username === "li"), "li 昨日登录");
});

test("suggest：用户名前缀（BFF）+ run_id 前缀（网关）；空 q 400", async () => {
  const { app, boss } = await bffWithGw();

  assert.equal((await request(app.port, "GET", "/api/admin/audit/suggest", { cookie: `sid=${boss}` })).status, 400);

  const byUser = await request(app.port, "GET", "/api/admin/audit/suggest?q=zh", { cookie: `sid=${boss}` });
  assert.deepEqual(byUser.body.users, ["zhang"]);
  assert.deepEqual(byUser.body.run_ids, [], "zh 不匹配任何 run_id");

  const byRun = await request(app.port, "GET", "/api/admin/audit/suggest?q=run-aa", { cookie: `sid=${boss}` });
  assert.deepEqual(byRun.body.run_ids, ["run-aaa-1111"]);
  assert.deepEqual(byRun.body.users, [], "run-aa 不匹配用户名");
});
