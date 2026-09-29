// M-i3 insight 灰度 CLI（spec §13）—— npm run insight:flag -- list | on <username> | off <username>
// 只动 user_flags（灰度属产品开关非账号管理，不记 admin_audit；后续需要可加）。
// flag 属封闭集 insight_cockpit（setFlag 内校验）；exit code 封闭 0/1/2（1=用户不存在，2=用法错）。
import { pathToFileURL } from "node:url";
import { BffStore, initDb } from "./db.ts";

export async function flagCliMain(args: string[], store: BffStore): Promise<number> {
  const [cmd, username] = args;
  if (cmd === "list") {
    const rows = store.listFlags();
    if (!rows.length) console.log("(no flags)");
    for (const r of rows) console.log(`${r.username}\t${r.enabled ? "on" : "off"}\t${new Date(r.granted_at).toISOString()}`);
    return 0;
  }
  if ((cmd === "on" || cmd === "off") && username) {
    const user = store.getUser(username);
    if (!user) {
      console.error(`[flag] 用户不存在: ${username}`);
      return 1;
    }
    store.setFlag(username, "insight_cockpit", cmd === "on");
    console.log(`[flag] ${username} insight_cockpit=${cmd}`);
    return 0;
  }
  console.error("用法: npm run insight:flag -- list | on <username> | off <username>");
  return 2;
}

// 直跑入口（DATA_DIR 同 admin-cli）；被 import（测试进程内）时不执行——admin-cli.ts 是纯脚本
// 无此判定，本文件因需可被 import 故用 Node 标准 main 判定。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = new BffStore(initDb(process.env.DATA_DIR || "./data"));
  process.exit(await flagCliMain(process.argv.slice(2), store));
}
