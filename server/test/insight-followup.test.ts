// M-i3 Task 3：followup 种子问题编排（spec §13/v1.2.4）——POST /api/insight/events/:id/followup
// 拉事件详情组种子问题（背景+事实+归因+用户意图）、建种子 UI 会话（标题=事件标题截 30 字）、
// followup_log 审计一行；prompt 可空=默认分析意图；事件不存在 404。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBff, startMockGateway, request, login, hashPw } from "./helpers.ts";

const DETAIL = {
  event: {
    event_id: "ev-1", title: "华南|GD01 业绩连续下滑", summary: "近3个完整月同比 -11.2%",
    metric: "yoy", severity: "major", scope_json: '{"范围":"瓷砖事业部","组织节点":"华南|GD01"}',
    period_json: '{"类型":"月"}', facts_json: '[{"label":"同比","value":"-11.2%"}]',
  },
  attribution: { status: "done", summary: "广东贡献 61%" },
  followupPrompts: ["为什么广东下降最明显？"],
};

test("followup 建种子会话+审计+返回种子问题", async () => {
  const insight = await startMockGateway((req, res) => {
    if (req.url === "/api/insight/events/ev-1") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(DETAIL));
      return;
    }
    res.writeHead(404).end();
  });
  const bff = await startBff({ insightUrl: insight.url });
  try {
    bff.store.upsertUser("u1", hashPw("pw"));
    bff.store.setFlag("u1", "insight_cockpit", true);
    const li = await login(bff.port, "u1", "pw");

    const r = await request(bff.port, "POST", "/api/insight/events/ev-1/followup", {
      cookie: `sid=${li.sid}`,
      body: { prompt: "看重点门店明细" },
    });
    assert.equal(r.status, 200);
    assert.ok(r.body.uiSessionId);
    assert.ok(r.body.seedQuestion.includes("华南|GD01 业绩连续下滑"));
    assert.ok(r.body.seedQuestion.includes("看重点门店明细"));
    // 种子会话已建且标题=事件标题（截30字）
    const sess = bff.db.prepare("SELECT * FROM ui_sessions WHERE id=?").get(r.body.uiSessionId) as Record<string, unknown>;
    assert.equal(sess.username, "u1");
    assert.equal(sess.title, "华南|GD01 业绩连续下滑");
    // 审计行
    const fu = bff.db.prepare("SELECT * FROM followup_log").all() as Array<Record<string, unknown>>;
    assert.equal(fu.length, 1);
    assert.equal(fu[0].event_id, "ev-1");
    assert.equal(fu[0].ui_session_id, r.body.uiSessionId);
    assert.equal(fu[0].prompt, "看重点门店明细");
  } finally {
    await bff.close();
    await insight.close();
  }
});

test("followup 无 prompt 用默认意图；事件不存在 404", async () => {
  const insight = await startMockGateway((req, res) => {
    if (req.url === "/api/insight/events/ev-1") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(DETAIL));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  const bff = await startBff({ insightUrl: insight.url });
  try {
    bff.store.upsertUser("u1", hashPw("pw"));
    bff.store.setFlag("u1", "insight_cockpit", true);
    const li = await login(bff.port, "u1", "pw");
    const r = await request(bff.port, "POST", "/api/insight/events/ev-1/followup", { cookie: `sid=${li.sid}`, body: {} });
    assert.equal(r.status, 200);
    assert.ok(r.body.seedQuestion.includes("请基于以上事件背景做进一步分析"));
    const r404 = await request(bff.port, "POST", "/api/insight/events/ev-nope/followup", { cookie: `sid=${li.sid}`, body: {} });
    assert.equal(r404.status, 404);
  } finally {
    await bff.close();
    await insight.close();
  }
});
