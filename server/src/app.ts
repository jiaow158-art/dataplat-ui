// UI-T2：BFF 应用装配 —— 会话门禁 + 账号/Ui 会话路由（spec §3 认证、§4 API 面）。
// 网关反代（/api/ask、/api/tasks*、SSE）在 UI-T3/T4 增补。
//
// 身份信任链（契约 §1）：浏览器只信 cookie；req.user 一律由会话门禁从 sessions 表解析注入，
// 绝不读请求体/请求头里的用户自报值——它是反代网关时 X-User 的唯一来源（红线）。
// 错误响应唯一出口 sendError：code/message 封闭集字面量（对齐网关 http.ts 约定）。
import express, { type Express, type Request, type Response } from "express";
import { compare, hashSync } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto"; // randomUUID 供 UI-T3 client_submission_id
import type { BffStore } from "./db.ts";

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
    if (!user || !ok) {
      // 统一慢响应：bcrypt 已耗时则补足到下限，失败路径人工 ≥400ms（防爆破计时）
      const remain = loginMinFailMs - (Date.now() - start);
      if (remain > 0) await sleep(remain);
      return sendError(res, 401, "UNAUTHORIZED", "invalid username or password");
    }
    const token = randomBytes(16).toString("hex"); // 128bit 随机
    store.pruneExpiredSessions(Date.now());
    store.createSession(token, username, Date.now() + SESSION_TTL_MS);
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS });
    res.json({ username });
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) store.deleteSession(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(204).end();
  });

  app.get("/api/me", (req, res) => {
    res.json({ username: req.user });
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
