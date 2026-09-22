// dataplat-ui BFF 入口 —— env + 建库 + 装配 + 监听（T1 骨架，T2 补账号与会话）。
// env 清单（README）：
//   PORT          监听端口（默认 58090）
//   GATEWAY_URL   engine-gateway 地址（默认 http://127.0.0.1:58080，同机部署）
//   AUTH_TOKEN    网关 Bearer（必填，缺省拒绝启动——空 token 等于不设防；只进本进程 env）
//   REPORTS_DIR   报告根目录（UI-T7 必填：与网关 GATEWAY_REPORTS_DIR 同机只读访问）
//   DATA_DIR      SQLite 记账目录（默认 ./data）
//   HOST          监听地址（默认 127.0.0.1；M3-T1 方案A 生产设 0.0.0.0 供内网访问）
//   STATIC_DIR    web/ 构建产物目录（可选：M3-T1 静态托管——配置时 BFF 直出前端）
//   GW_DB_PATH    网关 gateway.db 路径（可选：M4-B3/B4 审计/统计只读直连；
//                 未设置时 /api/admin/audit* 与 /api/admin/stats 返回 503 GW_DB_UNSET）
//   HARNESS_DIR   dataprojai-2harness 仓根（可选：知识库管理入口——只读列 skills 文件 +
//                 调 scripts/knowledge-publish.mjs 过 C2 门发布；未设置时知识端点 503 HARNESS_DIR_UNSET）
import { resolve } from "node:path";
import { BffStore, initDb } from "./db.ts";
import { createApp } from "./app.ts";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[CONFIG] 缺少必填环境变量 ${name}`);
  return v;
}

const port = Number(process.env.PORT ?? 58090);
const host = process.env.HOST || "127.0.0.1";
const store = new BffStore(initDb(process.env.DATA_DIR || "./data"));
const app = createApp(store, {
  gatewayUrl: process.env.GATEWAY_URL || "http://127.0.0.1:58080",
  authToken: requiredEnv("AUTH_TOKEN"),
  reportsDir: resolve(requiredEnv("REPORTS_DIR")),
  staticDir: process.env.STATIC_DIR ? resolve(process.env.STATIC_DIR) : undefined,
  gwDbPath: process.env.GW_DB_PATH ? resolve(process.env.GW_DB_PATH) : undefined,
  harnessDir: process.env.HARNESS_DIR ? resolve(process.env.HARNESS_DIR) : undefined,
});

app.listen(port, host, () => {
  console.log(`[bff] listening on http://${host}:${port} data=${process.env.DATA_DIR || "./data"}`);
});
