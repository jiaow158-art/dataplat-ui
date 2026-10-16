// P4 自动标题单测：sanitizeTitle 确定性清洗（边界 1）+ generateTitle 出站行为（fetch stub，
// 绝不真打 DeepSeek——env key 保存/恢复）。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { generateTitle, sanitizeTitle } from "../src/title.ts";

const ENV_KEY = process.env.DEEPSEEK_API_KEY;
afterEach(() => {
  if (ENV_KEY === undefined) delete process.env.DEEPSEEK_API_KEY;
  else process.env.DEEPSEEK_API_KEY = ENV_KEY;
});

// ── sanitizeTitle ────────────────────────────────────────────────────────────────

test("sanitizeTitle：清洗标题前缀/Markdown/引号/尾部标点", () => {
  assert.equal(sanitizeTitle("## 9月集团业绩达成分析"), "9月集团业绩达成分析");
  assert.equal(sanitizeTitle("标题：华东近期业绩下滑分析"), "华东近期业绩下滑分析");
  assert.equal(sanitizeTitle("**90天以上应收分析**"), "90天以上应收分析");
  assert.equal(sanitizeTitle("“库存周转分析”"), "库存周转分析");
  assert.equal(sanitizeTitle("《瓷砖库存分析》。"), "瓷砖库存分析");
  assert.equal(sanitizeTitle("  目标差距分析\n（补充说明：无）  "), "目标差距分析"); // 只取第一行 + 首尾空白
});

test("sanitizeTitle：null 面——空/SKIP/新会话/清洗后过短", () => {
  assert.equal(sanitizeTitle(""), null);
  assert.equal(sanitizeTitle("   "), null);
  assert.equal(sanitizeTitle("SKIP"), null);
  assert.equal(sanitizeTitle("skip"), null);
  assert.equal(sanitizeTitle("新会话"), null);
  assert.equal(sanitizeTitle("##"), null);
  assert.equal(sanitizeTitle("。"), null);
  assert.equal(sanitizeTitle("好"), null); // 单字过短
});

test("sanitizeTitle：超长截断到 24 字符", () => {
  const long = "非常长的会话标题".repeat(10);
  assert.equal(Array.from(sanitizeTitle(long)!).length, 24);
});

// ── generateTitle（fetch stub）────────────────────────────────────────────────────

const realFetch = globalThis.fetch;

test("generateTitle：未配置 DEEPSEEK_API_KEY → null 且不出网", async () => {
  delete process.env.DEEPSEEK_API_KEY;
  let called = 0;
  globalThis.fetch = (async () => (called++, realFetch("http://127.0.0.1:1"))) as typeof fetch;
  try {
    assert.equal(await generateTitle("9月集团业绩达成怎么样"), null);
    assert.equal(called, 0, "未配 key 不出网");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("generateTitle：正常响应经 sanitizer 落库形态；SKIP/空 content → null", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key-title";
  const cases: { content: unknown; want: string | null }[] = [
    { content: "9月集团业绩达成分析", want: "9月集团业绩达成分析" },
    { content: "## 华东近期业绩下滑分析", want: "华东近期业绩下滑分析" },
    { content: "SKIP", want: null },
    { content: "", want: null },
    { content: null, want: null },
  ];
  for (const c of cases) {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: c.content } }] }), { status: 200 })) as typeof fetch;
    assert.equal(await generateTitle("q"), c.want, `content=${JSON.stringify(c.content)}`);
  }
  globalThis.fetch = realFetch;
});

test("generateTitle：非 200 / 网络异常 / 超时 → null（宁缺毋滥，异常不外泄）", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key-title";
  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;
  assert.equal(await generateTitle("q"), null);
  globalThis.fetch = (async () => {
    throw new Error("ECONNRESET");
  }) as typeof fetch;
  assert.equal(await generateTitle("q"), null);
  // 超时段：AbortSignal.timeout 受控替身。真实 8s 定时器是 unref 的、不保活事件循环——
  // stub fetch 只挂 abort 监听时，Linux node:test 会以 "Promise resolution is still
  // pending but the event loop has already resolved" 判 cancelled。替身由本测试确定性
  // 触发 abort 路径（零真实等待），并断言监听器确实收到 abort、generateTitle 落到 null。
  const realTimeout = AbortSignal.timeout;
  const ctrl = new AbortController();
  let abortReached = false;
  AbortSignal.timeout = ((_ms: number) => ctrl.signal) as typeof AbortSignal.timeout;
  globalThis.fetch = (async (_u: unknown, init?: { signal?: AbortSignal }) => {
    return new Promise((_res, rej) => {
      init?.signal?.addEventListener("abort", () => {
        abortReached = true;
        rej(init.signal!.reason);
      });
    });
  }) as typeof fetch;
  try {
    const pending = generateTitle("q");
    await new Promise((r) => setImmediate(r)); // 微任务排空：fetch 已调用、abort 监听已挂
    ctrl.abort(); // 受控"时钟到点"——确定性触发
    assert.equal(await pending, null, "abort 路径触发 → 宁缺毋滥返回 null");
    assert.ok(abortReached, "fetch 的 abort 监听确实被触发");
  } finally {
    AbortSignal.timeout = realTimeout;
    globalThis.fetch = realFetch;
  }
});

test("generateTitle：请求体形态——system+user 双消息、max_tokens 上限（成本围栏）", async () => {
  process.env.DEEPSEEK_API_KEY = "test-key-title";
  let captured: any = null;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    captured = { headers: init?.headers, body: JSON.parse(String(init?.body)) };
    return new Response(JSON.stringify({ choices: [{ message: { content: "库存分析" } }] }), { status: 200 });
  }) as typeof fetch;
  const out = await generateTitle("看一下瓷砖库存");
  assert.equal(out, "库存分析");
  assert.equal((captured.headers as Record<string, string>).authorization, "Bearer test-key-title", "key 只进请求头");
  assert.equal(captured.body.model, "deepseek-chat");
  assert.ok(captured.body.max_tokens <= 48, "max_tokens 围栏");
  assert.equal(captured.body.messages.length, 2);
  assert.equal(captured.body.messages[1].content, "看一下瓷砖库存");
  assert.ok(captured.body.messages[0].content.includes("SKIP"), "system 提示含模糊拒绝规则");
  globalThis.fetch = realFetch;
});
