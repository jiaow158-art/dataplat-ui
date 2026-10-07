// UI-T3 集成测试：网关反代 + ask 提交 —— 契约 §2（POST /api/tasks 请求头/体/响应透传）、
// §5 幂等（client_submission_id=<user>-<uuid> 契约级生成规则）、§1 身份信任链（X-User 只来自
// 登录态，伪造头被忽略）。上游一律 mock 网关；不可达用例打必然无监听的端口。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GATEWAY_TOKEN, hashPw, login, request, startBff, startMockGateway, type BffHandle, type MockGateway } from "./helpers.ts";

const openBff: BffHandle[] = [];
const openGw: MockGateway[] = [];

afterEach(async () => {
  for (const h of openBff.splice(0)) await h.close();
  for (const g of openGw.splice(0)) await g.close();
});

async function setup(opts: { handler?: (req: any, res: any) => void; titleGen?: (q: string) => Promise<string | null> } = {}): Promise<{ bff: BffHandle; gw: MockGateway; sid: string }> {
  const gw = await startMockGateway(opts.handler);
  openGw.push(gw);
  const bff = await startBff({ gatewayUrl: gw.url, titleGen: opts.titleGen ?? (async () => null) }); // 缺省不出网（防真实 LLM 调用）
  openBff.push(bff);
  bff.store.upsertUser("zhang", hashPw("correct-horse-9"));
  const sid = (await login(bff.port, "zhang", "correct-horse-9")).sid!;
  return { bff, gw, sid };
}

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

// ── mock 网关行为 ──────────────────────────────────────────────────────────────────

const gwCreateOk = (req: any, res: any): void => {
  res.writeHead(201, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ run_id: "run-0001", session_id: "sess-gw-1" }));
};

test("ask 无 ui_session_id：自动建 UI 会话（P4 起初始「新会话」）、messages 记账、submission_id=<user>-<uuid>", async () => {
  const { bff, gw, sid } = await setup({ handler: gwCreateOk, titleGen: async () => null });
  const question = "2024年Q3瓷砖事业部库存跌价准备TOP10的物料明细和金额分布是怎样的";
  const res = await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question } });

  assert.equal(res.status, 201);
  assert.deepEqual(
    { run_id: res.body.run_id, session_id: res.body.session_id },
    { run_id: "run-0001", session_id: "sess-gw-1" },
    "网关响应体透传",
  );
  assert.match(res.body.ui_session_id ?? "", /^us-/);

  // 网关侧收到的请求（契约 §2 头 + §5 幂等键）
  const seen = gw.requests.find((r) => r.url === "/api/tasks")!;
  assert.equal(seen.method, "POST");
  assert.equal(seen.headers.authorization, `Bearer ${GATEWAY_TOKEN}`);
  assert.equal(seen.headers["x-user"], "zhang");
  const gwBody = JSON.parse(seen.body);
  assert.equal(gwBody.question, question);
  assert.match(gwBody.client_submission_id, new RegExp(`^zhang-${UUID_RE.source}$`), "契约级生成规则 <user>-<uuid>");
  assert.equal(gwBody.session_id, undefined, "首问不带 session_id（网关开新逻辑会话）");

  // BFF 记账
  const ui = bff.store.getUiSession(res.body.ui_session_id)!;
  assert.ok(ui, "自动建 UI 会话");
  assert.equal(ui.username, "zhang");
  assert.equal(ui.title, "新会话", "P4 裁定 a：首问初始「新会话」，异步 LLM 标题另行落库");
  assert.equal(ui.title_source, "default");
  const msg = bff.store.getMessageByRunId("run-0001")!;
  assert.ok(msg, "messages 记账");
  assert.equal(msg.ui_session_id, res.body.ui_session_id);
  assert.equal(msg.gateway_session_id, "sess-gw-1");
  assert.equal(msg.question, question);
  assert.equal(msg.status, "queued");
});

test("ask 带 ui_session_id：追问透传该会话最近一次的网关 session_id（D14 历史注入），记账追加", async () => {
  const { bff, gw, sid } = await setup({ handler: gwCreateOk });

  // 首问：网关回 sess-gw-1
  const r1 = await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question: "第一问" } });
  assert.equal(r1.status, 201);

  // 追问：同 ui_session_id（mock 改回新 run）
  gw.setHandler((req, res) => {
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ run_id: "run-0002", session_id: "sess-gw-1" }));
  });
  const r2 = await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question: "追问", ui_session_id: r1.body.ui_session_id } });
  assert.equal(r2.status, 201);

  const seen = gw.requests.filter((r) => r.url === "/api/tasks");
  const followUp = JSON.parse(seen.at(-1)!.body);
  assert.equal(followUp.session_id, "sess-gw-1", "追问带上网关逻辑会话");
  assert.notEqual(followUp.client_submission_id, JSON.parse(seen[0]!.body).client_submission_id, "每次提问新幂等键");
  assert.equal(bff.store.listMessages(r1.body.ui_session_id).length, 2, "同 UI 会话两行记账");
});

test("身份与属主红线：伪造 X-User 头被忽略（网关收到登录名）；他人/不存在的 ui_session_id → 404", async () => {
  const { bff, gw, sid } = await setup({ handler: gwCreateOk });
  bff.store.upsertUser("li", hashPw("pw-li-12345"));
  const liSid = (await login(bff.port, "li", "pw-li-12345")).sid!;

  // 伪造头：客户端自报 x-user=attacker，网关必须收到会话解析出的 zhang
  const spoof = await request(bff.port, "POST", "/api/ask", {
    cookie: `sid=${sid}`,
    headers: { "x-user": "attacker" },
    body: { question: "冒充提问" },
  });
  assert.equal(spoof.status, 201);
  assert.equal(gw.requests.at(-1)!.headers["x-user"], "zhang", "X-User 唯一来源是登录态");
  assert.match(JSON.parse(gw.requests.at(-1)!.body).client_submission_id, /^zhang-/);

  // 他人会话 → 404（不泄露存在性）；未登录 → 401（不打网关）
  const zhangUi = spoof.body.ui_session_id;
  assert.equal((await request(bff.port, "POST", "/api/ask", { cookie: `sid=${liSid}`, body: { question: "抢用", ui_session_id: zhangUi } })).status, 404);
  assert.equal((await request(bff.port, "POST", "/api/ask", { body: { question: "未登录" } })).status, 401);
  assert.equal((await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question: "x", ui_session_id: "us-not-exist" } })).status, 404);
});

test("错误面：question 缺失 → BFF 400 不打网关；网关 400/401/429 → 状态体原样透传", async () => {
  let gwStatus = 429;
  let gwBody = { error: { code: "RATE_LIMIT", message: "task queue is full, retry later" } };
  const { bff, gw, sid } = await setup({
    handler: (_req: any, res: any) => {
      res.writeHead(gwStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(gwBody));
    },
  });

  // BFF 自身参数校验（不消耗网关）
  const before = gw.requests.length;
  assert.equal((await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: {} })).status, 400);
  assert.equal((await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question: "   " } })).status, 400);
  assert.equal((await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question: "q", ui_session_id: 42 } })).status, 400);
  assert.equal(gw.requests.length, before, "参数错不打网关");

  // 透传：429（队列满）→ 401（Bearer 错）→ 400（网关侧校验）
  const r429 = await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question: "q" } });
  assert.equal(r429.status, 429);
  assert.deepEqual(r429.body, gwBody, "429 体透传（两种 429 含义靠网关 message 区分）");

  gwStatus = 401;
  gwBody = { error: { code: "UNAUTHORIZED", message: "missing or invalid bearer token" } };
  assert.equal((await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question: "q" } })).status, 401);

  gwStatus = 400;
  gwBody = { error: { code: "BAD_REQUEST", message: "question is required" } };
  assert.equal((await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question: "q" } })).status, 400);
});

test("网关不可达 → 502 BAD_GATEWAY 封闭集", async () => {
  const bff = await startBff({ gatewayUrl: "http://127.0.0.1:1" }); // 必然无监听
  openBff.push(bff);
  bff.store.upsertUser("zhang", hashPw("correct-horse-9"));
  const sid = (await login(bff.port, "zhang", "correct-horse-9")).sid!;

  const res = await request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question: "q" } });
  assert.equal(res.status, 502);
  assert.deepEqual(res.body, { error: { code: "BAD_GATEWAY", message: "engine unreachable" } });
});

test("GET /api/tasks/:id 与 /status：以登录身份反代，任务 JSON/403/404 透传（属主校验在网关）", async () => {
  const task = { run_id: "run-0001", session_id: "sess-gw-1", status: "queued", stage: null, attempt: 0, error_code: null, created_at: 123 };
  let gwStatus = 200;
  let gwBody: unknown = task;
  const { bff, gw, sid } = await setup({
    handler: (_req: any, res: any) => {
      res.writeHead(gwStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(gwBody));
    },
  });

  for (const path of ["/api/tasks/run-0001", "/api/tasks/run-0001/status"]) {
    const res = await request(bff.port, "GET", path, { cookie: `sid=${sid}` });
    assert.equal(res.status, 200, path);
    assert.deepEqual(res.body, task, `${path} 体透传（字段白名单原样）`);
    assert.equal(gw.requests.at(-1)!.url, "/api/tasks/run-0001", `${path} → 网关 GET /api/tasks/:id`);
    assert.equal(gw.requests.at(-1)!.headers.authorization, `Bearer ${GATEWAY_TOKEN}`);
    assert.equal(gw.requests.at(-1)!.headers["x-user"], "zhang");
  }

  gwStatus = 403;
  gwBody = { error: { code: "FORBIDDEN", message: "task owner mismatch" } };
  assert.equal((await request(bff.port, "GET", "/api/tasks/run-0001", { cookie: `sid=${sid}` })).status, 403);
  gwStatus = 404;
  gwBody = { error: { code: "NOT_FOUND", message: "task not found" } };
  assert.equal((await request(bff.port, "GET", "/api/tasks/run-0001/status", { cookie: `sid=${sid}` })).status, 404);

  assert.equal((await request(bff.port, "GET", "/api/tasks/run-0001")).status, 401, "未登录 401");
});
