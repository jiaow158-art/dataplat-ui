// 账号管理 CLI（M4-B1/B5）—— 两个子命令，写操作全部落 admin_audit 留痕（操作者记 "<cli>"）：
//   npm run admin:add   -- <username> [--admin]   建号/改密（--admin 置管理员；改密不动角色除非带 flag）
//   npm run admin:grant -- <username>             提权/降级切换（0→1 grant_admin / 1→0 revoke_admin）
// 凭据不落日志/留痕（红线）；交互输两次密码，一致且 ≥8 位才入库，bcrypt 哈希 upsert。
import readline from "node:readline/promises";
import { hash } from "bcryptjs";
import { BffStore, initDb, type AdminAuditAction } from "./db.ts";

const AUDIT_CLI = "<cli>";

function usage(): never {
  console.error("用法:");
  console.error("  npm run admin:add -- <username> [--admin]   建号/改密（--admin 置管理员）");
  console.error("  npm run admin:grant -- <username>          提权/降级切换");
  process.exit(1);
}

const argv = process.argv.slice(2);
if (argv[0] === "admin:add") argv.shift(); // 兼容显式子命令形态（npm run admin:add -- admin:add <user>）
const grant = argv[0] === "admin:grant";
const username = (grant ? argv[1] : argv[0])?.trim();
const asAdmin = !grant && argv.includes("--admin");
if (!username || (grant && argv.length !== 2) || (!grant && argv.slice(1).some((a) => a !== "--admin"))) usage();

const store = new BffStore(initDb(process.env.DATA_DIR || "./data"));

// ── admin:grant：提权/降级切换 ─────────────────────────────────────────────────────
if (grant) {
  const user = store.getUser(username);
  if (!user) {
    console.error(`[admin] 用户不存在: ${username}`);
    process.exit(1);
  }
  const next = user.is_admin ? 0 : 1;
  store.setAdmin(username, next === 1);
  store.insertAdminAudit({
    username: AUDIT_CLI,
    action: next === 1 ? "grant_admin" : "revoke_admin",
    target: username,
    detail: `is_admin ${user.is_admin}→${next}`,
  });
  console.log(`[admin] ${username} ${next === 1 ? "已提权为管理员" : "已降级为普通用户"}`);
  process.exit(0);
}

// ── admin:add：建号/改密（交互输两次密码）──────────────────────────────────────────
// v1 明文回显（Windows raw-mode 掩码输入不在范围）；部署侧通过受控终端执行。
// 用 async iterator 逐行取：管道输入（两行同时到达）下连续 question() 会丢第二个
// 'line' 事件——iterator 的队列保证不丢行。
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const lines = rl[Symbol.asyncIterator]();
process.stdout.write(`为 ${username} 设置密码（≥8 位）: `);
const pw1 = ((await lines.next()).value ?? "") as string;
process.stdout.write("再输入一次确认: ");
const pw2 = ((await lines.next()).value ?? "") as string;
rl.close();

if (pw1.length < 8) {
  console.error("[admin] 密码至少 8 位");
  process.exit(1);
}
if (pw1 !== pw2) {
  console.error("[admin] 两次输入不一致");
  process.exit(1);
}

const created = store.upsertUser(username, await hash(pw1, 10), asAdmin ? { isAdmin: true } : undefined);
const action: AdminAuditAction = created ? "user_create" : "password_reset";
const detail = asAdmin ? `is_admin=${store.getUser(username)!.is_admin}` : undefined;
store.insertAdminAudit({ username: AUDIT_CLI, action, target: username, detail });
console.log(`[admin] 用户 ${username} ${created ? "已创建" : "密码已更新"}${asAdmin ? "（管理员）" : ""}`);
