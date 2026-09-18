// UI-T2/T3/T4：BFF 应用装配 —— 会话门禁 + 账号/Ui 会话路由 + 网关反代 + SSE 代理
// （spec §3 认证、§4 API 面、契约 §4 SSE 语义）。
//
// 身份信任链（契约 §1）：浏览器只信 cookie；req.user 一律由会话门禁从 sessions 表解析注入，
// 绝不读请求体/请求头里的用户自报值——它是反代网关时 X-User 的唯一来源（红线）。
// 错误响应唯一出口 sendError：code/message 封闭集字面量（对齐网关 http.ts 约定）。
import express, { type Express, type Request, type Response } from "express";
import { compare, hashSync } from "bcryptjs";
import { randomBytes, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { BffStore } from "./db.ts";
import { GatewayClient, GatewayUnreachableError, type GatewayResponse } from "./gateway.ts";
import { SseFrameParser, type SseEvent } from "./sse-parser.ts";

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
