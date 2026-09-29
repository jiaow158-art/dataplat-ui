// M-i3 Task 1 数据层测试：user_flags 灰度表（spec §13，flag 只控入口不做数据权限）+
// followup_log 追问审计（v1.2.4：落 BFF 记账库，不进 insight.db）——默认关/幂等切换/审计行可查。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBff, startMockGateway, request, login, hashPw } from "./helpers.ts";

test("user_flags 默认关闭，setFlag 幂等切换", async () => {
  const bff = await startBff();
  try {
    bff.store.upsertUser("u1", hashPw("pw"));
    assert.equal(bff.store.insightEnabled("u1"), false); // 默认关
    bff.store.setFlag("u1", "insight_cockpit", true);
    assert.equal(bff.store.insightEnabled("u1"), true);
    bff.store.setFlag("u1", "insight_cockpit", true); // 幂等
    assert.equal(bff.store.insightEnabled("u1"), true);
    bff.store.setFlag("u1", "insight_cockpit", false);
    assert.equal(bff.store.insightEnabled("u1"), false);
    assert.equal(bff.store.insightEnabled("nobody"), false); // 未知用户=关
  } finally {
    await bff.close();
  }
});

test("followup_log 审计行写入并可查", async () => {
  const bff = await startBff();
  try {
    bff.store.upsertUser("u1", hashPw("pw"));
    bff.store.insertFollowup("fu-1", "u1", "ev-1", "us-1", "为什么下降？");
    const rows = bff.db
      .prepare("SELECT * FROM followup_log WHERE username=?")
      .all("u1") as Array<Record<string, unknown>>;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].event_id, "ev-1");
    assert.equal(rows[0].ui_session_id, "us-1");
  } finally {
    await bff.close();
  }
});

test("enabled/daily/events/timeline 代理与 flag 门禁", async (t) => {
  const insight = await startMockGateway((req, res) => {
    if (req.url === "/api/insight/daily") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ briefDate: "2026-09-29", eventCount: 1, events: [], dataFreshness: { overall: "ready", radars: [] }, stale: false, scope: "瓷砖事业部" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  const bff = await startBff({ insightUrl: insight.url });
  try {
    bff.store.upsertUser("u1", hashPw("pw"));
    const li = await login(bff.port, "u1", "pw");

    await t.test("未开 flag → 全部 403 FLAG_OFF；enabled 端点不受门禁", async () => {
      const r = await request(bff.port, "GET", "/api/insight/daily", { cookie: `sid=${li.sid}` });
      assert.equal(r.status, 403);
      assert.equal(r.body.error.code, "FLAG_OFF");
      const e = await request(bff.port, "GET", "/api/insight/enabled", { cookie: `sid=${li.sid}` });
      assert.equal(e.status, 200);
      assert.deepEqual(e.body, { enabled: false });
    });

    await t.test("开 flag → daily 代理透传", async () => {
      bff.store.setFlag("u1", "insight_cockpit", true);
      const r = await request(bff.port, "GET", "/api/insight/daily", { cookie: `sid=${li.sid}` });
      assert.equal(r.status, 200);
      assert.equal(r.body.briefDate, "2026-09-29");
      assert.ok(insight.requests.some((q) => q.url === "/api/insight/daily"));
    });

    await t.test("insight 不可达 → 503 INSIGHT_UNAVAILABLE", async () => {
      const dead = await startBff({ insightUrl: "http://127.0.0.1:1" });
      try {
        dead.store.upsertUser("u2", hashPw("pw"));
        dead.store.setFlag("u2", "insight_cockpit", true);
        const l2 = await login(dead.port, "u2", "pw");
        const r = await request(dead.port, "GET", "/api/insight/daily", { cookie: `sid=${l2.sid}` });
        assert.equal(r.status, 503);
        assert.equal(r.body.error.code, "INSIGHT_UNAVAILABLE");
      } finally {
        await dead.close();
      }
    });
  } finally {
    await bff.close();
    await insight.close();
  }
});
