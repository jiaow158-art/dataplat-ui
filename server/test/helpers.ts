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

export async function startBff(
  opts: { gatewayUrl?: string; reportsDir?: string; staticDir?: string; gwDbPath?: string; harnessDir?: string; insightUrl?: string } = {},
): Promise<BffHandle> {
  const root = mkdtempSync(join(tmpdir(), "bff-test-"));
  const db = initDb(root);
  const store = new BffStore(db);
  const app = createApp(store, {
    gatewayUrl: opts.gatewayUrl ?? "http://127.0.0.1:1", // 缺省指向必然不可达端口（Task2 不触网关）
    authToken: GATEWAY_TOKEN,
    reportsDir: opts.reportsDir, // UI-T7 报告静态服务根目录（不传 = 端点 500）
    staticDir: opts.staticDir, // M3-T1 静态托管（不传 = 无托管，原行为）
    gwDbPath: opts.gwDbPath, // M4-B3/B4 网关库只读直连（不传 = 审计/统计 503 GW_DB_UNSET）
    harnessDir: opts.harnessDir, // 知识库管理入口（不传 = 知识端点 503 HARNESS_DIR_UNSET）
    insightUrl: opts.insightUrl, // M-i3 insight-api 代理（不传 = insight 端点 503 INSIGHT_UNAVAILABLE）
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

// ── 网关库 fixture（M4-B3/B4 用：按 engine-gateway src/store/schema.sql 的
//    tasks/events/publications 表结构造最小数据；测试不依赖真网关进程）───────────────────

/** 与 engine-gateway src/store/schema.sql 同构（字段与约束逐字对齐，勿改单边）。 */
const GW_SCHEMA = `
CREATE TABLE IF NOT EXISTS tasks (
  run_id TEXT PRIMARY KEY,
  client_submission_id TEXT,
  session_id TEXT NOT NULL,
  user TEXT NOT NULL, scope_group TEXT NOT NULL DEFAULT 'default',
  question TEXT NOT NULL,
  status TEXT NOT NULL,
  stage TEXT,
  attempt INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT, lease_expires_at INTEGER,
  cancel_requested INTEGER NOT NULL DEFAULT 0,
  deadline INTEGER,
  error_code TEXT, error_message TEXT,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
  UNIQUE(client_submission_id)
);
CREATE TABLE IF NOT EXISTS events (
  run_id TEXT NOT NULL, seq INTEGER NOT NULL,
  type TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY(run_id, seq)
);
CREATE TABLE IF NOT EXISTS publications (
  run_id TEXT PRIMARY KEY, report_path TEXT NOT NULL, published_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tasks_session ON tasks(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
`;

export interface GwFixtureTask {
  run_id: string;
  session_id?: string;
  user: string;
  question: string;
  status: string;
  stage?: string | null;
  attempt?: number;
  error_code?: string | null;
  error_message?: string | null;
  created_at: number;
  updated_at?: number;
}

export interface GwFixtureEvent {
  seq: number;
  type: string;
  payload: unknown;
  created_at: number;
}

/** 事件集两种形态：{run_id: [events]} 映射，或带 run_id 的事件数组。 */
export type GwFixtureEvents = Record<string, GwFixtureEvent[]> | (GwFixtureEvent & { run_id: string })[];

/** 建网关库 fixture 并写入任务/事件/发布行；返回库文件路径（写完即关，只读打开由被测端做）。 */
export function buildGwFixture(
  dir: string,
  tasks: GwFixtureTask[],
  events: GwFixtureEvents,
  publications: { run_id: string; report_path: string; published_at?: number }[] = [],
): string {
  const file = join(dir, "gateway.db");
  const db = new Database(file);
  try {
    db.exec(GW_SCHEMA);
    const insTask = db.prepare(
      `INSERT INTO tasks (run_id, client_submission_id, session_id, user, scope_group, question, status, stage,
                          attempt, lease_owner, lease_expires_at, cancel_requested, deadline, error_code, error_message,
                          created_at, updated_at)
       VALUES (?, NULL, ?, ?, 'default', ?, ?, ?, ?, NULL, NULL, 0, NULL, ?, ?, ?, ?)`,
    );
    for (const t of tasks) {
      insTask.run(
        t.run_id,
        t.session_id ?? `sess-${t.run_id}`,
        t.user,
        t.question,
        t.status,
        t.stage ?? null,
        t.attempt ?? 1,
        t.error_code ?? null,
        t.error_message ?? null,
        t.created_at,
        t.updated_at ?? t.created_at,
      );
    }
    const insEvent = db.prepare("INSERT INTO events (run_id, seq, type, payload, created_at) VALUES (?, ?, ?, ?, ?)");
    const eventList: (GwFixtureEvent & { run_id: string })[] = Array.isArray(events)
      ? events
      : Object.entries(events).flatMap(([runId, evs]) => evs.map((e) => ({ run_id: runId, ...e })));
    for (const e of eventList) {
      insEvent.run(e.run_id, e.seq, e.type, JSON.stringify(e.payload ?? null), e.created_at);
    }
    const insPub = db.prepare("INSERT INTO publications (run_id, report_path, published_at) VALUES (?, ?, ?)");
    for (const p of publications) insPub.run(p.run_id, p.report_path, p.published_at ?? 0);
  } finally {
    db.close();
  }
  return file;
}

export interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/** 标准网关 fixture（M4-B3/B4 测试共用）：zhang/li 两用户、四任务（今日 succeeded+failed+queued、
 *  昨日 succeeded）、逐类事件（stage/sql/answer/report/done/error）与一条发布记录。
 *  时间一律本地时区相对锚点（今日/昨日），跨时区跑测不漂移。 */
export function buildStandardGwFixture(dir: string): {
  file: string;
  today: string;
  yesterday: string;
  aaa: number;
  bbb: number;
  ccc: number;
  ddd: number;
} {
  const at = (dayOffset: number, h: number, m: number): number => {
    const d = new Date();
    d.setDate(d.getDate() + dayOffset);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const dayKey = (ms: number): string => {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const aaa = at(0, 10, 0);
  const bbb = at(0, 11, 0);
  const ccc = at(-1, 15, 0);
  const ddd = at(0, 9, 0);
  const file = buildGwFixture(
    dir,
    [
      {
        run_id: "run-aaa-1111",
        user: "zhang",
        question: "本月瓷砖销量如何",
        status: "succeeded",
        stage: "publishing",
        created_at: aaa,
        updated_at: aaa + 5 * 60_000,
      },
      {
        run_id: "run-bbb-2222",
        user: "zhang",
        question: "库存账龄分布",
        status: "failed",
        attempt: 2,
        error_code: "ENGINE_TIMEOUT",
        error_message: "执行超时",
        created_at: bbb,
        updated_at: bbb + 2 * 60_000,
      },
      {
        run_id: "run-ccc-3333",
        user: "li",
        question: "应收逾期汇总",
        status: "succeeded",
        created_at: ccc,
        updated_at: ccc + 60_000,
      },
      { run_id: "run-ddd-4444", user: "li", question: "新任务排队中", status: "queued", attempt: 0, created_at: ddd },
    ],
    {
      "run-aaa-1111": [
        { seq: 1, type: "stage", payload: { stage: "analyzing", text: "解析问题" }, created_at: aaa },
        {
          seq: 2,
          type: "sql",
          payload: { sql: "SELECT count(*) FROM dm_fin_sales", rows: 5, truncated: false, result_ref: "ref://aaa-1", elapsed_ms: 1200 },
          created_at: aaa + 60_000,
        },
        {
          seq: 3,
          type: "sql",
          payload: { sql: "SELECT * FROM dm_fin_stock", rows: 0, truncated: true, result_ref: "ref://aaa-2", elapsed_ms: 800 },
          created_at: aaa + 120_000,
        },
        { seq: 4, type: "answer", payload: { markdown: "## 结论\n瓷砖销量上升 12%，主要来自华南区域。" }, created_at: aaa + 240_000 },
        { seq: 5, type: "report", payload: { path: "reports/run-aaa-1111.html" }, created_at: aaa + 240_000 },
        {
          seq: 6,
          type: "done",
          payload: { run_id: "run-aaa-1111", status: "succeeded", engine: "dsh", elapsed_ms: 300_000, tokens: { input: 1200, output: 350, cache_read: 8000 }, recovered: false },
          created_at: aaa + 300_000,
        },
      ],
      "run-bbb-2222": [
        { seq: 1, type: "stage", payload: { stage: "querying" }, created_at: bbb },
        { seq: 2, type: "error", payload: { code: "ENGINE_TIMEOUT", message: "执行超时" }, created_at: bbb + 120_000 },
      ],
      "run-ccc-3333": [
        {
          seq: 1,
          type: "sql",
          payload: { sql: "SELECT * FROM dwr_ar_account", rows: 3, truncated: false, elapsed_ms: 900 },
          created_at: ccc,
        },
        {
          seq: 2,
          type: "done",
          payload: { run_id: "run-ccc-3333", status: "succeeded", engine: "dsh", elapsed_ms: 60_000, tokens: { input: 100, output: 50, cache_read: 200 }, recovered: false },
          created_at: ccc + 60_000,
        },
      ],
    },
    [{ run_id: "run-aaa-1111", report_path: "reports/run-aaa-1111.html", published_at: aaa + 240_000 }],
  );
  return { file, today: dayKey(aaa), yesterday: dayKey(ccc), aaa, bbb, ccc, ddd };
}

// ── mock 网关（Task3/4 用：捕获收到的请求供断言；行为由 handler 决定）──────────────────

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
