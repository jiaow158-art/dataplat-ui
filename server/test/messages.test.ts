// UI-T6 集成测试：GET /api/sessions/:id/messages —— 历史回显端点（spec §4/§5）。
// 数据面 = store.listMessages（按 created_at, rowid 排序）；属主语义与 PATCH/DELETE 一致：
// 非本人/不存在统一 404（不泄露存在性）；未登录 401。不触网关（纯记账读）。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hashPw, login, request, startBff, type BffHandle } from "./helpers.ts";

const openBff: BffHandle[] = [];

afterEach(async () => {
  for (const h of openBff.splice(0)) await h.close();
});

test("messages 回显：本人会话消息按创建序返回（question/answer_md/report_path/status 全字段落账回读）；未登录 401", async () => {
  const bff = await startBff();
  openBff.push(bff);
  bff.store.upsertUser("zhang", hashPw("correct-horse-9"));
  const sid = (await login(bff.port, "zhang", "correct-horse-9")).sid!;

  const ui = bff.store.createUiSession("zhang", "库存问数");
  bff.store.insertMessage({ uiSessionId: ui.id, runId: "run-a", gatewaySessionId: "sess-gw-1", question: "第一问" });
  bff.store.insertMessage({ uiSessionId: ui.id, runId: "run-b", gatewaySessionId: "sess-gw-1", question: "第二问" });
  bff.store.updateMessageAnswer("run-a", "## 结论\n回答正文");
  bff.store.updateMessageReport("run-a", "sess-gw-1/report.html");
  bff.store.updateMessageStatus("run-a", "succeeded");

  const res = await request(bff.port, "GET", `/api/sessions/${ui.id}/messages`, { cookie: `sid=${sid}` });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body));
  assert.equal(res.body.length, 2);
  assert.deepEqual(
    res.body.map((m: any) => m.question),
    ["第一问", "第二问"],
    "按 created_at/rowid 升序（对话时序）",
  );
  const first = res.body[0];
  assert.equal(first.run_id, "run-a");
  assert.equal(first.answer_md, "## 结论\n回答正文");
  assert.equal(first.report_path, "sess-gw-1/report.html");
  assert.equal(first.status, "succeeded");
  assert.equal(res.body[1].answer_md, null, "未落账字段为 null");

  assert.equal((await request(bff.port, "GET", `/api/sessions/${ui.id}/messages`)).status, 401, "未登录 401");
});

test("messages 属主：他人/不存在的会话 → 404（不泄露存在性），且无消息的本人会话返回空数组", async () => {
  const bff = await startBff();
  openBff.push(bff);
  bff.store.upsertUser("zhang", hashPw("correct-horse-9"));
  bff.store.upsertUser("li", hashPw("pw-li-12345"));
  const sid = (await login(bff.port, "zhang", "correct-horse-9")).sid!;
  const liSid = (await login(bff.port, "li", "pw-li-12345")).sid!;

  const ui = bff.store.createUiSession("zhang", "私有会话");
  bff.store.insertMessage({ uiSessionId: ui.id, runId: "run-a", gatewaySessionId: "sess-gw-1", question: "机密问题" });

  assert.equal((await request(bff.port, "GET", `/api/sessions/${ui.id}/messages`, { cookie: `sid=${liSid}` })).status, 404, "他人 404");
  assert.equal((await request(bff.port, "GET", "/api/sessions/us-not-exist/messages", { cookie: `sid=${sid}` })).status, 404, "不存在 404");

  const empty = bff.store.createUiSession("zhang", "空会话");
  const res = await request(bff.port, "GET", `/api/sessions/${empty.id}/messages`, { cookie: `sid=${sid}` });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});
