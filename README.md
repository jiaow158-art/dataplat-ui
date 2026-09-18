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
| `GATEWAY_URL` | `http://127.0.0.1:58080` | engine-gateway 地址 |
| `AUTH_TOKEN` | （必填） | 网关 Bearer——只在此处，绝不进前端 |
| `DATA_DIR` | `./data` | SQLite 与记账数据目录 |
| `REPORTS_DIR` | （必填） | 网关 GATEWAY_REPORTS_DIR 同目录只读访问 |

## 红线

- 网关 AUTH_TOKEN 只存在于 BFF 进程 env
- 用户身份一律 BFF 从登录态注入 X-User，不信前端载荷
- 报告服务必须属主校验 + 路径遏制 + CSP
