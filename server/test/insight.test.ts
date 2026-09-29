// M-i3 Task 1 数据层测试：user_flags 灰度表（spec §13，flag 只控入口不做数据权限）+
// followup_log 追问审计（v1.2.4：落 BFF 记账库，不进 insight.db）——默认关/幂等切换/审计行可查。
import { test } from "node:test";
import assert from "node:assert/strict";
import { startBff, hashPw } from "./helpers.ts";

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
