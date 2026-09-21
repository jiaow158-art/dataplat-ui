// UI-T2/T3/T4：BFF 应用装配 —— 会话门禁 + 账号/Ui 会话路由 + 网关反代 + SSE 代理
// （spec §3 认证、§4 API 面、契约 §4 SSE 语义）。
//
// 身份信任链（契约 §1）：浏览器只信 cookie；req.user 一律由会话门禁从 sessions 表解析注入，
// 绝不读请求体/请求头里的用户自报值——它是反代网关时 X-User 的唯一来源（红线）。
// 错误响应唯一出口 sendError：code/message 封闭集字面量（对齐网关 http.ts 约定）。
import express, { type Express, type Request, type Response } from "express";
import { compare, hash, hashSync } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { basename, join, resolve, sep } from "node:path";
import { readFileSync } from "node:fs";
import type Database from "better-sqlite3";
import { FEEDBACK_CATEGORIES, INCIDENT_STATUSES, type BffStore } from "./db.ts";
import { GatewayClient, GatewayUnreachableError, type GatewayResponse } from "./gateway.ts";
import { SseFrameParser, type SseEvent } from "./sse-parser.ts";
import {
  allTasks,
  dayKey,
  doneEventRows,
  eventsOf,
  getTask,
  oneLine,
  openGwReadonly,
  runIdsByPrefix,
  taskDigest,
  tasksByUser,
  tasksInRange,
  type GwTaskRow,
} from "./gw-audit.ts";

declare module "express-serve-static-core" {
  interface Request {
    /** 会话门禁注入的登录名——反代网关时 X-User 的唯一来源（spec §6.1 红线）。 */
    user?: string;
  }
}

export interface BffConfig {
  gatewayUrl: string;
  /** 网关 Bearer——只从进程 env 读入（红线：不进日志/响应/任何输出）。 */
  authToken: string;
  /** 报告根目录（UI-T7）：与网关 GATEWAY_REPORTS_DIR 同机只读；缺省时 /api/reports 回 500。 */
  reportsDir?: string;
  /** web/ 构建产物目录（M3-T1 方案A 静态托管）：配置时由 BFF 托管前端 + SPA fallback。 */
  staticDir?: string;
  /** 网关 SQLite 库路径（M4-B3/B4 审计与统计只读直连；env GW_DB_PATH。未设置时审计/统计端点 503 GW_DB_UNSET）。 */
  gwDbPath?: string;
  /** 登录失败人为慢响应下限 ms（spec §6.5 防爆破计时，默认 400）。 */
  loginMinFailMs?: number;
  /** 同用户名登录尝试上限（次/分钟，默认 5）。 */
  loginRatePerMin?: number;
}

const SESSION_COOKIE = "sid";
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;

/** 错误响应唯一出口：code/message 都是封闭集字面量——异常细节只进服务端日志。 */
function sendError(res: Response, status: number, code: string, message: string): void {
  if (res.writableEnded) return;
  res.status(status).json({ error: { code, message } });
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 登录限速（内存滑窗：同用户名 N 次/分钟）——与网关 QpmLimiter 同形。单机部署内存态
// 重启丢失可接受：这是防爆破闸门，不是审计口径。
class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  private max: number;
  private windowMs: number;
  constructor(max: number, windowMs = 60_000) {
    this.max = max;
    this.windowMs = windowMs;
  }
  allow(key: string, now: number = Date.now()): boolean {
    const arr = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (arr.length >= this.max) {
      this.hits.set(key, arr);
      return false;
    }
    arr.push(now);
    this.hits.set(key, arr);
    return true;
  }
}

// 未知用户也跑一次同代价 bcrypt 比较（dummy hash），抹平“用户名是否存在”的枚举计时差。
const DUMMY_HASH = hashSync(randomUUID(), 10);

export function createApp(store: BffStore, config: BffConfig): Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  const loginLimiter = new SlidingWindowLimiter(config.loginRatePerMin ?? 5);
  const loginMinFailMs = config.loginMinFailMs ?? 400;
  const gateway = new GatewayClient(config.gatewayUrl, config.authToken);

  // 探活免鉴权（对齐网关：只报 ok，无任务数据）
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // 会话门禁：除 /api/auth/login 与 /api/health 外全部要求有效会话（spec §3）
  app.use("/api", (req, res, next) => {
    if (req.path === "/auth/login" || req.path === "/health") return next();
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const sess = token ? store.findSession(token) : undefined;
    if (!sess || sess.expires_at <= Date.now()) {
      return sendError(res, 401, "UNAUTHORIZED", "login required");
    }
    req.user = sess.username;
    next();
  });

  // ── 账号会话 ──────────────────────────────────────────────────────────────────────

  app.post("/api/auth/login", async (req, res) => {
    const { username, password } = (req.body ?? {}) as { username?: unknown; password?: unknown };
    if (typeof username !== "string" || typeof password !== "string" || !username || !password) {
      return sendError(res, 400, "BAD_REQUEST", "username and password are required");
    }
    if (!loginLimiter.allow(username)) {
      return sendError(res, 429, "RATE_LIMIT", "too many login attempts, retry later");
    }
    const start = Date.now();
    const user = store.getUser(username);
    const ok = await compare(password, user?.password_hash ?? DUMMY_HASH);
    // M4-B2：停用账号与密码错同形 401（不泄露停用状态；bcrypt 已跑，计时口径一致）
    if (!user || !ok || user.disabled === 1) {
      // 统一慢响应：bcrypt 已耗时则补足到下限，失败路径人工 ≥400ms（防爆破计时）
      const remain = loginMinFailMs - (Date.now() - start);
      if (remain > 0) await sleep(remain);
      return sendError(res, 401, "UNAUTHORIZED", "invalid username or password");
    }
    const token = randomBytes(16).toString("hex"); // 128bit 随机
    const now = Date.now();
    store.pruneExpiredSessions(now);
    store.createSession(token, username, now + SESSION_TTL_MS);
    store.recordLogin(username, token.slice(0, 6), now, now + SESSION_TTL_MS); // M4-B6 旁路记账
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS });
    res.json({ username });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      store.deleteSession(token); // 存量语义不动：删 sessions 行（立即可吊销）
      store.markLogout(token, Date.now()); // M4-B6 旁路：login_log 终态（行保留）
    }
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  app.get("/api/me", (req, res) => {
    // M4-B2：前端据此渲染"管理后台"入口（仅 is_admin=1 可见）
    res.json({ username: req.user, is_admin: store.getUser(req.user!)?.is_admin ?? 0 });
  });

  // ── 管理后台 v1（M4-B1/B5/B6）：会话门禁之上叠 admin 守卫 ──────────────────────────
  // 身份仍取自 sessions 解析出的 req.user（信任链不变），再查 users.is_admin 判角色。

  /** 查询 limit：缺省 50；正整数 1..500，否则 400（封闭集）。 */
  const parseLimit = (raw: unknown): number | null => {
    if (raw === undefined) return 50;
    if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
    const n = Number(raw);
    return n >= 1 && n <= 500 ? n : null;
  };

  app.use("/api/admin", (req, res, next) => {
    const u = store.getUser(req.user!);
    if (!u?.is_admin) return sendError(res, 403, "FORBIDDEN", "admin only");
    next();
  });

  // 管理操作留痕查询（B5——B2 界面的数据源；CLI 与程序化入口写入）
  app.get("/api/admin/audit-ops", (req, res) => {
    const limit = parseLimit(req.query.limit);
    if (limit === null) return sendError(res, 400, "BAD_REQUEST", "limit must be an integer between 1 and 500");
    res.json(store.listAdminAudit(limit));
  });

  // 登录史查询（B6 旁路记账的读取面；logout_at NULL=存活/超时）
  app.get("/api/admin/logins", (req, res) => {
    const limit = parseLimit(req.query.limit);
    if (limit === null) return sendError(res, 400, "BAD_REQUEST", "limit must be an integer between 1 and 500");
    const user = req.query.user;
    if (user !== undefined && (typeof user !== "string" || !user)) {
      return sendError(res, 400, "BAD_REQUEST", "user must be a non-empty string");
    }
    res.json(store.listLogins(typeof user === "string" ? user : undefined, limit));
  });

  // ── M4-B2 用户管理（替代 CLI：列表/建号/重置密码/停用启用；写操作全落 admin_audit）────
  // 红线：password_hash 永不出端点——出口形态一律 {username,is_admin,disabled,created_at}。

  const toPublicUser = (u: { username: string; is_admin: number; disabled: number; created_at: number }) => ({
    username: u.username,
    is_admin: u.is_admin,
    disabled: u.disabled,
    created_at: u.created_at,
  });

  /** 建号凭据校验：用户名 trim 后 1..64 位、密码 8..128 位（与 CLI admin:add 同口径）。 */
  const validateNewCredentials = (
    username: unknown,
    password: unknown,
  ): { username: string; password: string } | null => {
    if (typeof username !== "string") return null;
    const name = username.trim();
    if (!name || name.length > 64) return null;
    if (typeof password !== "string" || password.length < 8 || password.length > 128) return null;
    return { username: name, password };
  };

  const validatePassword = (password: unknown): string | null =>
    typeof password === "string" && password.length >= 8 && password.length <= 128 ? password : null;

  app.get("/api/admin/users", (_req, res) => {
    res.json(store.listUsers());
  });

  app.post("/api/admin/users", async (req, res) => {
    const body = (req.body ?? {}) as { username?: unknown; password?: unknown; is_admin?: unknown };
    const creds = validateNewCredentials(body.username, body.password);
    if (!creds) return sendError(res, 400, "BAD_REQUEST", "username (1..64 chars) and password (8..128 chars) are required");
    if (body.is_admin !== undefined && typeof body.is_admin !== "boolean") {
      return sendError(res, 400, "BAD_REQUEST", "is_admin must be a boolean");
    }
    const isAdmin = body.is_admin === true;
    if (store.getUser(creds.username)) return sendError(res, 409, "CONFLICT", "user already exists");
    store.upsertUser(creds.username, await hash(creds.password, 10), { isAdmin });
    store.insertAdminAudit({
      username: req.user!,
      action: "user_create",
      target: creds.username,
      detail: isAdmin ? "is_admin=1" : undefined,
    });
    res.status(201).json(toPublicUser(store.getUser(creds.username)!));
  });

  app.post("/api/admin/users/:name/reset-password", async (req, res) => {
    const password = validatePassword(((req.body ?? {}) as { password?: unknown }).password);
    if (password === null) return sendError(res, 400, "BAD_REQUEST", "password must be 8..128 chars");
    const target = store.getUser(req.params.name);
    if (!target) return sendError(res, 404, "NOT_FOUND", "user not found");
    store.setPassword(target.username, await hash(password, 10));
    store.insertAdminAudit({ username: req.user!, action: "password_reset", target: target.username });
    res.json({ username: target.username });
  });

  /** 停用/启用共用：不能停用自己（唯一防锁死规则——管理员把自己停了就没有解锁的人）。 */
  const setUserDisabled = (req: Request, res: Response, disabled: boolean): void => {
    const target = store.getUser(req.params.name);
    if (!target) return sendError(res, 404, "NOT_FOUND", "user not found");
    if (disabled && target.username === req.user) {
      return sendError(res, 400, "BAD_REQUEST", "cannot disable yourself");
    }
    store.setDisabled(target.username, disabled);
    store.insertAdminAudit({
      username: req.user!,
      action: disabled ? "user_disable" : "user_enable",
      target: target.username,
    });
    res.json(toPublicUser(store.getUser(target.username)!));
  };
  app.post("/api/admin/users/:name/disable", (req, res) => setUserDisabled(req, res, true));
  app.post("/api/admin/users/:name/enable", (req, res) => setUserDisabled(req, res, false));

  // ── 用户反馈闭环·管理面（知识健康治理 §三B）：队列查询 + 流转；每次 PATCH 落 admin_audit ──

  // 队列：倒序；联 messages 按 run_id 带出问题文本（归因时直读用户问了什么）
  app.get("/api/admin/incidents", (req, res) => {
    const limit = parseLimit(req.query.limit);
    if (limit === null) return sendError(res, 400, "BAD_REQUEST", "limit must be an integer between 1 and 500");
    const status = req.query.status;
    if (status !== undefined && (typeof status !== "string" || !(INCIDENT_STATUSES as readonly string[]).includes(status))) {
      return sendError(res, 400, "BAD_REQUEST", `status must be one of ${INCIDENT_STATUSES.join("/")}`);
    }
    res.json(store.listIncidents(typeof status === "string" ? status : undefined, limit));
  });

  /** 流转矩阵（封闭集内才允许）：待归因→修复中/驳回；修复中→已发布/驳回；驳回→待归因；已发布=终态。 */
  const INCIDENT_TRANSITIONS: Record<string, readonly string[]> = {
    待归因: ["修复中", "驳回"],
    修复中: ["已发布", "驳回"],
    驳回: ["待归因"],
    已发布: [],
  };
  const FIX_COMMIT_RE = /^[0-9a-f]{8,40}$/;

  app.patch("/api/admin/incidents/:id", (req, res) => {
    const body = (req.body ?? {}) as { status?: unknown; resolution_note?: unknown; fix_commit?: unknown };
    const cur = store.getIncident(req.params.id);
    if (!cur) return sendError(res, 404, "NOT_FOUND", "incident not found");
    if (body.status === undefined && body.resolution_note === undefined && body.fix_commit === undefined) {
      return sendError(res, 400, "BAD_REQUEST", "nothing to update (status / resolution_note / fix_commit)");
    }
    if (body.status !== undefined && (typeof body.status !== "string" || !(INCIDENT_STATUSES as readonly string[]).includes(body.status))) {
      return sendError(res, 400, "BAD_REQUEST", `status must be one of ${INCIDENT_STATUSES.join("/")}`);
    }
    if (body.resolution_note !== undefined && (typeof body.resolution_note !== "string" || body.resolution_note.length > 500)) {
      return sendError(res, 400, "BAD_REQUEST", "resolution_note must be a string of at most 500 chars");
    }
    if (body.fix_commit !== undefined && (typeof body.fix_commit !== "string" || !FIX_COMMIT_RE.test(body.fix_commit))) {
      return sendError(res, 400, "BAD_REQUEST", "fix_commit must be 8-40 hex chars");
    }

    // 流转约束：status 变更必须在当前状态的可达集内（同值=非流转，放行）
    let nextStatus = cur.status;
    if (typeof body.status === "string" && body.status !== cur.status) {
      if (!(INCIDENT_TRANSITIONS[cur.status] ?? []).includes(body.status)) {
        return sendError(res, 409, "BAD_TRANSITION", `illegal transition ${cur.status} → ${body.status}`);
      }
      nextStatus = body.status;
    }
    // 已发布强制 fix_commit（本次携带或此前在库）
    const nextCommit = body.fix_commit !== undefined ? (body.fix_commit as string) : cur.fix_commit;
    if (nextStatus === "已发布" && !nextCommit) {
      return sendError(res, 400, "BAD_REQUEST", "fix_commit (8-40 hex) is required to mark published");
    }

    const updated = store.updateIncident(cur.id, {
      status: nextStatus,
      resolution_note: body.resolution_note !== undefined ? (body.resolution_note as string) : undefined,
      fix_commit: body.fix_commit !== undefined ? (body.fix_commit as string) : undefined,
    })!;
    store.insertAdminAudit({
      username: req.user!,
      action: "incident_update",
      target: cur.id,
      detail: `${cur.status}→${updated.status}`,
    });
    res.json(updated);
  });

  // ── M4-B3/B4 审计查询与统计（BFF 只读直连网关库；audit.mjs / pilot-daily.mjs 界面化）──
  // GW_DB_PATH 未设置 → 全部 503 GW_DB_UNSET（生产接线由主线执行：env + migrate + pm2）。

  /** 审计端点内部错误（404 等经 withGw 抛出，避免二次写响应）。 */
  class AdminHttpError extends Error {
    status: number;
    code: string;
    constructor(status: number, code: string, message: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  }

  /** 只读打开网关库执行查询并回 JSON：未配置 503；打开失败 500（细节只进服务端日志）。 */
  const withGw = (res: Response, fn: (db: Database.Database) => unknown): void => {
    if (!config.gwDbPath) return sendError(res, 503, "GW_DB_UNSET", "gateway db path not configured");
    let db: Database.Database;
    try {
      db = openGwReadonly(config.gwDbPath);
    } catch (err) {
      console.error(`[admin] 网关库打开失败 path=${config.gwDbPath}:`, err);
      return sendError(res, 500, "INTERNAL", "gateway db unreadable");
    }
    try {
      let out: unknown;
      try {
        out = fn(db);
      } catch (err) {
        if (err instanceof AdminHttpError) return sendError(res, err.status, err.code, err.message);
        throw err;
      }
      res.json(out);
    } finally {
      db.close();
    }
  };

  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /** 时间线任务卡要点（audit.mjs taskCard 的 JSON 形态）。 */
  const taskItem = (gw: Database.Database, t: GwTaskRow) => {
    const d = taskDigest(gw, t);
    return {
      kind: "task" as const,
      ts: t.created_at,
      run_id: t.run_id,
      user: t.user,
      question: t.question,
      status: t.status,
      attempt: t.attempt,
      elapsed_ms: d.elapsedMs,
      elapsed_source: d.elapsedSource,
      sql_count: d.sqlCount,
      sql_rows: d.rowsSeq,
      answer_excerpt: d.answer != null ? oneLine(d.answer, 160) : null,
      report_path: d.reportPath,
      error_code: t.error_code,
      error_message: t.error_message,
    };
  };

  /** YYYY-MM-DD → 本地时区 [t0, t1)；非法返回 null。 */
  const parseDayRange = (date: string): { t0: number; t1: number } | null => {
    if (!DATE_RE.test(date)) return null;
    const t0 = new Date(`${date}T00:00:00`).getTime();
    if (Number.isNaN(t0)) return null;
    return { t0, t1: t0 + 86_400_000 };
  };

  // 按用户：网关任务时间线 + BFF 开户/登录记录并入（since 起本地日键过滤）
  app.get("/api/admin/audit/user", (req, res) => {
    const name = req.query.name;
    if (typeof name !== "string" || !name.trim()) return sendError(res, 400, "BAD_REQUEST", "name is required");
    const since = req.query.since;
    if (since !== undefined && (typeof since !== "string" || !DATE_RE.test(since))) {
      return sendError(res, 400, "BAD_REQUEST", "since must be YYYY-MM-DD");
    }
    const user = name.trim();
    const sinceDay = typeof since === "string" ? since : null;
    withGw(res, (gw) => {
      const items: any[] = [];
      const u = store.getUser(user);
      if (u && (sinceDay === null || dayKey(u.created_at) >= sinceDay)) {
        items.push({ kind: "account", ts: u.created_at });
      }
      for (const l of store.listLogins(user, 500)) {
        if (sinceDay !== null && dayKey(l.created_at) < sinceDay) continue;
        items.push({
          kind: "login",
          ts: l.created_at,
          token_prefix: l.token_prefix,
          expires_at: l.expires_at,
          logout_at: l.logout_at,
        });
      }
      for (const t of tasksByUser(gw, user)) {
        if (sinceDay !== null && dayKey(t.created_at) < sinceDay) continue;
        items.push(taskItem(gw, t));
      }
      items.sort((a, b) => a.ts - b.ts);
      return { user, since: sinceDay, items };
    });
  });

  // 按任务：任务行 + 事件流逐条（payload 已解析）+ BFF 关联（UI 会话/消息记账）
  app.get("/api/admin/audit/run/:runId", (req, res) => {
    withGw(res, (gw) => {
      const t = getTask(gw, req.params.runId);
      if (!t) throw new AdminHttpError(404, "NOT_FOUND", "run not found");
      const d = taskDigest(gw, t);
      const msg = store.getMessageByRunId(t.run_id);
      const ui = msg ? store.getUiSession(msg.ui_session_id) : undefined;
      return {
        task: {
          run_id: t.run_id,
          session_id: t.session_id,
          user: t.user,
          scope_group: t.scope_group,
          question: t.question,
          status: t.status,
          stage: t.stage,
          attempt: t.attempt,
          error_code: t.error_code,
          error_message: t.error_message,
          created_at: t.created_at,
          updated_at: t.updated_at,
          deadline: t.deadline,
        },
        events: eventsOf(gw, t.run_id),
        elapsed_ms: d.elapsedMs,
        report_path: d.reportPath,
        bff: msg
          ? {
              ui_session: ui ? { id: ui.id, title: ui.title, created_at: ui.created_at } : null,
              message: { id: msg.id, status: msg.status, created_at: msg.created_at, report_path: msg.report_path },
            }
          : null,
      };
    });
  });

  // 按日期：当日全员行为一览（网关任务 + BFF 开户/登录/新会话并入时间线）
  app.get("/api/admin/audit/date", (req, res) => {
    const date = req.query.date;
    if (typeof date !== "string") return sendError(res, 400, "BAD_REQUEST", "date is required");
    const range = parseDayRange(date);
    if (!range) return sendError(res, 400, "BAD_REQUEST", "date must be YYYY-MM-DD");
    withGw(res, (gw) => {
      const tasks = tasksInRange(gw, range.t0, range.t1);
      const byStatus: Record<string, number> = {};
      const byUser = new Map<string, number>();
      for (const t of tasks) {
        byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
        byUser.set(t.user, (byUser.get(t.user) ?? 0) + 1);
      }
      const items: any[] = tasks.map((t) => taskItem(gw, t));
      for (const u of store.listUsers()) {
        if (u.created_at >= range.t0 && u.created_at < range.t1) {
          items.push({ kind: "account", ts: u.created_at, username: u.username });
        }
      }
      for (const l of store.listLogins(undefined, 500)) {
        if (l.created_at >= range.t0 && l.created_at < range.t1) {
          items.push({ kind: "login", ts: l.created_at, username: l.username, token_prefix: l.token_prefix, logout_at: l.logout_at });
        }
      }
      for (const s of store.listUiSessionsAll(500)) {
        if (s.created_at >= range.t0 && s.created_at < range.t1) {
          items.push({ kind: "ui_session", ts: s.created_at, username: s.username, title: oneLine(s.title, 60) });
        }
      }
      items.sort((a, b) => a.ts - b.ts);
      return {
        date,
        summary: {
          tasks: tasks.length,
          by_status: byStatus,
          by_user: [...byUser.entries()].map(([user, n]) => ({ user, n })).sort((a, b) => b.n - a.n),
        },
        items,
      };
    });
  });

  // 前缀补全：用户名（BFF）+ run_id（网关）——审计页输入框 datalist
  app.get("/api/admin/audit/suggest", (req, res) => {
    const q = req.query.q;
    if (typeof q !== "string" || !q.trim()) return sendError(res, 400, "BAD_REQUEST", "q is required");
    const prefix = q.trim();
    withGw(res, (gw) => ({
      users: store
        .listUsers()
        .map((u) => u.username)
        .filter((n) => n.startsWith(prefix))
        .slice(0, 10),
      run_ids: runIdsByPrefix(gw, prefix, 10),
    }));
  });

  // ── M4-B4 使用统计（pilot-daily.mjs 聚合 port：总量/分布/tokens/活跃用户/今日/近14天）──
  app.get("/api/admin/stats", (_req, res) => {
    withGw(res, (gw) => {
      const tasks = allTasks(gw);
      const byStatus: Record<string, number> = {};
      for (const t of tasks) byStatus[t.status] = (byStatus[t.status] ?? 0) + 1;
      const nOf = (s: string) => byStatus[s] ?? 0;
      const terminal = nOf("succeeded") + nOf("failed") + nOf("cancelled");

      // tokens：done 事件逐 run 累计（无 done 的任务计不进 tokens，与 pilot-daily 同口径）
      const tokens = { input: 0, output: 0, cache_read: 0 };
      for (const r of doneEventRows(gw)) {
        try {
          const tk = (JSON.parse(r.payload) as { tokens?: Record<string, unknown> })?.tokens ?? {};
          tokens.input += Number(tk.input ?? 0);
          tokens.output += Number(tk.output ?? 0);
          tokens.cache_read += Number(tk.cache_read ?? 0);
        } catch {
          /* 非法 payload 跳过 */
        }
      }

      const today = dayKey(Date.now());
      const todayTasks = tasks.filter((t) => dayKey(t.created_at) === today);
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const daily: { date: string; count: number }[] = [];
      const dailyIdx = new Map<string, number>();
      for (let i = 13; i >= 0; i--) {
        const date = dayKey(dayStart.getTime() - i * 86_400_000);
        dailyIdx.set(date, daily.length);
        daily.push({ date, count: 0 });
      }
      for (const t of tasks) {
        const i = dailyIdx.get(dayKey(t.created_at));
        if (i !== undefined) daily[i].count++;
      }

      const failed = tasks.filter((t) => t.status === "failed" || t.status === "cancelled");
      const failByCode = new Map<string, { count: number; sample: string | null }>();
      for (const t of failed) {
        const k = t.error_code ?? "(无 error_code)";
        const cur = failByCode.get(k) ?? { count: 0, sample: null as string | null };
        cur.count++;
        cur.sample ??= oneLine(t.error_message, 120) || null;
        failByCode.set(k, cur);
      }

      const todayRange = parseDayRange(today)!;
      const newUsers = store.listUsers().filter((u) => u.created_at >= todayRange.t0 && u.created_at < todayRange.t1).length;

      return {
        totals: {
          all: tasks.length,
          succeeded: nOf("succeeded"),
          failed: nOf("failed"),
          cancelled: nOf("cancelled"),
          running: nOf("running"),
          queued: nOf("queued"),
          terminal,
          success_rate_pct: terminal > 0 ? Math.round((nOf("succeeded") / terminal) * 1000) / 10 : null,
        },
        active_users: new Set(tasks.map((t) => t.user)).size,
        tokens,
        today: { date: today, tasks: todayTasks.length, users: [...new Set(todayTasks.map((t) => t.user))], new_users: newUsers },
        daily,
        fail_by_code: [...failByCode.entries()]
          .map(([code, v]) => ({ code, count: v.count, sample_message: v.sample }))
          .sort((a, b) => b.count - a.count),
        failed: failed
          .slice(-100)
          .reverse()
          .map((t) => ({
            run_id: t.run_id,
            user: t.user,
            question: oneLine(t.question, 60),
            status: t.status,
            error_code: t.error_code,
            attempt: t.attempt,
            created_at: t.created_at,
          })),
      };
    });
  });

  // ── 用户反馈闭环·提交面（知识健康治理 §三B）：登录即可（非 admin）──
  // 对话流「有问题」入口：分类封闭集四选一；同 run 同用户同分类 60s 内幂等（不重复落行）。
  const FEEDBACK_DEDUP_MS = 60_000;

  app.post("/api/feedback", (req, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { run_id?: unknown; ui_session_id?: unknown; category?: unknown; description?: unknown };
    if (typeof body.run_id !== "string" || !body.run_id.trim()) {
      return sendError(res, 400, "BAD_REQUEST", "run_id is required");
    }
    if (typeof body.category !== "string" || !(FEEDBACK_CATEGORIES as readonly string[]).includes(body.category)) {
      return sendError(res, 400, "BAD_REQUEST", `category must be one of ${FEEDBACK_CATEGORIES.join("/")}`);
    }
    if (body.description !== undefined && (typeof body.description !== "string" || body.description.length > 500)) {
      return sendError(res, 400, "BAD_REQUEST", "description must be a string of at most 500 chars");
    }
    if (body.ui_session_id !== undefined && typeof body.ui_session_id !== "string") {
      return sendError(res, 400, "BAD_REQUEST", "ui_session_id must be a string");
    }
    // 幂等窗口命中：返回既有行（201，不重复落行）——防手抖双击与前端重试
    const dup = store.findRecentDuplicateIncident(user, body.run_id, body.category, FEEDBACK_DEDUP_MS);
    if (dup) return res.status(201).json(dup);
    res.status(201).json(
      store.insertIncident({
        username: user,
        runId: body.run_id,
        uiSessionId: body.ui_session_id,
        category: body.category,
        description: body.description,
      }),
    );
  });

  // ── UI 会话 CRUD（spec §4：BFF 记账表；只能操作自己的——非本人/不存在统一 404 不泄露存在性）──

  app.get("/api/sessions", (req, res) => {
    res.json(store.listUiSessions(req.user!));
  });

  app.post("/api/sessions", (req, res) => {
    const body = (req.body ?? {}) as { title?: unknown };
    let title = "新会话";
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim()) {
        return sendError(res, 400, "BAD_REQUEST", "title must be a non-empty string");
      }
      title = body.title.trim();
    }
    res.status(201).json(store.createUiSession(req.user!, title));
  });

  app.patch("/api/sessions/:id", (req, res) => {
    const title = ((req.body ?? {}) as { title?: unknown }).title;
    if (typeof title !== "string" || !title.trim()) {
      return sendError(res, 400, "BAD_REQUEST", "title must be a non-empty string");
    }
    const s = store.getUiSession(req.params.id);
    if (!s || s.username !== req.user) return sendError(res, 404, "NOT_FOUND", "session not found");
    res.json(store.renameUiSession(s.id, title.trim()));
  });

  app.delete("/api/sessions/:id", (req, res) => {
    const s = store.getUiSession(req.params.id);
    if (!s || s.username !== req.user) return sendError(res, 404, "NOT_FOUND", "session not found");
    store.deleteUiSession(s.id);
    res.status(204).end();
  });

  // GET /api/sessions/:id/messages（UI-T6 历史回显）：切会话时拉既有问答。纯记账读，
  // 不触网关（任务事实源在网关，此处是 UI 域索引副本——spec §8）。属主语义同上。
  app.get("/api/sessions/:id/messages", (req, res) => {
    const s = store.getUiSession(req.params.id);
    if (!s || s.username !== req.user) return sendError(res, 404, "NOT_FOUND", "session not found");
    res.json(store.listMessages(s.id));
  });

  // ── 网关反代（契约 §2）：X-User/Bearer 注入 + 响应透传 ──────────────────────────────

  /** 网关 JSON 响应透传：状态与体原样（429 两种含义、403 属主拒等文案区分靠网关 message）。 */
  function passThrough(res: Response, r: GatewayResponse): void {
    res.status(r.status).set("Content-Type", String(r.headers["content-type"] ?? "application/json")).end(r.body);
  }

  // POST /api/ask {question, ui_session_id?}（spec §4）：生成契约级幂等键 → 转发网关 → 记账
  app.post("/api/ask", async (req, res) => {
    const user = req.user!;
    const body = (req.body ?? {}) as { question?: unknown; ui_session_id?: unknown };
    if (typeof body.question !== "string" || !body.question.trim()) {
      return sendError(res, 400, "BAD_REQUEST", "question is required");
    }
    let uiSessionId: string | undefined;
    if (body.ui_session_id !== undefined) {
      if (typeof body.ui_session_id !== "string") {
        return sendError(res, 400, "BAD_REQUEST", "ui_session_id must be a string");
      }
      const s = store.getUiSession(body.ui_session_id);
      if (!s || s.username !== user) return sendError(res, 404, "NOT_FOUND", "session not found");
      uiSessionId = s.id;
    }

    // 幂等键（契约 §5 强制）：<user>-<uuid>——user 段封闭跨用户命名空间
    const gwBody: Record<string, string> = {
      question: body.question,
      client_submission_id: `${user}-${randomUUID()}`,
    };
    const followUp = uiSessionId ? store.latestGatewaySessionId(uiSessionId) : null;
    if (followUp) gwBody.session_id = followUp; // 追问（D14：历史注入在网关侧，BFF 零参与）

    let r: GatewayResponse;
    try {
      r = await gateway.request("POST", "/api/tasks", { user, body: gwBody });
    } catch (err) {
      if (!(err instanceof GatewayUnreachableError)) throw err;
      return sendError(res, 502, "BAD_GATEWAY", "engine unreachable");
    }
    if (r.status !== 201) return passThrough(res, r); // 400/401/429 原样透传

    const created = JSON.parse(r.body.toString("utf8")) as { run_id?: string; session_id?: string };
    if (typeof created.run_id !== "string" || typeof created.session_id !== "string") {
      return sendError(res, 502, "BAD_GATEWAY", "invalid gateway response");
    }
    if (!uiSessionId) {
      uiSessionId = store.createUiSession(user, Array.from(body.question.trim()).slice(0, 30).join("")).id;
    } else {
      store.touchUiSession(uiSessionId);
    }
    store.insertMessage({
      uiSessionId,
      runId: created.run_id,
      gatewaySessionId: created.session_id,
      question: body.question,
    });
    res.status(201).json({ run_id: created.run_id, session_id: created.session_id, ui_session_id: uiSessionId });
  });

  // GET /api/tasks/:id（与轮询别名 /status）：以登录身份反代网关任务状态。
  // 403/404 透传——任务属主校验由网关完成（属主≠X-User 网关回 403）。
  const proxyTask = async (req: Request, res: Response): Promise<void> => {
    try {
      const r = await gateway.request("GET", `/api/tasks/${encodeURIComponent(req.params.id)}`, { user: req.user! });
      return passThrough(res, r);
    } catch (err) {
      if (!(err instanceof GatewayUnreachableError)) throw err;
      return sendError(res, 502, "BAD_GATEWAY", "engine unreachable");
    }
  };
  app.get("/api/tasks/:id", proxyTask);
  app.get("/api/tasks/:id/status", proxyTask);

  // ── SSE 代理（契约 §4）：浏览器 EventSource 不能设自定义头 → 必须经 BFF 换登录态 ────
  // Last-Event-ID 头（EventSource 重连自动带）与 ?after= 查询参原样透传，BFF 不解释——
  // 补发/不重不漏语义全在网关。透传是 chunk 级字节管道（禁聚合禁缓冲），记账只是旁路。

  /** 记账旁路（契约 §6 词表子集）：answer/report/done 落 messages 行。 */
  const recordMessageEvent = (runId: string, ev: SseEvent): void => {
    const p = (ev.payload ?? {}) as Record<string, unknown>;
    if (ev.type === "answer" && typeof p.markdown === "string") store.updateMessageAnswer(runId, p.markdown);
    else if (ev.type === "report" && typeof p.path === "string") store.updateMessageReport(runId, p.path);
    else if (ev.type === "done" && typeof p.status === "string") store.updateMessageStatus(runId, p.status);
  };

  app.get("/api/tasks/:id/events", async (req, res) => {
    const user = req.user!;
    const runId = req.params.id;
    const qIdx = req.originalUrl.indexOf("?");
    const qs = qIdx >= 0 ? req.originalUrl.slice(qIdx) : "";
    const lastEventId = req.headers["last-event-id"];
    const upstreamHeaders: Record<string, string> =
      typeof lastEventId === "string" && lastEventId ? { "last-event-id": lastEventId } : {};

    let stream: { response: IncomingMessage; abort: () => void };
    try {
      stream = await gateway.openStream(`/api/tasks/${encodeURIComponent(runId)}/events${qs}`, {
        user,
        headers: upstreamHeaders,
      });
    } catch (err) {
      if (!(err instanceof GatewayUnreachableError)) throw err;
      return sendError(res, 502, "BAD_GATEWAY", "engine unreachable");
    }
    const upstream = stream.response;

    // 上游非 200（403 属主拒/404）：小 JSON 错误体，读全量透传
    if (upstream.statusCode !== 200) {
      const chunks: Buffer[] = [];
      upstream.on("data", (c: Buffer) => chunks.push(c));
      upstream.on("error", () => {
        if (!res.writableEnded) res.end();
      });
      upstream.on("end", () => {
        res
          .status(upstream.statusCode ?? 502)
          .set("Content-Type", String(upstream.headers["content-type"] ?? "application/json"))
          .end(Buffer.concat(chunks));
      });
      return;
    }

    // 立即开流：头先到、每个 chunk 即刻下发（pipe 无聚合；心跳行帮中间层保活）
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.flushHeaders();

    const parser = new SseFrameParser();
    upstream.on("data", (chunk: Buffer) => {
      try {
        for (const ev of parser.feed(chunk)) recordMessageEvent(runId, ev);
      } catch (err) {
        console.error(`[sse] 记账失败 run_id=${runId}:`, err); // 记账绝不影响透传流
      }
    });
    upstream.pipe(res); // 逐 chunk 写出 + 背压；上游 end → res.end()（done 后关流语义）
    upstream.on("error", (err) => {
      console.error(`[sse] 上游流异常 run_id=${runId}:`, err);
      stream.abort();
      if (!res.writableEnded) res.end(); // 客户端按 seq 重连恢复（D15）
    });
    // 客户端断开 → 销毁上游连接（上游未结束时才有意义）
    res.on("close", () => {
      if (!upstream.readableEnded) stream.abort();
    });
  });

  // ── 报告静态服务（UI-T7，spec §4/§6.3/§6.4、契约 §8）───────────────────────────────
  // 三道闸：记账属主（403）→ 网关以本人身份二次确认（403/404 透传）→ 路径遏制（resolve 后
  // 必须在 REPORTS_DIR 内）。HTML 是引擎生成的不可信内容：nosniff + CSP 收紧（留内联脚本
  // ——报告含内联 ECharts），下载走 attachment。
  app.get("/api/reports", async (req, res) => {
    const user = req.user!;
    const runId = req.query.run_id;
    if (typeof runId !== "string" || !runId) return sendError(res, 400, "BAD_REQUEST", "run_id is required");

    const msg = store.getMessageByRunId(runId);
    if (!msg) return sendError(res, 404, "NOT_FOUND", "report not found");
    const ui = store.getUiSession(msg.ui_session_id);
    if (!ui || ui.username !== user) return sendError(res, 403, "FORBIDDEN", "report owner mismatch");
    if (!msg.report_path) return sendError(res, 404, "NOT_FOUND", "report not ready");
    if (!config.reportsDir) return sendError(res, 500, "INTERNAL", "reports dir not configured");

    // 防御纵深：记账可能过期，最终属主判定以网关为准
    let confirmed: GatewayResponse;
    try {
      confirmed = await gateway.request("GET", `/api/tasks/${encodeURIComponent(runId)}`, { user });
    } catch (err) {
      if (!(err instanceof GatewayUnreachableError)) throw err;
      return sendError(res, 502, "BAD_GATEWAY", "engine unreachable");
    }
    if (confirmed.status !== 200) return passThrough(res, confirmed); // 403/404 透传拒绝

    const root = resolve(config.reportsDir);
    const full = resolve(root, msg.report_path);
    if (full !== root && !full.startsWith(root + sep)) {
      console.error(`[reports] 路径越界拒绝 run_id=${runId} path=${msg.report_path}`); // 细节只进服务端日志
      return sendError(res, 404, "NOT_FOUND", "report not found");
    }
    let html: Buffer;
    try {
      html = readFileSync(full);
    } catch {
      return sendError(res, 404, "NOT_FOUND", "report not found");
    }

    res.status(200)
      .set("Content-Type", "text/html; charset=utf-8")
      .set("X-Content-Type-Options", "nosniff")
      .set(
        "Content-Security-Policy",
        "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data:; font-src 'self' data:",
      );
    if (req.query.download === "1") {
      const name = basename(full).replace(/[^\w.\-]+/g, "_") || "report.html";
      res.set("Content-Disposition", `attachment; filename="${name}"`);
    }
    res.end(html);
  });

  // ── 前端静态托管（M3-T1 方案A）：web/ 构建产物 dist 由本端口直出 + SPA fallback ──────
  // 静态壳与资源不走会话门禁（登录页本身要能加载；数据面全在 /api/* 仍受门禁）。
  // fallback 只兜非 /api GET（前端深链刷新回 index.html），API 面照旧走下方 JSON 404。
  if (config.staticDir) {
    app.use(express.static(config.staticDir));
    app.get(/^\/(?!api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(join(config.staticDir!, "index.html"));
    });
  }

  // ── 尾部兜底：未匹配路由 404；异常归一封闭集（Express 默认 HTML 错误页不出网）──────────
  app.use((req, res) => sendError(res, 404, "NOT_FOUND", "no such route"));
  app.use((err: unknown, _req: Request, res: Response, _next: undefined) => {
    console.error("[bff] handler 异常:", err); // 细节只进服务端日志（stderr 红线同款）
    const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
    if (status === 400 || status === 413) return sendError(res, status, "BAD_REQUEST", "invalid request body");
    sendError(res, 500, "INTERNAL", "internal error");
  });

  return app;
}
