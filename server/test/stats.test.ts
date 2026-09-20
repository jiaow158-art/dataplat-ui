// M4-B4 统计端点测试：pilot-daily 聚合 port 的正确性——总量/成败分布/成功率/
// tokens 合计/活跃用户/今日新增/近 14 天序列/失败 error_code 分布与清单。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSync } from "bcryptjs";
import { buildStandardGwFixture, login, request, startBff, type BffHandle } from "./helpers.ts";

const openHandles: { bff?: BffHandle }[] = [];
const openDirs: string[] = [];

afterEach(async () => {
  for (const h of openHandles.splice(0)) if (h.bff) await h.bff.close();
  for (const d of openDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

test("stats 聚合：总量/分布/成功率/tokens/活跃用户/今日新增/14 天序列/失败分布与清单", async () => {
  const gwDir = mkdtempSync(join(tmpdir(), "bff-gw-"));
  openDirs.push(gwDir);
  const gw = buildStandardGwFixture(gwDir);
  const app = await startBff({ gwDbPath: gw.file });
  openHandles.push({ bff: app });
  app.store.upsertUser("boss", hashSync("pw-boss-12345", 10), { isAdmin: true });
  app.store.upsertUser("zhang", hashSync("pw-zhang-12345", 10));
  app.store.upsertUser("li", hashSync("pw-li-1234567", 10));
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;

  const res = await request(app.port, "GET", "/api/admin/stats", { cookie: `sid=${boss}` });
  assert.equal(res.status, 200);
  const s = res.body;

  assert.deepEqual(
    s.totals,
    {
      all: 4,
      succeeded: 2,
      failed: 1,
      cancelled: 0,
      running: 0,
      queued: 1,
      terminal: 3,
      success_rate_pct: 66.7, // 2/3，一位小数
    },
    "总量与成败分布",
  );
  assert.equal(s.active_users, 2, "zhang+li");
  assert.deepEqual(s.tokens, { input: 1300, output: 400, cache_read: 8200 }, "done 事件 tokens 累计");

  assert.equal(s.today.date, gw.today);
  assert.equal(s.today.tasks, 3, "今日 aaa/bbb/ddd");
  assert.deepEqual([...s.today.users].sort(), ["li", "zhang"]);
  assert.equal(s.today.new_users, 3, "BFF 今日开户 boss/zhang/li");

  assert.equal(s.daily.length, 14, "近 14 天序列（含今日）");
  assert.equal(s.daily[13].date, gw.today, "序列末日=今日");
  assert.equal(s.daily[13].count, 3);
  assert.equal(s.daily[12].date, gw.yesterday);
  assert.equal(s.daily[12].count, 1);
  assert.equal(s.daily.reduce((a: number, d: any) => a + d.count, 0), 4, "窗口内计数=任务总量（其余天为 0）");

  assert.deepEqual(
    s.fail_by_code,
    [{ code: "ENGINE_TIMEOUT", count: 1, sample_message: "执行超时" }],
    "失败按 error_code 分布",
  );
  assert.equal(s.failed.length, 1);
  const f = s.failed[0];
  assert.equal(f.run_id, "run-bbb-2222");
  assert.equal(f.user, "zhang");
  assert.equal(f.error_code, "ENGINE_TIMEOUT");
  assert.equal(f.attempt, 2);
  assert.equal(f.created_at, gw.bbb);
});

test("stats 守卫与缺配置：未登录 401；普通用户 403；未设 gwDbPath 503 GW_DB_UNSET", async () => {
  const app = await startBff();
  openHandles.push({ bff: app });
  app.store.upsertUser("boss", hashSync("pw-boss-12345", 10), { isAdmin: true });
  app.store.upsertUser("zhang", hashSync("pw-zhang-12345", 10));

  assert.equal((await request(app.port, "GET", "/api/admin/stats")).status, 401);
  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  assert.equal((await request(app.port, "GET", "/api/admin/stats", { cookie: `sid=${zhang}` })).status, 403);

  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;
  const res = await request(app.port, "GET", "/api/admin/stats", { cookie: `sid=${boss}` });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, "GW_DB_UNSET");
});
