// M4-B2 用户管理测试：users.disabled 迁移与登录拒绝、/api/admin/users 四端点
// （列表白名单/建号/重置密码/停用启用），全部写操作落 admin_audit；不能停用自己；
// 停用登录 401 与密码错同形（不泄露停用状态）。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSync } from "bcryptjs";
import { BffStore, initDb } from "../src/db.ts";
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
  app.store.upsertUser("boss", hashSync("pw-boss-12345", 10), { isAdmin: true });
  app.store.upsertUser("zhang", hashSync("pw-zhang-12345", 10));
}

test("2026-10-09 内网开放裁定：新建账号默认开 insight_cockpit（经营模块全员可见，可 CLI 逐人关）", () => {
  const store = new BffStore(initDb(mkdtempSync(join(tmpdir(), "flag-default-"))));
  store.upsertUser("newbie", hashSync("pw-x-12345", 10));
  assert.equal(store.insightEnabled("newbie"), true, "新建即默认可见");
  // 改密路径不得翻动已关的 flag
  store.setFlag("newbie", "insight_cockpit", false);
  store.upsertUser("newbie", hashSync("pw-y-12345", 10));
  assert.equal(store.insightEnabled("newbie"), false, "改密不动 flag");
});

test("迁移：旧库（无 disabled 列）经 initDb 幂等补齐，存量行默认 0", () => {
  const root = mkdtempSync(join(tmpdir(), "bff-b2-"));
  try {
    const raw = new Database(join(root, "bff.db"));
    raw.exec(
      `CREATE TABLE users (
         username TEXT PRIMARY KEY,
         password_hash TEXT NOT NULL,
         is_admin INTEGER NOT NULL DEFAULT 0,
         created_at INTEGER NOT NULL
       );`,
    );
    raw.prepare("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES ('legacy', 'x', 0, 1)").run();
    raw.close();

    const db = initDb(root); // 补列
    try {
      const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      assert.ok(cols.some((c) => c.name === "disabled"), "users 已有 disabled 列");
      const legacy = db.prepare("SELECT disabled FROM users WHERE username = 'legacy'").get() as { disabled: number };
      assert.equal(legacy.disabled, 0, "存量行默认 0（未停用）");
    } finally {
      db.close();
    }
    initDb(root).close(); // 幂等：再跑一次不炸（pragma 检测后跳过 ALTER）
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("停用账号：登录 401 与密码错同形（含错误体逐字一致）；启用后恢复；/api/me 带 is_admin", async () => {
  const app = await bff();
  await seedUsers(app);

  const wrongPw = await login(app.port, "zhang", "totally-wrong-9");
  assert.equal(wrongPw.status, 401);
  const wrongPwBody = wrongPw.body;

  app.store.setDisabled("zhang", true);
  const disabledLogin = await login(app.port, "zhang", "pw-zhang-12345"); // 正确密码 + 停用
  assert.equal(disabledLogin.status, 401, "停用账号正确密码也 401");
  assert.deepEqual(disabledLogin.body, wrongPwBody, "错误体与密码错逐字一致——不泄露停用状态");
  assert.ok(!disabledLogin.sid, "不种 cookie");

  app.store.setDisabled("zhang", false);
  const okLogin = await login(app.port, "zhang", "pw-zhang-12345");
  assert.equal(okLogin.status, 200, "启用后恢复登录");

  const me = await request(app.port, "GET", "/api/me", { cookie: `sid=${okLogin.sid}` });
  assert.deepEqual(me.body, { username: "zhang", is_admin: 0 }, "/api/me 增补 is_admin");
});

test("GET /api/admin/users：守卫 401/403；列表含 is_admin/disabled/created_at、绝不含 password_hash", async () => {
  const app = await bff();
  await seedUsers(app);

  assert.equal((await request(app.port, "GET", "/api/admin/users")).status, 401);
  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  const forbidden = await request(app.port, "GET", "/api/admin/users", { cookie: `sid=${zhang}` });
  assert.equal(forbidden.status, 403);

  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;
  const res = await request(app.port, "GET", "/api/admin/users", { cookie: `sid=${boss}` });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  const names = res.body.map((u: any) => u.username);
  assert.ok(names.includes("boss") && names.includes("zhang"));
  for (const u of res.body) {
    assert.deepEqual(
      Object.keys(u).sort(),
      ["created_at", "disabled", "is_admin", "username"],
      "出口字段白名单（无 password_hash）",
    );
    assert.equal(typeof u.created_at, "number");
  }
  const bossRow = res.body.find((u: any) => u.username === "boss");
  assert.equal(bossRow.is_admin, 1);
  assert.equal(bossRow.disabled, 0);
});

test("POST /api/admin/users：建号 201+留痕+可登录；重复 409；非法用户名/密码/is_admin 400", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;

  const created = await request(app.port, "POST", "/api/admin/users", {
    cookie: `sid=${boss}`,
    body: { username: "newbie", password: "pw-newbie-12345", is_admin: false },
  });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body, {
    username: "newbie",
    is_admin: 0,
    disabled: 0,
    created_at: created.body.created_at,
  });
  assert.equal((await login(app.port, "newbie", "pw-newbie-12345")).status, 200, "新号可登录");

  const adminCreated = await request(app.port, "POST", "/api/admin/users", {
    cookie: `sid=${boss}`,
    body: { username: "admin2", password: "pw-admin2-12345", is_admin: true },
  });
  assert.equal(adminCreated.status, 201);
  assert.equal(adminCreated.body.is_admin, 1, "is_admin=true 建管理员");

  const dup = await request(app.port, "POST", "/api/admin/users", {
    cookie: `sid=${boss}`,
    body: { username: "newbie", password: "pw-newbie-12345" },
  });
  assert.equal(dup.status, 409, "重复建号 409");

  for (const body of [
    { username: "x", password: "short" }, // 密码 <8
    { username: "", password: "pw-ok-12345" }, // 空用户名
    { username: "ok-name", password: 123 }, // 密码非字符串
    { username: "ok-name", password: "pw-ok-12345", is_admin: "yes" }, // is_admin 非布尔
    { password: "pw-ok-12345" }, // 缺用户名
  ]) {
    const res = await request(app.port, "POST", "/api/admin/users", { cookie: `sid=${boss}`, body });
    assert.equal(res.status, 400, `body=${JSON.stringify(body)} → 400`);
    assert.equal(res.body.error.code, "BAD_REQUEST");
  }

  const audit = app.store.listAdminAudit(10);
  const createOps = audit.filter((r) => r.action === "user_create");
  assert.equal(createOps.length, 2, "两次建号各留痕");
  assert.equal(createOps[0].username, "boss", "操作者为登录管理员");
  assert.equal(createOps[0].target, "admin2");
  assert.equal(createOps[0].detail, "is_admin=1", "管理员建号 detail 记角色");
  assert.ok(!JSON.stringify(audit).includes("pw-"), "留痕不含密码");
});

test("POST reset-password：改密留痕可登录（旧密码失效）；未知用户 404；短密码 400", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;

  assert.equal(
    (await request(app.port, "POST", "/api/admin/users/nosuch/reset-password", { cookie: `sid=${boss}`, body: { password: "pw-new-123456" } })).status,
    404,
  );
  assert.equal(
    (await request(app.port, "POST", "/api/admin/users/zhang/reset-password", { cookie: `sid=${boss}`, body: { password: "short" } })).status,
    400,
  );

  const res = await request(app.port, "POST", "/api/admin/users/zhang/reset-password", {
    cookie: `sid=${boss}`,
    body: { password: "pw-zhang-67890" },
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { username: "zhang" });
  assert.equal((await login(app.port, "zhang", "pw-zhang-12345")).status, 401, "旧密码失效");
  assert.equal((await login(app.port, "zhang", "pw-zhang-67890")).status, 200, "新密码可登录");

  const audit = app.store.listAdminAudit(5);
  const op = audit.find((r) => r.action === "password_reset");
  assert.ok(op, "password_reset 留痕");
  assert.equal(op.target, "zhang");
  assert.ok(!JSON.stringify(op).includes("pw-zhang-67890"), "留痕不含新密码");
});

test("POST disable/enable：不能停用自己 400；停用后登录 401；启用恢复；未知 404；留痕动作正确", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;

  const self = await request(app.port, "POST", "/api/admin/users/boss/disable", { cookie: `sid=${boss}` });
  assert.equal(self.status, 400, "不能停用自己");
  assert.equal(self.body.error.code, "BAD_REQUEST");

  assert.equal(
    (await request(app.port, "POST", "/api/admin/users/nosuch/disable", { cookie: `sid=${boss}` })).status,
    404,
  );

  const dis = await request(app.port, "POST", "/api/admin/users/zhang/disable", { cookie: `sid=${boss}` });
  assert.equal(dis.status, 200);
  assert.equal(dis.body.disabled, 1);
  assert.equal((await login(app.port, "zhang", "pw-zhang-12345")).status, 401, "停用后登录 401");

  const en = await request(app.port, "POST", "/api/admin/users/zhang/enable", { cookie: `sid=${boss}` });
  assert.equal(en.status, 200);
  assert.equal(en.body.disabled, 0);
  assert.equal((await login(app.port, "zhang", "pw-zhang-12345")).status, 200, "启用后恢复");

  const audit = app.store.listAdminAudit(5);
  assert.deepEqual(
    audit.filter((r) => r.target === "zhang").map((r) => r.action),
    ["user_enable", "user_disable"],
    "停用/启用各留痕（新到旧）",
  );
});
