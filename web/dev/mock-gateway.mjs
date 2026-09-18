// 前端开发用 mock engine-gateway（无真实 dsh/DWS）：脚本化 SSE 事件序列。
// 用法：node dev/mock-gateway.mjs [port=58080]，BFF GATEWAY_URL 指向它即可。
// 实现契约子集：POST /api/tasks、GET /api/tasks/:id、GET /api/tasks/:id/events（SSE，
// 支持 ?after= / Last-Event-ID 重放补发，done 后关流）、GET /api/health。
// 情绪开关：问题含「失败」→ error+done(failed)；含「慢」→ 事件间隔 3s（观察重连/计时）。
import http from "node:http";

const port = Number(process.argv[2] ?? 58080);
let seqCounter = 0;

function buildScript(question) {
  if (question.includes("失败")) {
    return [
      ["stage", { stage: "analyzing", attempt: 1 }],
      ["stage", { stage: "querying" }],
      ["sql", { sql: "SELECT 1 FROM dm_fin_stock LIMIT 200", rows: 200, truncated: true, elapsed_ms: 210 }],
      ["error", { code: "ENGINE_ERROR", message: "引擎执行失败（mock 演示）" }],
      ["done", { run_id: "", status: "failed", engine: "mock", elapsed_ms: 2400, tokens: null, recovered: false }],
    ];
  }
  const q = question.replace(/[<>]/g, "");
  return [
    ["stage", { stage: "analyzing", attempt: 1 }],
    ["stage", { stage: "querying" }],
    ["sql", { sql: `-- mock：理解「${q}」后生成的查询\nSELECT material___t, plant, qty, amount\nFROM dm.dm_fin_stock_detail_accage_t\nWHERE ym = '202508' AND node_desc2 = '瓷砖事业部'\nORDER BY amount DESC\nLIMIT 12;`, rows: 12, truncated: false, elapsed_ms: 342 }],
    ["stage", { stage: "script_running" }],
    ["sql", { sql: "SELECT node_desc3, SUM(amount) AS amt FROM dm.dm_fin_stock_detail_accage_t WHERE ym = '202508' GROUP BY 1 ORDER BY 2 DESC LIMIT 5;", rows: 5, truncated: false, elapsed_ms: 118 }],
    ["stage", { stage: "report_checking" }],
    ["answer", { markdown: `## 结论\n\n**「${q}」** 的 mock 分析结果：\n\n| 维度 | 数值 | 环比 |\n|---|---:|---:|\n| A 事业部 | 1,204 万 | +3.2% |\n| B 事业部 | 986 万 | -1.1% |\n\n- 要点一：TOP3 集中度 47%\n- 要点二：库龄结构健康\n\n> 说明：本回答由 mock 网关生成，仅用于前端联调。\n` }],
    ["report", { path: "" }],
    ["stage", { stage: "publishing" }],
    ["done", { run_id: "", status: "succeeded", engine: "mock", elapsed_ms: 8123, tokens: { input: 2100, output: 640, cache_read: 900 }, recovered: false }],
  ];
}

const tasks = new Map();

function advance(task) {
  if (task.cursor >= task.script.length) return;
  const [event, payload] = task.script[task.cursor];
  const p = { ...payload };
  if (event === "done") p.run_id = task.runId;
  if (event === "report") p.path = `${task.sessionId}/${task.runId}.html`;
  task.seq += 1;
  task.log.push({ seq: task.seq, event, data: JSON.stringify(p) });
  task.cursor += 1;
  if (event === "done") {
    task.status = p.status;
    clearInterval(task.timer);
  }
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const body = Buffer.concat(chunks).toString("utf8");
    const u = new URL(req.url, "http://x");

    if (u.pathname === "/api/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ok: true, queue_depth: 0, running: [...tasks.values()].filter((t) => t.status === "running").length }));
    }
    if (!req.headers.authorization) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "missing bearer" } }));
    }
    if (!req.headers["x-user"]) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { code: "BAD_REQUEST", message: "missing X-User" } }));
    }

    if (req.method === "POST" && u.pathname === "/api/tasks") {
      const b = JSON.parse(body || "{}");
      if (typeof b.question !== "string" || !b.question.trim()) {
        res.writeHead(400, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { code: "BAD_REQUEST", message: "question is required" } }));
      }
      seqCounter += 1;
      const runId = `run-mock-${String(seqCounter).padStart(4, "0")}`;
      const sessionId = typeof b.session_id === "string" && b.session_id ? b.session_id : `sess-mock-${seqCounter}`;
      const slow = b.question.includes("慢");
      const task = {
        runId,
        sessionId,
        script: buildScript(b.question),
        cursor: 0,
        seq: 0,
        log: [],
        status: "running",
        stage: "queued",
        created: Date.now(),
      };
      task.timer = setInterval(() => advance(task), slow ? 3000 : 800);
      tasks.set(runId, task);
      res.writeHead(201, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ run_id: runId, session_id: sessionId }));
    }

    const m = /^\/api\/tasks\/([^/]+)(\/events)?$/.exec(u.pathname);
    const task = m ? tasks.get(decodeURIComponent(m[1])) : undefined;
    if (!task) {
      res.writeHead(404, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: { code: "NOT_FOUND", message: "task not found" } }));
    }

    if (m[2] === "/events") {
      const afterHeader = Number(req.headers["last-event-id"] ?? 0);
      const afterQ = Number(u.searchParams.get("after") ?? 0);
      const after = Number.isFinite(afterHeader) && afterHeader > 0 ? afterHeader : Number.isFinite(afterQ) ? afterQ : 0;
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      let last = after;
      const pump = () => {
        for (const e of task.log) {
          if (e.seq <= last) continue;
          last = e.seq;
          res.write(`id: ${e.seq}\nevent: ${e.event}\ndata: ${e.data}\n\n`);
        }
        if (task.status !== "running" && last >= task.seq) res.end(); // done 后关流
      };
      pump();
      const iv = setInterval(pump, 200);
      const ping = setInterval(() => res.write(": ping\n\n"), 15000);
      res.on("close", () => {
        clearInterval(iv);
        clearInterval(ping);
      });
      return;
    }

    const lastStage = [...task.log].reverse().find((e) => e.event === "stage");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        run_id: task.runId,
        session_id: task.sessionId,
        status: task.status,
        stage: lastStage ? JSON.parse(lastStage.data).stage : "queued",
        attempt: 1,
        error_code: null,
        created_at: task.created,
      }),
    );
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[mock-gateway] listening on http://127.0.0.1:${port}`);
});
