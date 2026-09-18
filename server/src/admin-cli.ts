// UI-T2：账号管理 CLI —— npm run admin:add <username>（spec §3：账号由管理员 CLI 创建，
// v1 无管理员 Web 界面）。交互输两次密码，一致且 ≥8 位才入库；bcrypt 哈希 upsert（不落明文）。
import readline from "node:readline/promises";
import { hash } from "bcryptjs";
import { BffStore, initDb } from "./db.ts";

const username = process.argv[2]?.trim();
if (!username) {
  console.error("用法: npm run admin:add <username>");
  process.exit(1);
}

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

const store = new BffStore(initDb(process.env.DATA_DIR || "./data"));
const created = store.upsertUser(username, await hash(pw1, 10));
console.log(`[admin] 用户 ${username} ${created ? "已创建" : "密码已更新"}`);
