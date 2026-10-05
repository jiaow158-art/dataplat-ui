// M-i3 insight 路由（spec §11.2/§13）：flag 门禁（只控入口不做数据权限）+ insight-api 只读代理
// （D6：BFF 不直读 insight.db，只走 HTTP）+ followup 种子编排（Task 3 增补）。
// insight 不可达 → 503 INSIGHT_UNAVAILABLE 封闭集；未开 flag → 403 FLAG_OFF（enabled 端点除外）。
import { Router, type Request, type Response, type NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import type { BffStore } from "./db.ts";

const INSIGHT_TIMEOUT_MS = 5000;

export function insightFetch(base: string, path: string, method = "GET", body?: unknown, user?: string): Promise<{ status: number; body: string }> {
  const u = new URL(base + path);
  return new Promise((resolve, reject) => {
    const rq = httpRequest(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method, timeout: INSIGHT_TIMEOUT_MS,
        headers: { ...(user ? { "X-User": user } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    rq.on("timeout", () => rq.destroy(new Error("insight timeout")));
    rq.on("error", reject);
    rq.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

export function insightRouter(store: BffStore, insightUrl: string | undefined): Router {
  const r = Router();

  const gate = (req: Request, res: Response, next: NextFunction) => {
    if (!store.insightEnabled(req.user!)) {
      res.status(403).json({ error: { code: "FLAG_OFF", message: "insight cockpit not enabled for this account" } });
      return;
    }
    next();
  };

  const proxy = async (res: Response, path: string, req?: Request, method = "GET", body?: unknown) => {
    if (!insightUrl) {
      res.status(503).json({ error: { code: "INSIGHT_UNAVAILABLE", message: "INSIGHT_URL unset" } });
      return;
    }
    try {
      const up = await insightFetch(insightUrl, path, method, body, req?.user);
      res.status(up.status).type("json").send(up.body);
    } catch {
      res.status(503).json({ error: { code: "INSIGHT_UNAVAILABLE", message: "insight api unreachable" } });
    }
  };

  r.get("/enabled", (req, res) => {
    res.json({ enabled: store.insightEnabled(req.user!) });
  });
  r.get("/daily", gate, (req, res) => {
    void proxy(res, `/api/insight/daily${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
  });
  r.get("/events", gate, (req, res) => {
    void proxy(res, `/api/insight/events${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
  });
  r.get("/events/:id/trend", gate, (req, res) => {
    void proxy(res, `/api/insight/events/${encodeURIComponent(req.params.id)}/trend${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
  });
  r.get("/events/:id/related", gate, (req, res) => {
    void proxy(res, `/api/insight/events/${encodeURIComponent(req.params.id)}/related`);
  });
  r.get("/health-score", gate, (_req, res) => {
    void proxy(res, "/api/insight/health-score");
  });
  r.get("/target-overview", gate, (_req, res) => {
    void proxy(res, "/api/insight/target-overview");
  });
  r.get("/events/:id", gate, (req, res) => {
    void proxy(res, `/api/insight/events/${encodeURIComponent(req.params.id)}`);
  });
  r.get("/timeline", gate, (req, res) => {
    void proxy(res, `/api/insight/timeline${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
  });
  r.get("/subscriptions", gate, (req, res) => { void proxy(res, `/api/insight/subscriptions`, req); });
  r.get("/subscriptions/matches", gate, (req, res) => { void proxy(res, `/api/insight/subscriptions/matches`, req); });
  r.post("/subscriptions", gate, (req, res) => { void proxy(res, `/api/insight/subscriptions`, req, "POST", req.body); });
  r.delete("/subscriptions/:id", gate, (req, res) => { void proxy(res, `/api/insight/subscriptions/${encodeURIComponent(req.params.id)}`, req, "DELETE"); });
  r.get("/notifications", gate, (req, res) => { void proxy(res, `/api/insight/notifications${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`, req); });
  r.post("/notifications/:id/read", gate, (req, res) => { void proxy(res, `/api/insight/notifications/${encodeURIComponent(req.params.id)}/read`, req, "POST", {}); });
  r.post("/notifications/read-all", gate, (req, res) => { void proxy(res, `/api/insight/notifications/read-all`, req, "POST", {}); });

  // followup 种子问题编排（M-i3 Task 3，v1.2.4）：拉事件详情 → 组种子问题（背景+已确认事实+
  // 归因+用户意图）→ 建种子 UI 会话（标题=事件标题截 30 字，复用 createUiSession 的 us-<uuid> 形态）
  // → followup_log 审计一行。prompt 可空=默认分析意图；500 字上限截断（防注入长文）。
  r.post("/events/:id/followup", gate, async (req, res) => {
    if (!insightUrl) {
      res.status(503).json({ error: { code: "INSIGHT_UNAVAILABLE", message: "INSIGHT_URL unset" } });
      return;
    }
    const promptRaw = (req.body as { prompt?: unknown } | undefined)?.prompt;
    const prompt = typeof promptRaw === "string" && promptRaw.trim() ? promptRaw.trim().slice(0, 500) : null;
    const eventId = req.params.id;
    let detail: {
      event?: { title?: string; summary?: string; metric?: string; scope_json?: string; period_json?: string; facts_json?: string };
      attribution?: { summary?: string };
    };
    try {
      const up = await insightFetch(insightUrl, `/api/insight/events/${encodeURIComponent(eventId)}`);
      if (up.status === 404) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "event not found" } });
        return;
      }
      if (up.status !== 200) throw new Error(`insight ${up.status}`);
      detail = JSON.parse(up.body);
    } catch {
      res.status(503).json({ error: { code: "INSIGHT_UNAVAILABLE", message: "insight api unreachable" } });
      return;
    }
    const ev = detail.event ?? {};
    let facts: Array<{ label?: string; value?: string }> = [];
    let scope: Record<string, string> = {};
    let period: Record<string, string> = {};
    try {
      facts = JSON.parse(ev.facts_json ?? "[]");
      scope = JSON.parse(ev.scope_json ?? "{}");
      period = JSON.parse(ev.period_json ?? "{}");
    } catch {
      /* insight 侧 JSON 已在其落库时序列化——坏 JSON 按空处理，不炸请求 */
    }
    const seedQuestion = [
      "【经营事件背景（来自 AI 经营驾驶舱，数据已经确定性检测确认）】",
      `事件：${ev.title ?? eventId}`,
      `摘要：${ev.summary ?? ""}`,
      `指标：${ev.metric ?? ""}｜范围：${scope["范围"] ?? "瓷砖事业部"}｜涉及期间：${period["类型"] ?? "月"}`,
      `已确认事实：${facts.map((f) => `${f.label}=${f.value}`).join("；") || "（见摘要）"}`,
      `归因结论：${detail.attribution?.summary ?? "（归因生成中）"}`,
      "",
      prompt ?? "请基于以上事件背景做进一步分析。",
    ].join("\n");
    const title = (ev.title ?? eventId).slice(0, 30);
    const uiSessionId = store.createUiSession(req.user!, title).id;
    store.insertFollowup(`fu-${randomUUID().slice(0, 12)}`, req.user!, eventId, uiSessionId, prompt);
    res.status(200).json({ uiSessionId, seedQuestion, title });
  });
  return r;
}
