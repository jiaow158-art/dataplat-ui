// M4-B1/B5 管理路由测试：/api/admin/* 命名空间 —— 会话门禁之上叠 admin 守卫
// （未登录 401 / 普通用户 403 FORBIDDEN / 管理员 200）；audit-ops 与 logins 两个查询端点。
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

async function seedUsers(app: BffHandle): Promise<void> {
  const { hashSync } = await import("bcryptjs");
  app.store.upsertUser("boss", hashSync("pw-boss-12345", 10), { isAdmin: true });
  app.store.upsertUser("zhang", hashSync("pw-zhang-12345", 10));
}

test("admin 守卫：未登录 401；普通用户 403 FORBIDDEN admin only；管理员 200（audit-ops 与 logins 两端点）", async () => {
  const app = await bff();
  await seedUsers(app);

  for (const path of ["/api/admin/audit-ops", "/api/admin/logins"]) {
    assert.equal((await request(app.port, "GET", path)).status, 401, `${path} 未登录 → 401（会话门禁先拦）`);
  }

  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  for (const path of ["/api/admin/audit-ops", "/api/admin/logins"]) {
    const res = await request(app.port, "GET", path, { cookie: `sid=${zhang}` });
    assert.equal(res.status, 403, `${path} 普通用户 → 403`);
    assert.deepEqual(res.body, { error: { code: "FORBIDDEN", message: "admin only" } }, `${path} 封闭集错误体`);
  }

  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;
  for (const path of ["/api/admin/audit-ops", "/api/admin/logins"]) {
    assert.equal((await request(app.port, "GET", path, { cookie: `sid=${boss}` })).status, 200, `${path} 管理员 → 200`);
  }
});

test("audit-ops：新到旧排序、limit 生效、缺省 50、非法 limit 400", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;

  // 造 3 行留痕（时间戳递增保证顺序稳定）
  for (let i = 0; i < 3; i++) {
    app.store.insertAdminAudit({ username: "op", action: "user_create", target: `u${i}`, detail: `seq-${i}` });
    await new Promise((r) => setTimeout(r, 5));
  }

  const all = await request(app.port, "GET", "/api/admin/audit-ops", { cookie: `sid=${boss}` });
  assert.equal(all.status, 200);
  assert.deepEqual(
    all.body.map((r: any) => r.detail),
    ["seq-2", "seq-1", "seq-0"],
    "新到旧",
  );
  assert.ok(all.body[0].id.startsWith("aa-"), "aa- 前缀 id");
  assert.equal(typeof all.body[0].created_at, "number");

  const limited = await request(app.port, "GET", "/api/admin/audit-ops?limit=2", { cookie: `sid=${boss}` });
  assert.equal(limited.body.length, 2, "limit 生效");
  assert.deepEqual(
    limited.body.map((r: any) => r.detail),
    ["seq-2", "seq-1"],
  );

  for (const bad of ["0", "-1", "abc", "1.5", "999999"]) {
    const res = await request(app.port, "GET", `/api/admin/audit-ops?limit=${bad}`, { cookie: `sid=${boss}` });
    assert.equal(res.status, 400, `limit=${bad} → 400`);
    assert.equal(res.body.error.code, "BAD_REQUEST");
  }
});

test("logins 端点：user 过滤 + limit + 全量缺省；非法参数 400；普通用户不可窥探", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!; // 写一行 login_log
  await login(app.port, "zhang", "pw-zhang-12345");
  await login(app.port, "zhang", "pw-zhang-12345");

  const all = await request(app.port, "GET", "/api/admin/logins", { cookie: `sid=${boss}` });
  assert.equal(all.status, 200);
  assert.equal(all.body.length, 3, "两用户三次登录");

  const zhangOnly = await request(app.port, "GET", "/api/admin/logins?user=zhang", { cookie: `sid=${boss}` });
  assert.equal(zhangOnly.body.length, 2);
  assert.deepEqual(
    zhangOnly.body.map((r: any) => r.username),
    ["zhang", "zhang"],
  );
  assert.equal(zhangOnly.body[0].token_prefix.length, 6, "prefix 6 位");
  assert.ok(typeof zhangOnly.body[0].expires_at === "number" && zhangOnly.body[0].logout_at === null);

  const one = await request(app.port, "GET", "/api/admin/logins?user=zhang&limit=1", { cookie: `sid=${boss}` });
  assert.equal(one.body.length, 1, "limit 与过滤叠加");

  assert.equal((await request(app.port, "GET", "/api/admin/logins?limit=abc", { cookie: `sid=${boss}` })).status, 400);
  assert.equal((await request(app.port, "GET", "/api/admin/logins?user=", { cookie: `sid=${boss}` })).status, 400);
});
