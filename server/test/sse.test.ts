// UI-T4 集成测试：SSE 代理 —— 契约 §4（D15 断线重连双通道透传、done 后关流、心跳行、
// 禁缓冲代理）+ 记账旁路（answer/report/done 落 messages，失败不影响流）。
// mock 上游分帧发送（含 ": ping" 心跳行），断言客户端收到的字节流与上游逐字节一致。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { GATEWAY_TOKEN, hashPw, login, startBff, startMockGateway, type BffHandle, type MockGateway } from "./helpers.ts";

const openBff: BffHandle[] = [];
const openGw: MockGateway[] = [];

afterEach(async () => {
  for (const h of openBff.splice(0)) await h.close();
  for (const g of openGw.splice(0)) await g.close();
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(cond: () => boolean, timeoutMs = 5000, label = "condition"): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(15);
  }
}

const RUN = "run-sse-1";
const frame = (seq: number, type: string, payload: unknown): string =>
  `id: ${seq}\nevent: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;

// ── SSE 测试客户端（原始字节级：不做帧解析，专查透传保真）─────────────────────────────

interface SseClientHandle {
  status: number;
  headers: http.IncomingHttpHeaders;
  chunks: Buffer[];
  ended: Promise<void>;
  destroy(): void;
}

function sseConnect(
  port: number,
  runId: string,
  opts: { cookie: string; lastEventId?: string; after?: number } ,
): Promise<SseClientHandle> {
  return new Promise((resolve, reject) => {
    let path = `/api/tasks/${runId}/events`;
    if (opts.after !== undefined) path += `?after=${opts.after}`;
    const headers: Record<string, string> = { cookie: opts.cookie };
    if (opts.lastEventId !== undefined) headers["last-event-id"] = opts.lastEventId;
    const rq = http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
      const handle: SseClientHandle = {
        status: res.statusCode ?? 0,
        headers: res.headers,
        chunks: [],
        ended: new Promise<void>((resolveEnd) => res.on("end", () => resolveEnd())),
        destroy: () => res.destroy(),
      };
      res.on("data", (c: Buffer) => handle.chunks.push(c));
      res.on("error", () => {});
      // 头已到即可用（立即 flush 的断言基础：chunks 流式增长）
      resolve(handle);
    });
    rq.on("error", reject);
  });
}

async function setup(handler: (req: http.IncomingMessage, res: http.ServerResponse) => void): Promise<{ bff: BffHandle; gw: MockGateway; cookie: string }> {
  const gw = await startMockGateway(handler);
  openGw.push(gw);
  const bff = await startBff({ gatewayUrl: gw.url });
  openBff.push(bff);
  bff.store.upsertUser("zhang", hashPw("correct-horse-9"));
  const sid = (await login(bff.port, "zhang", "correct-horse-9")).sid!;
  return { bff, gw, cookie: `sid=${sid}` };
}

test("SSE 透传：立即开流、chunk 级不缓冲、字节流与上游逐字节一致、done 后关流、途经事件记账", async () => {
  const sent: Buffer[] = [];
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const { bff, gw, cookie } = await setup((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const push = (s: string): void => {
      const b = Buffer.from(s, "utf8");
      sent.push(b);
      res.write(b);
    };
    push(": ping\n\n"); // 心跳注释行（契约 §4：15s 间隔，测试直接发）
    push(frame(1, "stage", { stage: "analyzing", text: "理解问题" }));
    // 挂起：等测试确认前两帧已抵达客户端（证明透传未缓冲）再发后续
    void gate.then(() => {
      push(frame(2, "sql", { sql: "SELECT 1", rows: 3, truncated: false, result_ref: "r-1", elapsed_ms: 5 }));
      push(frame(3, "answer", { markdown: "## 结论\nTOP1：抛光砖 A" }));
      push(frame(4, "report", { path: "reports/sess-1/run-1.html" }));
      push(frame(5, "done", { run_id: RUN, status: "succeeded", engine: "dsh", elapsed_ms: 100, tokens: null, recovered: false }));
      res.end(); // done 后上游关流 → BFF 必须跟着 end
    });
  });

  const ui = bff.store.createUiSession("zhang", "sse 测试");
  bff.store.insertMessage({ uiSessionId: ui.id, runId: RUN, gatewaySessionId: "sess-gw-1", question: "q" });

  const c = await sseConnect(bff.port, RUN, { cookie });
  assert.equal(c.status, 200);
  assert.equal(c.headers["content-type"], "text/event-stream");
  assert.equal(c.headers["cache-control"], "no-cache");

  // 不缓冲：上游还挂着（未发 done），客户端已收到前两帧的原始字节
  await waitFor(() => c.chunks.length > 0 && Buffer.concat(c.chunks).includes(Buffer.from("event: stage")), 3000, "首帧流式到达");
  assert.equal(sent.length, 2, "上游仍在挂起（done 未发）而客户端已收到数据——无聚合缓冲");
  release();

  await c.ended; // done 后流结束
  assert.ok(Buffer.concat(c.chunks).equals(Buffer.concat(sent)), "客户端字节流与上游逐字节一致（含 : ping 行）");

  // 上游收到鉴权头（EventSource 不能设自定义头 → 必须经 BFF 注入）
  const seen = gw.requests.find((r) => r.url === `/api/tasks/${RUN}/events`)!;
  assert.equal(seen.headers.authorization, `Bearer ${GATEWAY_TOKEN}`);
  assert.equal(seen.headers["x-user"], "zhang");

  // 记账旁路：answer/report/done 落 messages 行
  const msg = bff.store.getMessageByRunId(RUN)!;
  assert.equal(msg.answer_md, "## 结论\nTOP1：抛光砖 A");
  assert.equal(msg.report_path, "reports/sess-1/run-1.html");
  assert.equal(msg.status, "succeeded");
});

test("断线重连双通道透传：Last-Event-ID 头与 ?after= 查询参原样到上游（BFF 不解释）", async () => {
  const { bff, gw, cookie } = await setup((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(frame(9, "stage", { stage: "querying" }));
    // 保持开流（模拟进行中任务），测试断言后主动断开
  });

  const c1 = await sseConnect(bff.port, RUN, { cookie, lastEventId: "3" });
  await waitFor(() => gw.requests.some((r) => r.url === `/api/tasks/${RUN}/events`), 3000, "上游收到连接");
  assert.equal(gw.requests.at(-1)!.headers["last-event-id"], "3", "Last-Event-ID 头透传");
  c1.destroy();

  const c2 = await sseConnect(bff.port, RUN, { cookie, after: 7 });
  await waitFor(() => gw.requests.some((r) => r.url === `/api/tasks/${RUN}/events?after=7`), 3000, "上游收到 after= 连接");
  c2.destroy();
});

test("客户端断开 → BFF 销毁上游连接", async () => {
  let upstreamClosed = false;
  const { bff, cookie } = await setup((req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(frame(1, "stage", { stage: "analyzing" }));
    req.on("close", () => (upstreamClosed = true)); // BFF abort 后 mock 侧连接关闭
    // 永不主动关流
  });

  const c = await sseConnect(bff.port, RUN, { cookie });
  await waitFor(() => c.chunks.length > 0, 3000, "首帧到达");
  c.destroy();
  await waitFor(() => upstreamClosed, 3000, "上游连接被销毁（不是挂到超时）");
});

test("上游非 200（404/403）→ 状态与体透传，不伪装成事件流", async () => {
  const { bff, cookie } = await setup((_req, res) => {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "task not found" } }));
  });
  const c = await sseConnect(bff.port, "run-not-exist", { cookie });
  assert.equal(c.status, 404);
  await c.ended;
  assert.deepEqual(JSON.parse(Buffer.concat(c.chunks).toString("utf8")), {
    error: { code: "NOT_FOUND", message: "task not found" },
  });
});

test("记账失败绝不影响透传：无 messages 行的 run 仍完整透传并正常关流", async () => {
  const sent: Buffer[] = [];
  const { bff, cookie } = await setup((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const push = (s: string): void => {
      const b = Buffer.from(s, "utf8");
      sent.push(b);
      res.write(b);
    };
    push(frame(1, "answer", { markdown: "无记账行的回答" }));
    push(frame(2, "done", { run_id: RUN, status: "succeeded" }));
    res.end();
  });

  const c = await sseConnect(bff.port, RUN, { cookie }); // 故意不 insertMessage
  await c.ended;
  assert.ok(Buffer.concat(c.chunks).equals(Buffer.concat(sent)), "记账缺行不影响字节透传");
  assert.equal(bff.store.getMessageByRunId(RUN), undefined);
});

test("网关不可达 → 502 封闭集（events 端点）", async () => {
  const bff = await startBff({ gatewayUrl: "http://127.0.0.1:1" });
  openBff.push(bff);
  bff.store.upsertUser("zhang", hashPw("correct-horse-9"));
  const sid = (await login(bff.port, "zhang", "correct-horse-9")).sid!;

  const c = await sseConnect(bff.port, RUN, { cookie: `sid=${sid}` });
  assert.equal(c.status, 502);
  await c.ended;
  assert.deepEqual(JSON.parse(Buffer.concat(c.chunks).toString("utf8")), {
    error: { code: "BAD_GATEWAY", message: "engine unreachable" },
  });
});
