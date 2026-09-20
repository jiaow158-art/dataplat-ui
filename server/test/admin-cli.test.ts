// M4-B1/B5 CLI 测试：真实子进程跑 admin-cli.ts（stdin 管道喂密码）——
// admin:add --admin 建管理员、改密留痕 password_reset 且角色保留；admin:grant 提权/降级切换。
// 全部写 admin_audit（B5 留痕，操作者记 "<cli>"）；凭据绝不进留痕/输出。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { compare } from "bcryptjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function runCli(args: string[], dataDir: string, input = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["src/admin-cli.ts", ...args], {
      cwd: SERVER_DIR,
      env: { ...process.env, DATA_DIR: dataDir },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(input);
    child.stdin.end();
  });
}

/** 临时库目录 + 读取句柄；done() 先关连接再删目录（Windows WAL 句柄 EPERM）。 */
function tempDir(): { root: string; open(): Database.Database; done(): void } {
  const root = mkdtempSync(join(tmpdir(), "bff-cli-"));
  return {
    root,
    open: () => new Database(join(root, "bff.db")),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("admin:add --admin：建号 is_admin=1，留痕 user_create（操作者 <cli>，不含密码）", async () => {
  const dir = tempDir();
  try {
    const r = await runCli(["admin:add", "boss", "--admin"], dir.root, "cli-pass-123\ncli-pass-123\n");
    assert.equal(r.code, 0, `exit 0（stderr=${r.stderr}）`);

    const db = dir.open();
    try {
      const user = db.prepare("SELECT * FROM users WHERE username = 'boss'").get() as any;
      assert.ok(user, "用户已建");
      assert.equal(user.is_admin, 1, "--admin 建管理员");
      assert.ok(await compare("cli-pass-123", user.password_hash), "bcrypt 哈希可验证");

      const audit = db.prepare("SELECT * FROM admin_audit").all() as any[];
      assert.equal(audit.length, 1, "一条留痕");
      assert.equal(audit[0].username, "<cli>", "CLI 留痕操作者记 <cli>");
      assert.equal(audit[0].action, "user_create");
      assert.equal(audit[0].target, "boss");
      assert.ok(!JSON.stringify(audit).includes("cli-pass-123"), "留痕不含凭据");
    } finally {
      db.close();
    }
  } finally {
    dir.done();
  }
});

test("admin:add 既有用户：留痕 password_reset；不带 --admin 改密不动角色", async () => {
  const dir = tempDir();
  try {
    await runCli(["admin:add", "boss", "--admin"], dir.root, "old-pass-123\nold-pass-123\n");
    const r = await runCli(["admin:add", "boss"], dir.root, "new-pass-456\nnew-pass-456\n");
    assert.equal(r.code, 0);

    const db = dir.open();
    try {
      const user = db.prepare("SELECT * FROM users WHERE username = 'boss'").get() as any;
      assert.ok(await compare("new-pass-456", user.password_hash), "密码已更新");
      assert.equal(user.is_admin, 1, "改密不带 flag 角色保留");

      const audit = db.prepare("SELECT * FROM admin_audit ORDER BY created_at, rowid").all() as any[];
      assert.deepEqual(
        audit.map((a) => a.action),
        ["user_create", "password_reset"],
        "第二次是改密留痕",
      );
      assert.equal(audit[1].target, "boss");
    } finally {
      db.close();
    }
  } finally {
    dir.done();
  }
});

test("admin:grant：提权/降级切换各留痕 grant_admin/revoke_admin；不存在用户退出非 0 且无留痕", async () => {
  const dir = tempDir();
  try {
    await runCli(["admin:add", "li"], dir.root, "cli-pass-123\ncli-pass-123\n"); // 普通用户

    const up = await runCli(["admin:grant", "li"], dir.root);
    assert.equal(up.code, 0, `提权 exit 0（stderr=${up.stderr}）`);
    const down = await runCli(["admin:grant", "li"], dir.root); // 再切回 → 降级
    assert.equal(down.code, 0);

    const db = dir.open();
    try {
      assert.equal((db.prepare("SELECT is_admin FROM users WHERE username = 'li'").get() as any).is_admin, 0, "两次切换回到普通用户");
      const audit = db.prepare("SELECT * FROM admin_audit ORDER BY created_at, rowid").all() as any[];
      assert.deepEqual(
        audit.map((a) => [a.action, a.target]),
        [
          ["user_create", "li"],
          ["grant_admin", "li"],
          ["revoke_admin", "li"],
        ],
        "每次切换一条留痕",
      );
      assert.equal(audit.every((a) => a.username === "<cli>"), true);
    } finally {
      db.close();
    }

    const missing = await runCli(["admin:grant", "nosuch"], dir.root);
    assert.notEqual(missing.code, 0, "不存在的用户非 0 退出");
    const db2 = dir.open();
    try {
      assert.equal(db2.prepare("SELECT COUNT(*) c FROM admin_audit WHERE target = 'nosuch'").get().c, 0, "失败不留痕");
    } finally {
      db2.close();
    }
  } finally {
    dir.done();
  }
});
