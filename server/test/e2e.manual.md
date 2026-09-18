# UI-T8 E2E 验收记录（真网关，2026-09-18）

> 环境：engine-gateway 58080（manual-token 台，真 dsh/DeepSeek/DWS）+ 本 BFF 58090（DATA_DIR=./data，REPORTS_DIR 同网关报告根）。
> 前置：`npm run admin:add tester-a` / `tester-b` 两账号。

## 执行与结果

| # | 验收项（spec §10） | 结果 | 证据 |
|---|---|---|---|
| 1 | 登录 / /api/me | ✅ | cookie 会话；错误口令 401（BFF 单测另证慢响应+限速） |
| 2 | 提问（真引擎） | ✅ | run-97e5329b…：9 条 sql 事件 + answer + done succeeded（183s，tokens in/out 36136/32503） |
| 3 | SSE 断线重连 | ✅ | 25s 硬断在 seq 4 → Last-Event-ID 重连 → 补 31 事件 → **重复 id 数 0** → done 收流 |
| 4 | 追问（同会话） | ✅ | "把上面的分析生成一份HTML报告"（带 ui_session_id）→ 同 gateway session 续问，45 事件 |
| 5 | 报告生成 | ✅ | report 事件 → `reports\tester-a\run-fde75198….html`（1.08MB），done succeeded（181s） |
| 6 | 报告预览（属主） | ✅ | tester-a GET /api/reports → 200；头：`text/html; charset=utf-8`、`X-Content-Type-Options: nosniff`、CSP（default-src 'none' + 内联脚本留白） |
| 7 | 跨用户越权 | ✅ | tester-b 取 A 的报告 → `403 {"code":"FORBIDDEN","message":"report owner mismatch"}` |
| 8 | 下载 | ✅ | `&download=1` → `Content-Disposition: attachment; filename="run-fde75198….html"` |
| 9 | 红线：token 不落浏览器侧 | ✅ | 全部浏览器侧产物（SSE 流、报告体、响应头、cookie 文件）grep 无 `manual-token`；web/ 源码与构建产物无 Bearer/AUTH_TOKEN（前端代理自检 + 本轮 grep） |

## 注记（非 UI 缺陷）

- **引擎域路由观察项**：Q1 问"2026年7月瓷砖事业部库存金额"，引擎答了收入/业绩（`dm_fin_operations_mix_sum_t`，答案零"库存"字样）——E1 手测同款问法（8月）曾正确路由。单样本非确定性，记 M3 前完整回归轮观察项（harness 仓），与本 UI 栈无关（管道全对：SQL 流、答案、done、tokens 全正常）。
- 断线重连以 curl 协议级验证（seq 连续性/零重复可机器断言）；浏览器视觉续显由前端代理对 mock 网关走查覆盖（8df2991），用户可随时按本流程手动过一遍。

## 复现

```bash
# 1. 网关（engine-gateway 目录，env 见 ask.py 头注/manual 台约定）
# 2. BFF：cd server && AUTH_TOKEN=manual-token GATEWAY_URL=http://127.0.0.1:58080 \
#      REPORTS_DIR=<网关报告根> DATA_DIR=./data npm start
# 3. 账号：printf 'Pass\nPass\n' | npm run admin:add <user>
# 4. 浏览器 http://localhost:5173（web/ npm run dev）或 curl 按 #1-#9 顺序
```
