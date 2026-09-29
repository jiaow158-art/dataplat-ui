// M-i3 insight 路由（spec §11.2/§13）：flag 门禁（只控入口不做数据权限）+ insight-api 只读代理
// （D6：BFF 不直读 insight.db，只走 HTTP）+ followup 种子编排（Task 3 增补）。
// insight 不可达 → 503 INSIGHT_UNAVAILABLE 封闭集；未开 flag → 403 FLAG_OFF（enabled 端点除外）。
import { Router, type Request, type Response, type NextFunction } from "express";
import { request as httpRequest } from "node:http";
import type { BffStore } from "./db.ts";

const INSIGHT_TIMEOUT_MS = 5000;

export function insightFetch(base: string, path: string): Promise<{ status: number; body: string }> {
  const u = new URL(base + path);
  return new Promise((resolve, reject) => {
    const rq = httpRequest(
      { hostname: u.hostname, port: u.port || 80, path: u.pathname + u.search, method: "GET", timeout: INSIGHT_TIMEOUT_MS },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode!, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    rq.on("timeout", () => rq.destroy(new Error("insight timeout")));
    rq.on("error", reject);
    rq.end();
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

  const proxy = async (res: Response, path: string) => {
    if (!insightUrl) {
      res.status(503).json({ error: { code: "INSIGHT_UNAVAILABLE", message: "INSIGHT_URL unset" } });
      return;
    }
    try {
      const up = await insightFetch(insightUrl, path);
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
  r.get("/events/:id", gate, (req, res) => {
    void proxy(res, `/api/insight/events/${encodeURIComponent(req.params.id)}`);
  });
  r.get("/timeline", gate, (req, res) => {
    void proxy(res, `/api/insight/timeline${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
  });
  return r;
}
