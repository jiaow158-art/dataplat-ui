# dataplat-ui — 东鹏问数系统自建 UI（v1）

用户入口：登录 → 提问（SSE 实时过程）→ 答案 → 追问 → 报告预览/下载。

- 设计 spec：`dataprojai-2harness/docs/superpowers/specs/2026-09-18-dataplat-ui-v1-design.md`
- 网关对接契约（唯一权威）：`dataprojai-2harness/docs/superpowers/reports/2026-09-16-m2-integration-check.md`

## 结构

```
server/   UI BFF（Express 5 + better-sqlite3 + bcryptjs，node --test）
web/      React 18 + Vite + TS + Tailwind
```

## 启动（本地开发）

```bash
# 1. 建管理员账号（首次）
cd server && npm install && npm run admin:add <username>

# 2. 起 BFF（env 见下表）
cd server && npm start

# 3. 起前端（另一终端，dev proxy → BFF）
cd web && npm install && npm run dev   # http://localhost:5173
```

## BFF env（server/，.env 不入库）

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | `58090` | BFF 监听端口 |
| `HOST` | `127.0.0.1` | 监听地址（同机反代保持 127.0.0.1；跨机访问才设 0.0.0.0） |
| `GATEWAY_URL` | `http://127.0.0.1:58080` | engine-gateway 地址 |
| `AUTH_TOKEN` | （必填） | 网关 Bearer——只在此处，绝不进前端 |
| `DATA_DIR` | `./data` | SQLite 与记账数据目录（生产建议绝对路径——相对路径锚定进程 CWD） |
| `REPORTS_DIR` | （必填） | 网关 GATEWAY_REPORTS_DIR 同目录只读访问 |
| `STATIC_DIR` | （可选） | web/dist 目录——设置时 BFF 直出前端（SPA fallback），与 /api 同源 |
| `GW_DB_PATH` | （可选） | 网关 gateway.db 只读直连（审计/统计）；未设置时相关端点 503 GW_DB_UNSET；跨进程读 WAL 库要求与网关同用户/组 |
| `HARNESS_DIR` | （可选） | dataprojai-2harness 仓根——知识库管理入口（只读列 skills 文件 + 调 scripts/knowledge-publish.mjs 过 C2 门发布）；未设置时知识端点 503 |
| `INSIGHT_URL` | （可选） | insight-api 地址（驾驶舱代理）；未设置时 insight 端点 503 |
| `INSIGHT_ADMIN_TOKEN` | （可选） | insight 管理面共享 token（SCH-1 数据更新管理面） |
| `DEEPSEEK_API_KEY` | （可选） | 会话自动标题；未设置时该功能静默关闭 |

> Linux 部署（LIN-1）：env 经 systemd `EnvironmentFile`（或验证期 `set -a && . env && set +a`）注入；
> 反代须对 `/api/` 关闭缓冲（`proxy_buffering off`，SSE 依赖逐 chunk 直通）并保持与静态资源同源。

## 红线

- 网关 AUTH_TOKEN 只存在于 BFF 进程 env
- 用户身份一律 BFF 从登录态注入 X-User，不信前端载荷
- 报告服务必须属主校验 + 路径遏制 + CSP
