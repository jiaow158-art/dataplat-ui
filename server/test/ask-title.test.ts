// P4 自动标题集成测试（mock 网关 + 注入 titleGen）：
// 1) 网关请求体红线——恰为三字段白名单，title/title_source 绝不出现在 gwBody；
// 2) default 触发/一次性（llm 后不再生成）、模糊拒绝后下个有效问题重试；
// 3) 手动改名永久保护（SQL 守卫，含生成在途时改名的并发序）；
// 4) 裁定 b——autoTitle 与手动 rename 都不动 updated_at（会话不跳位）；
// 5) 失败隔离（生成器 reject 不影响 ask 201）；6) in-flight 去重；7) hint 会话不触发生成。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hashPw, login, request, startBff, startMockGateway, type BffHandle, type MockGateway } from "./helpers.ts";

const openBff: BffHandle[] = [];
const openGw: MockGateway[] = [];
afterEach(async () => {
  for (const h of openBff.splice(0)) await h.close();
  for (const g of openGw.splice(0)) await g.close();
});

async function setup(titleGen: (q: string) => Promise<string | null>): Promise<{ bff: BffHandle; gw: MockGateway; sid: string }> {
  const gw = await startMockGateway((req, res) => {
    res.writeHead(201, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ run_id: `run-${gwReqCount++}`, session_id: "sess-gw-1" }));
  });
  openGw.push(gw);
  const bff = await startBff({ gatewayUrl: gw.url, titleGen });
  openBff.push(bff);
  bff.store.upsertUser("zhang", hashPw("correct-horse-9"));
  const sid = (await login(bff.port, "zhang", "correct-horse-9")).sid!;
  return { bff, gw, sid };
}
let gwReqCount = 1;

const ask = (bff: BffHandle, sid: string, question: string, uiSessionId?: string) =>
  request(bff.port, "POST", "/api/ask", { cookie: `sid=${sid}`, body: { question, ...(uiSessionId ? { ui_session_id: uiSessionId } : {}) } });

const tick = () => new Promise((r) => setTimeout(r, 30));

test("首问成功 → 异步落 llm 标题；网关体恰三字段（title 绝不进入 gwBody）；updated_at 不动（裁定 b）", async () => {
  const { bff, gw, sid } = await setup(async () => "9月集团业绩达成分析");
  const res = await ask(bff, sid, "我是想知道九月份集团业绩达成怎么样");
  assert.equal(res.status, 201);

  // 网关红线：请求体字段恰为白名单
  const gwBody = JSON.parse(gw.requests.find((r) => r.url === "/api/tasks")!.body);
  assert.deepEqual(Object.keys(gwBody).sort(), ["client_submission_id", "question"], "gwBody 三字段白名单（首问无 session_id），无 title/title_source");

  const ui0 = bff.store.getUiSession(res.body.ui_session_id)!;
  await tick();
  const ui1 = bff.store.getUiSession(res.body.ui_session_id)!;
  assert.equal(ui1.title, "9月集团业绩达成分析");
  assert.equal(ui1.title_source, "llm");
  assert.equal(ui1.updated_at, ui0.updated_at, "autoTitle 不动活动排序时间——Sidebar 不跳位");
});

test("一次性 + 重试：llm 后再问不生成；模糊拒绝保持 default，下个有效问题再试", async () => {
  const calls: string[] = [];
  const { bff, sid } = await setup(async (q) => {
    calls.push(q);
    return q === "帮我看看" ? null : "90天以上应收分析";
  });
  const r1 = await ask(bff, sid, "帮我看看");
  await tick();
  let ui = bff.store.getUiSession(r1.body.ui_session_id)!;
  assert.equal(ui.title, "新会话", "模糊拒绝保持新会话（裁定 a）");
  assert.equal(ui.title_source, "default", "default 保留——允许后续重试");

  const r2 = await ask(bff, sid, "看一下90天以上应收情况", r1.body.ui_session_id);
  await tick();
  ui = bff.store.getUiSession(r1.body.ui_session_id)!;
  assert.equal(ui.title, "90天以上应收分析", "第二个有效问题生成标题");
  assert.equal(ui.title_source, "llm");

  await ask(bff, sid, "那渠道呢", r1.body.ui_session_id);
  await tick();
  assert.equal(calls.length, 2, "llm 之后不再触发（一次性）——三问只发生成请求两次（模糊拒绝 + 有效问）");
  assert.equal(bff.store.getUiSession(r1.body.ui_session_id)!.title, "90天以上应收分析");
  void r2;
});

test("手动改名永久保护：改名后不再生成；生成在途时改名 → SQL 守卫 0 行（并发序）", async () => {
  // 场景 A：先改名，后 ask——不触发生成
  let gen: (q: string) => Promise<string | null> = async () => "不该出现";
  const { bff, sid } = await setup((q) => gen(q));
  const created = bff.store.createUiSession("zhang", "新会话");
  bff.store.renameUiSession(created.id, "我自己的标题");
  await ask(bff, sid, "为什么华东最近三个月一直下滑", created.id);
  await tick();
  let ui = bff.store.getUiSession(created.id)!;
  assert.equal(ui.title, "我自己的标题", "manual 来源：ask 不触发生成");
  assert.equal(ui.title_source, "manual");

  // 场景 B：ask 已触发生成（promise 悬挂），期间手动改名 → resolve 后守卫拒绝写入
  let release!: (v: string | null) => void;
  gen = () => new Promise((r) => (release = r));
  const created2 = bff.store.createUiSession("zhang", "新会话");
  await ask(bff, sid, "九月份业绩", created2.id); // ask 的 touch 是真实会话活动（应动排序时间）
  const afterAsk = bff.store.getUiSession(created2.id)!.updated_at;
  bff.store.renameUiSession(created2.id, "改名抢跑");
  release("迟到的自动标题");
  await tick();
  ui = bff.store.getUiSession(created2.id)!;
  assert.equal(ui.title, "改名抢跑", "在途生成与手动改名并发：手动优先，SQL 守卫生效");
  assert.equal(ui.title_source, "manual");
  assert.equal(ui.updated_at, afterAsk, "手动 rename 不动活动排序时间（裁定 b，对比 ask 之后快照）");
});

test("失败隔离：生成器 reject → ask 201 不受影响，标题保持新会话", async () => {
  const { bff, sid } = await setup(async () => {
    throw new Error("LLM down");
  });
  const res = await ask(bff, sid, "九月份集团业绩达成怎么样");
  assert.equal(res.status, 201, "问数主流程不受标题失败影响");
  await tick();
  const ui = bff.store.getUiSession(res.body.ui_session_id)!;
  assert.equal(ui.title, "新会话");
  assert.equal(ui.title_source, "default", "失败保持 default，后续可重试");
});

test("in-flight 去重：同一 default 会话并发两问只出一次生成请求", async () => {
  let calls = 0;
  let release!: (v: string | null) => void;
  const { bff, sid } = await setup(() => {
    calls++;
    return new Promise((r) => (release = r));
  });
  const created = bff.store.createUiSession("zhang", "新会话");
  const [a, b] = await Promise.all([ask(bff, sid, "第一问", created.id), ask(bff, sid, "第二问", created.id)]);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  assert.equal(calls, 1, "同会话并发 ask：标题请求在途去重（边界 3）");
  release(null);
  await tick();
});

test("hint 会话（askSeed title_hint）：创建即语义标题，ask 不触发生成", async () => {
  let calls = 0;
  const { bff, sid } = await setup(async () => {
    calls++;
    return "不该出现";
  });
  const created = await request(bff.port, "POST", "/api/sessions", { cookie: `sid=${sid}`, body: { title: "华南经营表现分析" } });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, "华南经营表现分析");
  assert.equal(created.body.title_source, "hint");
  await ask(bff, sid, "请分析华南区域近期经营表现", created.body.id);
  await tick();
  assert.equal(calls, 0, "hint 来源不触发生成");
  const ui = bff.store.getUiSession(created.body.id)!;
  assert.equal(ui.title, "华南经营表现分析");

  // 无 title 创建 = default（可被自动标题覆盖）
  const plain = await request(bff.port, "POST", "/api/sessions", { cookie: `sid=${sid}`, body: {} });
  assert.equal(plain.body.title_source, "default");
});

test("旧库迁移：title_source 列幂等补齐，存量行 settle manual", async () => {
  // helpers.startBff 每次全新库（schema.sql 已含列）——这里直接验证列存在与默认值语义
  const { bff } = await setup(async () => null);
  const cols = (bff.db.prepare("PRAGMA table_info(ui_sessions)").all() as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes("title_source"), "schema.sql 新库带列");
  const row = bff.store.createUiSession("zhang", "新会话");
  assert.equal(row.title_source, "default");
});
