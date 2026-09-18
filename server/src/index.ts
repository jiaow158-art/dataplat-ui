// dataplat-ui BFF 入口 —— env + 建库 + 装配 + 监听（T1 骨架，T2 补账号与会话）。
// env 清单（README）：
//   PORT          监听端口（默认 58090）
//   GATEWAY_URL   engine-gateway 地址（默认 http://127.0.0.1:58080，同机部署）
//   AUTH_TOKEN    网关 Bearer（必填，缺省拒绝启动——空 token 等于不设防；只进本进程 env）
//   DATA_DIR      SQLite 记账目录（默认 ./data）
import { BffStore, initDb } from "./db.ts";
import { createApp } from "./app.ts";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`[CONFIG] 缺少必填环境变量 ${name}`);
  return v;
}

const port = Number(process.env.PORT ?? 58090);
const store = new BffStore(initDb(process.env.DATA_DIR || "./data"));
const app = createApp(store, {
  gatewayUrl: process.env.GATEWAY_URL || "http://127.0.0.1:58080",
  authToken: requiredEnv("AUTH_TOKEN"),
});

app.listen(port, "127.0.0.1", () => {
  console.log(`[bff] listening on http://127.0.0.1:${port} data=${process.env.DATA_DIR || "./data"}`);
});
