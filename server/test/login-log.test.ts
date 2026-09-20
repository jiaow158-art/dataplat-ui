// M4-B6 登录记账测试：login_log 是 sessions 的旁路记录（不动存量语义）——
// 登录成功写行（token_prefix=token 前 6 位，对齐网关 audit.mjs maskToken 惯例），
// 登出按 token 定位 UPDATE logout_at；未登出的行保持 NULL（存活/超时态）。
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

test("登录成功写 login_log：token_prefix=sid 前 6 位 hex、expires≈7 天、logout_at NULL；sessions 语义不变", async () => {
  const app = await bff();
  app.store.upsertUser("zhang", (await import("bcryptjs")).hashSync("correct-horse-9", 10));

  const res = await login(app.port, "zhang", "correct-horse-9");
  assert.equal(res.status, 200);
  const sid = res.sid!;

  const rows = app.db.prepare("SELECT * FROM login_log").all() as any[];
  assert.equal(rows.length, 1, "写了一行");
  const row = rows[0];
  assert.equal(row.username, "zhang");
  assert.equal(row.token_prefix, sid.slice(0, 6), "prefix=token 前 6 位");
  assert.match(row.token_prefix, /^[0-9a-f]{6}$/, "hex 前缀");
  assert.ok(row.id.startsWith("ll-"), "ll- 前缀 id");
  const ttl = row.expires_at - Date.now();
  assert.ok(ttl > 6.9 * 86400_000 && ttl < 7.1 * 86400_000, "过期时刻与 sessions 同步（7 天）");
  assert.equal(row.logout_at, null, "登出前 NULL");

  // sessions 存量语义不动：行仍在、可正常鉴权
  assert.ok(app.store.findSession(sid), "sessions 行仍在");
  assert.equal((await request(app.port, "GET", "/api/me", { cookie: `sid=${sid}` })).status, 200);
});

test("生命周期：登出按 token 定位置 logout_at；未登出的行保持 NULL；login_log 保留终态而 sessions 行删除", async () => {
  const app = await bff();
  const { hashSync } = await import("bcryptjs");
  app.store.upsertUser("zhang", hashSync("correct-horse-9", 10));

  const sidA = (await login(app.port, "zhang", "correct-horse-9")).sid!; // 存活不登出
  const sidB = (await login(app.port, "zhang", "correct-horse-9")).sid!; // 随后登出

  assert.equal((await request(app.port, "POST", "/api/auth/logout", { cookie: `sid=${sidB}` })).status, 204);

  const rows = app.db.prepare("SELECT * FROM login_log ORDER BY created_at, rowid").all() as any[];
  assert.equal(rows.length, 2, "两次登录两行");
  const [a, b] = rows;
  assert.equal(a.token_prefix, sidA.slice(0, 6));
  assert.equal(b.token_prefix, sidB.slice(0, 6));
  assert.notEqual(a.token_prefix, b.token_prefix, "两次登录 token 不同");
  assert.equal(a.logout_at, null, "未登出的行保持 NULL（存活/超时态）");
  assert.ok(typeof b.logout_at === "number" && b.logout_at <= Date.now(), "登出行 logout_at 已置");

  // sessions 语义不变：B 行已删、A 行仍在；login_log 两行都保留（旁路终态记账）
  assert.equal(app.store.findSession(sidB), undefined, "登出删 sessions 行（存量行为）");
  assert.ok(app.store.findSession(sidA), "未登出的会话仍在");
  assert.equal(app.db.prepare("SELECT COUNT(*) c FROM login_log").get().c, 2, "login_log 不随登出删除");
});
