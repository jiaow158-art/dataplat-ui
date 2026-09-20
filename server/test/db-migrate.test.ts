// M4-B1/B5/B6 地基测试：schema 迁移与角色列 —— 旧库（无 is_admin）经 initDb/migrate.ts
// 幂等补齐（列 + admin_audit/login_log 表）；upsertUser/setAdmin 的管理员语义。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { BffStore, initDb } from "../src/db.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

/** 旧版 schema（M4 之前）：只有三列 users——迁移的最小存量形态。 */
function makeLegacyDb(dataDir: string, legacyUser = "legacy"): void {
  const raw = new Database(join(dataDir, "bff.db"));
  raw.exec(
    `CREATE TABLE users (
       username TEXT PRIMARY KEY,
       password_hash TEXT NOT NULL,
       created_at INTEGER NOT NULL
     );`,
  );
  raw.prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, 'x', 1)").run(legacyUser);
  raw.close();
}

function tableNames(db: Database.Database): string[] {
  return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((r) => r.name);
}

/** 临时目录 + 打开的库；cleanup 先关连接再删目录（Windows 下 WAL 句柄不关会 EPERM）。 */
function openTempDb(): { root: string; db: Database.Database; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), "bff-mig-"));
  const db = initDb(root);
  return {
    root,
    db,
    cleanup: () => {
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("旧库迁移：initDb 补 users.is_admin（存量行默认 0），并创建 admin_audit/login_log 表", () => {
  const root = mkdtempSync(join(tmpdir(), "bff-mig-"));
  try {
    makeLegacyDb(root); // 先造旧形态库，再走 initDb 迁移
    const db = initDb(root);
    try {
      const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      assert.ok(cols.some((c) => c.name === "is_admin"), "users 已有 is_admin 列");
      const legacy = db.prepare("SELECT is_admin FROM users WHERE username = 'legacy'").get() as { is_admin: number };
      assert.equal(legacy.is_admin, 0, "存量行默认 0（非管理员）");
      const tables = tableNames(db);
      assert.ok(tables.includes("admin_audit"), "admin_audit 表已建");
      assert.ok(tables.includes("login_log"), "login_log 表已建");
    } finally {
      db.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("迁移幂等：migrate.ts 对旧库补齐、再跑不炸（exit 0），列与表俱在", async () => {
  const root = mkdtempSync(join(tmpdir(), "bff-mig-"));
  try {
    makeLegacyDb(root);
    const env = { ...process.env, DATA_DIR: root };
    await execFileAsync(process.execPath, ["src/migrate.ts"], { cwd: SERVER_DIR, env }); // 第一次：补列
    await execFileAsync(process.execPath, ["src/migrate.ts"], { cwd: SERVER_DIR, env }); // 第二次：幂等重跑
    const raw = new Database(join(root, "bff.db"));
    try {
      const cols = raw.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      assert.ok(cols.some((c) => c.name === "is_admin"), "重跑后 is_admin 仍在");
      assert.ok(raw.prepare("SELECT is_admin FROM users WHERE username = 'legacy'").get(), "存量行未丢");
      const tables = tableNames(raw);
      assert.ok(tables.includes("admin_audit") && tables.includes("login_log"));
    } finally {
      raw.close();
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("角色语义：upsertUser 默认 is_admin=0；{isAdmin:true} 建 1；改密不动角色；setAdmin 翻转", () => {
  const h = openTempDb();
  try {
    const store = new BffStore(h.db);
    store.upsertUser("plain", "h1");
    assert.equal(store.getUser("plain")!.is_admin, 0, "默认非管理员");

    store.upsertUser("boss", "h1", { isAdmin: true });
    assert.equal(store.getUser("boss")!.is_admin, 1, "--admin 建号为管理员");

    store.upsertUser("boss", "h2"); // 改密不带 flag：角色必须保留
    const after = store.getUser("boss")!;
    assert.equal(after.is_admin, 1, "改密不动角色");
    assert.equal(after.password_hash, "h2", "密码已更新");

    assert.equal(store.setAdmin("boss", false), true);
    assert.equal(store.getUser("boss")!.is_admin, 0, "降级生效");
    assert.equal(store.setAdmin("boss", true), true);
    assert.equal(store.getUser("boss")!.is_admin, 1, "提权生效");
    assert.equal(store.setAdmin("nosuch", true), false, "不存在的用户返回 false");
  } finally {
    h.cleanup();
  }
});
