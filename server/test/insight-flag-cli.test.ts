// M-i3 insight 灰度 CLI 测试：真实子进程跑 insight-flag-cli.ts（DATA_DIR 指临时库，对齐 admin-cli 测试模式）——
// list 空表不炸；on/off 置 user_flags；未知用户 exit 1 且不落行；非法用法 exit 2。
// 灰度只动 user_flags 不记 admin_audit（flag 属产品开关非账号管理）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");

function runCli(
  args: string[],
  dataDir: string,
  input = "",
  script = "src/insight-flag-cli.ts",
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], {
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
  const root = mkdtempSync(join(tmpdir(), "flagcli-"));
  return {
    root,
    open: () => new Database(join(root, "bff.db")),
    done: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("flag CLI：list 空表不炸；on/off 置 user_flags；未知用户 exit 1 不落行；非法用法 exit 2", async () => {
  const dir = tempDir();
  try {
    // 建号走 admin:add 通道（CLI 间互操作，与 admin-cli 测试同型）
    const add = await runCli(["admin:add", "boss"], dir.root, "cli-pass-123\ncli-pass-123\n", "src/admin-cli.ts");
    assert.equal(add.code, 0, `建号 exit 0（stderr=${add.stderr}）`);

    // list：空表 exit 0 不炸
    const empty = await runCli(["list"], dir.root);
    assert.equal(empty.code, 0, `空表 list exit 0（stderr=${empty.stderr}）`);
    assert.match(empty.stdout, /no flags/);

    // on：exit 0 且 user_flags 落 enabled=1
    const on = await runCli(["on", "boss"], dir.root);
    assert.equal(on.code, 0, `on exit 0（stderr=${on.stderr}）`);
    const db = dir.open();
    try {
      assert.equal(
        (db.prepare("SELECT enabled FROM user_flags WHERE username = 'boss' AND flag = 'insight_cockpit'").get() as any).enabled,
        1,
        "on 后 enabled=1",
      );
    } finally {
      db.close();
    }

    // off：exit 0 且 enabled=0
    const off = await runCli(["off", "boss"], dir.root);
    assert.equal(off.code, 0, `off exit 0（stderr=${off.stderr}）`);
    const dbOff = dir.open();
    try {
      assert.equal(
        (dbOff.prepare("SELECT enabled FROM user_flags WHERE username = 'boss' AND flag = 'insight_cockpit'").get() as any).enabled,
        0,
        "off 后 enabled=0",
      );
    } finally {
      dbOff.close();
    }

    // 未知用户：exit 1 且不落行（无行=关，insightEnabled 语义）
    const ghost = await runCli(["on", "ghost"], dir.root);
    assert.equal(ghost.code, 1, "未知用户 exit 1");
    const db2 = dir.open();
    try {
      assert.equal(db2.prepare("SELECT COUNT(*) c FROM user_flags WHERE username = 'ghost'").get().c, 0, "未知用户不落行");
    } finally {
      db2.close();
    }

    // 非法用法：exit 2（0/1/2 封闭）
    const bogus = await runCli(["bogus"], dir.root);
    assert.equal(bogus.code, 2, "非法用法 exit 2");
    assert.match(bogus.stderr, /usage|用法/i);
  } finally {
    dir.done();
  }
});
