// UI-T2 起共用的测试脚手架：临时目录建库 + 真监听端口 BFF + mock 网关 + HTTP 请求工具。
// 红线对齐：AUTH_TOKEN 只进请求头（GATEWAY_TOKEN 常量），断言/输出绝不打印其值以外的东西；
// 测试不依赖真网关/真 DWS——上游一律 mock（http.createServer）。
import http from "node:http";
import type { AddressInfo } from "node:net";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashSync } from "bcryptjs";
import { createApp } from "../src/app.ts";
import { BffStore, initDb } from "../src/db.ts";

/** 测试用网关 Bearer（与真值无关；红线：仅用于拼 Authorization 头）。 */
export const GATEWAY_TOKEN = "test-gw-token";

// ── HTTP 请求工具（对齐 engine-gateway http.test.ts 的 request 形态 + cookie 支持）────

export interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: any;
  raw: string;
  rawBuf: Buffer;
}

export function request(
  port: number,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; headers?: Record<string, string> } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.cookie) headers.cookie = opts.cookie;
    const payload = opts.body === undefined ? null : JSON.stringify(opts.body);
    if (payload !== null) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(payload).toString();
    }
    const rq = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const rawBuf = Buffer.concat(chunks);
        const raw = rawBuf.toString("utf8");
        let body: any = raw;
        try {
          body = JSON.parse(raw);
        } catch {
          /* 非 JSON 原样返回 */
        }
        resolve({ status: res.statusCode!, headers: res.headers, body, raw, rawBuf });
      });
    });
    rq.on("error", reject);
    if (payload !== null) rq.write(payload);
    rq.end();
  });
}

/** 登录捷径；返回值附解析出的 sid（set-cookie 里 32 位 hex）。 */
export async function login(port: number, username: string, password: string): Promise<HttpResponse & { sid?: string }> {
  const res = await request(port, "POST", "/api/auth/login", { body: { username, password } });
  const setCookies = res.headers["set-cookie"] ?? [];
  const sid = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .flatMap((c) => [/sid=([0-9a-f]{32})/.exec(c ?? "")])
    .find((m) => m !== null)?.[1];
  return { ...res, sid };
}

export const hashPw = (pw: string): string => hashSync(pw, 10);

// ── BFF 组装（每测试独立：临时目录 + 内存外置 SQLite + 临时端口）──────────────────────

export interface BffHandle {
  port: number;
  store: BffStore;
  db: Database.Database;
  close(): Promise<void>;
}

export async function startBff(opts: { gatewayUrl?: string; reportsDir?: string } = {}): Promise<BffHandle> {
  const root = mkdtempSync(join(tmpdir(), "bff-test-"));
  const db = initDb(root);
  const store = new BffStore(db);
  const app = createApp(store, {
    gatewayUrl: opts.gatewayUrl ?? "http://127.0.0.1:1", // 缺省指向必然不可达端口（Task2 不触网关）
    authToken: GATEWAY_TOKEN,
    reportsDir: opts.reportsDir, // UI-T7 报告静态服务根目录（不传 = 端点 500）
  });
  const server = app.listen(0, "127.0.0.1");
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.on("listening", () => resolve((server.address() as AddressInfo).port));
  });
  return {
    port,
    store,
    db,
    close: async () => {
      server.close();
      server.closeAllConnections?.(); // 挂住 close() 的长连接直接断开
      db.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// ── mock 网关（Task3/4 用：捕获收到的请求供断言；行为由 handler 决定）──────────────────

export interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export interface MockGateway {
  port: number;
  url: string;
  requests: CapturedRequest[];
  /** 运行中替换行为（默认 404 封闭集）。 */
  setHandler(h: (req: http.IncomingMessage, res: http.ServerResponse) => void): void;
  close(): Promise<void>;
}

export async function startMockGateway(
  handler?: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<MockGateway> {
  const requests: CapturedRequest[] = [];
  let current = handler;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      requests.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks).toString("utf8") });
      if (current) current(req, res);
      else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such route" } }));
      }
    });
  });
  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    requests,
    setHandler: (h) => (current = h),
    close: async () => {
      server.close();
      server.closeAllConnections?.();
    },
  };
}
