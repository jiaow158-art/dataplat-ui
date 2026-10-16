// M-i3 Task 1 数据层测试：user_flags 灰度表（spec §13，flag 只控入口不做数据权限）+
// followup_log 追问审计（v1.2.4：落 BFF 记账库，不进 insight.db）——默认关/幂等切换/审计行可查。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBff, startMockGateway, request, login, hashPw } from "./helpers.ts";

test("user_flags 建号默认 ON，显式 OFF/重新 ON，setFlag 幂等（2026-10-09 内网开放裁定）", async () => {
  const bff = await startBff();
  try {
    bff.store.upsertUser("u1", hashPw("pw"));
    assert.equal(bff.store.insightEnabled("u1"), true); // 建号默认 ON（upsertUser 建号即播种）
    bff.store.setFlag("u1", "insight_cockpit", false);
    assert.equal(bff.store.insightEnabled("u1"), false); // 显式 OFF 有效
    bff.store.setFlag("u1", "insight_cockpit", true);
    assert.equal(bff.store.insightEnabled("u1"), true); // 重新 ON
    bff.store.setFlag("u1", "insight_cockpit", true); // 幂等
    assert.equal(bff.store.insightEnabled("u1"), true);
    assert.equal(bff.store.insightEnabled("nobody"), false); // 未知用户（无账号无行）=关
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
      bff.store.setFlag("u1", "insight_cockpit", false); // 建号默认 ON——测"关"须显式 OFF
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

test("M-i7 target-overview：未开 flag 403；开 flag 代理透传", async () => {
  const insight = await startMockGateway((req, res) => {
    if (req.url === "/api/insight/target-overview") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        asOf: "2026-10-01", year: 2026,
        annual: { achievePct: 82.8, actualWan: 357407.2, targetWan: 431430.1, timePct: 74.5, timeBasis: "年日内自然日占比" },
        projection: { dailyWan: 1183.5, projectedWan: 432037.0, projectedGapWan: -606.9, basis: "YTD 实绩 ÷ 年内已过自然日 × 全年自然日（线性年化）" },
        months: [], centers: [], centersTotalBehindWan: null,
      }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  const bff = await startBff({ insightUrl: insight.url });
  try {
    bff.store.upsertUser("u1", hashPw("pw"));
    bff.store.setFlag("u1", "insight_cockpit", false); // 建号默认 ON——显式 OFF 后测 403
    const li = await login(bff.port, "u1", "pw");
    const r403 = await request(bff.port, "GET", "/api/insight/target-overview", { cookie: `sid=${li.sid}` });
    assert.equal(r403.status, 403);
    assert.equal(r403.body.error.code, "FLAG_OFF");
    bff.store.setFlag("u1", "insight_cockpit", true);
    const r = await request(bff.port, "GET", "/api/insight/target-overview", { cookie: `sid=${li.sid}` });
    assert.equal(r.status, 200);
    assert.equal(r.body.asOf, "2026-10-01");
    assert.equal(r.body.annual.achievePct, 82.8);
    assert.ok(insight.requests.some((q) => q.url === "/api/insight/target-overview")); // 上游逐字收到该路径
  } finally {
    await bff.close();
    await insight.close();
  }
});

test("M-i8 region-map：未开 flag 403；开 flag 代理透传", async () => {
  const insight = await startMockGateway((req, res) => {
    if (req.url === "/api/insight/region-map") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        asOf: "2026-10-05", window: "2026-01-01 ~ 2026-10-05（双年同窗）",
        national: { ytdWan: 363201.2, lyWan: 326941.0, yoyPct: 11.1, grossMarginPct: 24.3, achievePct: 75.9 },
        regions: [], provinces: [], unmappedProvinces: [],
        regionTrend: { months: [], series: {} }, regionEvents: {},
      }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  const bff = await startBff({ insightUrl: insight.url });
  try {
    bff.store.upsertUser("u1", hashPw("pw"));
    bff.store.setFlag("u1", "insight_cockpit", false); // 建号默认 ON——显式 OFF 后测 403
    const li = await login(bff.port, "u1", "pw");
    const r403 = await request(bff.port, "GET", "/api/insight/region-map", { cookie: `sid=${li.sid}` });
    assert.equal(r403.status, 403);
    assert.equal(r403.body.error.code, "FLAG_OFF");
    bff.store.setFlag("u1", "insight_cockpit", true);
    const r = await request(bff.port, "GET", "/api/insight/region-map", { cookie: `sid=${li.sid}` });
    assert.equal(r.status, 200);
    assert.equal(r.body.asOf, "2026-10-05");
    assert.equal(r.body.national.ytdWan, 363201.2);
    assert.ok(insight.requests.some((q) => q.url === "/api/insight/region-map")); // 上游逐字收到该路径
  } finally {
    await bff.close();
    await insight.close();
  }
});

test("M-i5 四新端点：未开 flag 403；开 flag 代理透传", async () => {
  const insight = await startMockGateway((req, res) => {
    const json = (b: unknown) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(b));
    };
    if (req.url === "/api/insight/health-score")
      return json({ as_of: "2026-09-29", rings: [], target: null });
    if (req.url === "/api/insight/events?state=active")
      return json({ briefDate: "2026-09-30", publishMinScore: 55, events: [{ event_id: "ev-1", publishedToday: false, scoreGap: -4.3 }] });
    if (req.url === "/api/insight/events/ev-1/trend?months=12")
      return json({ kind: "month_compare", series: [{ month: "2026-08", cur: 1, prev: 2 }] });
    if (req.url === "/api/insight/events/ev-1/related")
      return json({ sameType: [], sameRegion: [] });
    if (req.url === "/api/insight/events?state=all")
      return json({ asOf: "2026-09-30", summary: {}, trend: { days: 30, points: [] },
                    eventTypeDistribution: [], lifecycleDistribution: [],
                    truncated: false, events: [] });
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  const bff = await startBff({ insightUrl: insight.url });
  try {
    bff.store.upsertUser("u1", hashPw("pw"));
    bff.store.setFlag("u1", "insight_cockpit", false); // 建号默认 ON——显式 OFF 后测 403
    const li = await login(bff.port, "u1", "pw");
    const paths = [
      "/api/insight/health-score",
      "/api/insight/events?state=active",
      "/api/insight/events/ev-1/trend?months=12",
      "/api/insight/events/ev-1/related",
    ];
    for (const p of paths) {
      const r403 = await request(bff.port, "GET", p, { cookie: `sid=${li.sid}` });
      assert.equal(r403.status, 403);
      assert.equal(r403.body.error.code, "FLAG_OFF");
    }
    bff.store.setFlag("u1", "insight_cockpit", true);
    const r1 = await request(bff.port, "GET", "/api/insight/health-score", { cookie: `sid=${li.sid}` });
    assert.equal(r1.status, 200);
    assert.equal(r1.body.as_of, "2026-09-29");
    const r2 = await request(bff.port, "GET", "/api/insight/events?state=active", { cookie: `sid=${li.sid}` });
    assert.equal(r2.status, 200);
    assert.equal(r2.body.events[0].scoreGap, -4.3);
    const r3 = await request(bff.port, "GET", "/api/insight/events/ev-1/trend?months=12", { cookie: `sid=${li.sid}` });
    assert.equal(r3.status, 200);
    assert.equal(r3.body.kind, "month_compare");
    const r4 = await request(bff.port, "GET", "/api/insight/events/ev-1/related", { cookie: `sid=${li.sid}` });
    assert.equal(r4.status, 200);
    assert.deepEqual(r4.body, { sameType: [], sameRegion: [] });
    const r5 = await request(bff.port, "GET", "/api/insight/events?state=all", { cookie: `sid=${li.sid}` });
    assert.equal(r5.status, 200);
    assert.equal(r5.body.asOf, "2026-09-30");
    assert.ok(insight.requests.some((q) => q.url === "/api/insight/events?state=all"));
    // 上游确实收到了对应路径（query 串逐字透传）
    for (const up of [
      "/api/insight/health-score",
      "/api/insight/events?state=active",
      "/api/insight/events/ev-1/trend?months=12",
      "/api/insight/events/ev-1/related",
    ]) {
      assert.ok(insight.requests.some((q) => q.url === up), `upstream missing ${up}`);
    }
  } finally {
    await bff.close();
    await insight.close();
  }
});

test("新用户默认 ON：enabled=true，驾驶舱端点直接放行透传（2026-10-09 内网开放裁定）", async () => {
  const insight = await startMockGateway((req, res) => {
    if (req.url === "/api/insight/daily") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ briefDate: "2026-10-16", eventCount: 0, events: [], stale: false, scope: "瓷砖事业部" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  const bff = await startBff({ insightUrl: insight.url });
  try {
    bff.store.upsertUser("fresh", hashPw("pw"));
    const li = await login(bff.port, "fresh", "pw");
    const e = await request(bff.port, "GET", "/api/insight/enabled", { cookie: `sid=${li.sid}` });
    assert.equal(e.status, 200);
    assert.deepEqual(e.body, { enabled: true }); // 默认 ON，无需任何 CLI 操作
    const r = await request(bff.port, "GET", "/api/insight/daily", { cookie: `sid=${li.sid}` });
    assert.equal(r.status, 200); // gate 放行 → 代理透传
    assert.equal(r.body.briefDate, "2026-10-16");
    assert.ok(insight.requests.some((q) => q.url === "/api/insight/daily"));
  } finally {
    await bff.close();
    await insight.close();
  }
});

test("flag 用户隔离：显式 OFF 只影响本人，他人默认 ON 不受影响", async () => {
  const insight = await startMockGateway((req, res) => {
    if (req.url === "/api/insight/daily") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ briefDate: "2026-10-16", eventCount: 0, events: [], stale: false }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "NOT_FOUND" }));
  });
  const bff = await startBff({ insightUrl: insight.url });
  try {
    bff.store.upsertUser("off-guy", hashPw("pw"));
    bff.store.upsertUser("on-guy", hashPw("pw"));
    bff.store.setFlag("off-guy", "insight_cockpit", false); // 仅 off-guy 显式关
    const lOff = await login(bff.port, "off-guy", "pw");
    const lOn = await login(bff.port, "on-guy", "pw");
    const rOff = await request(bff.port, "GET", "/api/insight/daily", { cookie: `sid=${lOff.sid}` });
    assert.equal(rOff.status, 403);
    assert.equal(rOff.body.error.code, "FLAG_OFF");
    const rOn = await request(bff.port, "GET", "/api/insight/daily", { cookie: `sid=${lOn.sid}` });
    assert.equal(rOn.status, 200); // 他人不受影响
  } finally {
    await bff.close();
    await insight.close();
  }
});
