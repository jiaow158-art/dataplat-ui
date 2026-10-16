// 知识库管理入口两项（M4 知识健康治理 §四C/D UI 面）：
// 1) 知识端点（HARNESS_DIR）：files 列表 / file 读取（白名单 403）/ publish（调 harness
//    scripts/knowledge-publish.mjs——fixture 仓 + eval 替身，真脚本真钩子，零污染两仓工作区）；
//    admin_audit 留痕 action=knowledge_publish（ok+sha / gate 拒）。
// 2) domain_requests：POST /api/domain-requests（任何登录用户；域名 2-40 / example ≤1000 /
//    urgency 枚举）、GET /api/admin/domain-requests、PATCH 流转（留痕）；迁移幂等。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { hashPw, login, request, startBff, type BffHandle } from "./helpers.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
/** 定位 harness 仓（真发布脚本/真钩子来源）：env 覆盖 > 同级名探测。
 *  Windows 开发布局 = dataplat-ui 与 dataprojai-2harness 同级；Linux 部署布局 =
 *  /srv/dpit/apps/{dataplat-ui,harness} 同级。两名字 + HARNESS_TEST_DIR 覆盖，
 *  不要求 Linux 建任何 symlink。按 knowledge-publish.mjs 存在性校验命中。 */
function resolveRealHarness(): string {
  const candidates = [
    process.env.HARNESS_TEST_DIR, // 显式覆盖（CI/异构布局）
    resolve(SERVER_DIR, "..", "..", "dataprojai-2harness"), // Windows 开发默认
    resolve(SERVER_DIR, "..", "..", "harness"), // Linux 部署默认（/srv/dpit/apps/harness）
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
  for (const c of candidates) {
    if (existsSync(join(c, "scripts", "knowledge-publish.mjs"))) return c;
  }
  throw new Error(
    `[knowledge.test] 未找到 harness 仓（探测：${candidates.join(" ; ")}）——` +
      `请设 HARNESS_TEST_DIR 指向 harness 仓根（含 scripts/knowledge-publish.mjs）`,
  );
}
const REAL_HARNESS = resolveRealHarness();
const REAL_SCRIPT = join(REAL_HARNESS, "scripts", "knowledge-publish.mjs");
const REAL_HOOKS = join(REAL_HARNESS, ".githooks");

const openHandles: BffHandle[] = [];

afterEach(async () => {
  for (const h of openHandles.splice(0)) await h.close();
});

async function bff(opts: Parameters<typeof startBff>[0] = {}): Promise<BffHandle> {
  const h = await startBff(opts);
  openHandles.push(h);
  return h;
}

async function seedUsers(app: BffHandle): Promise<void> {
  app.store.upsertUser("boss", hashPw("pw-boss-12345"), { isAdmin: true });
  app.store.upsertUser("zhang", hashPw("pw-zhang-12345"));
}

async function bossLogin(app: BffHandle): Promise<string> {
  return (await login(app.port, "boss", "pw-boss-12345")).sid!;
}

/** harness fixture 仓：真脚本复制到生产布局位置 + 真钩子 + eval 替身（同 harness 侧测试手法）。 */
function makeHarnessFixture(): string {
  const dir = mkdtempSync(join(tmpdir(), "harness-fx-"));
  mkdirSync(join(dir, "skills", "demo-knowledge", "references"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "skills", "demo-knowledge", "SKILL.md"), "# demo skill\n");
  writeFileSync(join(dir, "skills", "demo-knowledge", "references", "metrics.md"), "# demo\nv1\n");
  writeFileSync(join(dir, "skills", "demo-knowledge", "references", "notes.txt"), "非 md\n");
  writeFileSync(join(dir, "eval_dataset.json"), "{}\n");
  writeFileSync(join(dir, "README.md"), "x\n");
  writeFileSync(join(dir, ".gitignore"), "counter\nledger.jsonl\neval_results/\n");
  copyFileSync(REAL_SCRIPT, join(dir, "scripts", "knowledge-publish.mjs"));
  writeFileSync(join(dir, "eval-double.mjs"),
    `import { appendFileSync } from 'node:fs';` +
    `appendFileSync(process.env.COUNTER, 'x');` +
    `console.log('PASS a\\nPASS b\\nPASS c');` +
    `if (process.env.DOUBLE_FAIL === '1') { console.error('FAIL scenario-1'); process.exit(1); }\n`);
  const sh = (cmd: string) => spawnSync("sh", ["-c", cmd], { cwd: dir, encoding: "utf8" });
  sh("git init -q && git config user.email t@t && git config user.name t && git config core.autocrlf false");
  sh("git add -A && git commit -qm init");
  sh(`git config core.hooksPath "${REAL_HOOKS.replace(/\\/g, "/")}"`);
  writeFileSync(join(dir, "counter"), "");
  writeFileSync(join(dir, "ledger.jsonl"), "");
  return dir;
}

/** 发布请求前后包一层 env（eval 替身注入——BFF spawn 继承本进程 env）。 */
async function publishWithEnv(
  app: BffHandle,
  sid: string,
  body: unknown,
  env: Record<string, string | undefined>,
): Promise<ReturnType<typeof request>> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await request(app.port, "POST", "/api/admin/knowledge/publish", { cookie: `sid=${sid}`, body });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

// ── HARNESS_DIR 未设 ──────────────────────────────────────────────────────────────

test("HARNESS_DIR 未设：files/file/publish 三端点 503 HARNESS_DIR_UNSET", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = await bossLogin(app);
  for (const r of [
    await request(app.port, "GET", "/api/admin/knowledge/files", { cookie: `sid=${boss}` }),
    await request(app.port, "GET", "/api/admin/knowledge/file?path=skills/d/SKILL.md", { cookie: `sid=${boss}` }),
    await request(app.port, "POST", "/api/admin/knowledge/publish", { cookie: `sid=${boss}`, body: { path: "skills/d/SKILL.md", content: "x", message: "m" } }),
  ]) {
    assert.equal(r.status, 503);
    assert.equal(r.body.error.code, "HARNESS_DIR_UNSET");
  }
});

// ── GET /api/admin/knowledge/files 与 file ────────────────────────────────────────

test("知识文件列表：白名单 md 全列（SKILL.md + references/*.md）带 域/大小/mtime；非白名单排除；守卫 401/403", async () => {
  const harness = makeHarnessFixture();
  const app = await bff({ harnessDir: harness });
  try {
    await seedUsers(app);
    assert.equal((await request(app.port, "GET", "/api/admin/knowledge/files")).status, 401, "未登录 401");
    const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
    assert.equal((await request(app.port, "GET", "/api/admin/knowledge/files", { cookie: `sid=${zhang}` })).status, 403, "非 admin 403");
    const boss = await bossLogin(app);

    const res = await request(app.port, "GET", "/api/admin/knowledge/files", { cookie: `sid=${boss}` });
    assert.equal(res.status, 200);
    const paths = (res.body as { path: string }[]).map((f) => f.path);
    assert.deepEqual(paths, [
      "skills/demo-knowledge/SKILL.md",
      "skills/demo-knowledge/references/metrics.md",
    ], "白名单 md 升序；notes.txt 排除");
    const meta = (res.body as { path: string; domain: string; size: number; mtime: number }[])[1];
    assert.equal(meta.domain, "demo-knowledge");
    assert.equal(meta.size, 10, "# demo\nv1\n = 10 字节");
    assert.ok(Math.abs(meta.mtime - Date.now()) < 60_000, "mtime 为 ms epoch");
  } finally {
    rmSync(harness, { recursive: true, force: true });
  }
});

test("知识文件读取：合法路径返回内容；越界/非白名单/根路径 403 PATH_FORBIDDEN；不存在 404", async () => {
  const harness = makeHarnessFixture();
  const app = await bff({ harnessDir: harness });
  try {
    await seedUsers(app);
    const boss = await bossLogin(app);

    const ok = await request(app.port, "GET", "/api/admin/knowledge/file?path=skills/demo-knowledge/references/metrics.md", { cookie: `sid=${boss}` });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.path, "skills/demo-knowledge/references/metrics.md");
    assert.equal(ok.body.content, "# demo\nv1\n");

    for (const p of [
      "../../etc/passwd",
      "README.md",
      "skills/demo-knowledge/references/notes.txt",
      "skills/foo.md",
      "eval_dataset.json",
      "",
    ]) {
      const r = await request(app.port, "GET", `/api/admin/knowledge/file?path=${encodeURIComponent(p)}`, { cookie: `sid=${boss}` });
      assert.equal(r.status, p === "" ? 400 : 403, `path=${p}`);
      if (p !== "") assert.equal(r.body.error.code, "PATH_FORBIDDEN");
    }
    assert.equal(
      (await request(app.port, "GET", "/api/admin/knowledge/file?path=skills/demo-knowledge/references/gone.md", { cookie: `sid=${boss}` })).status,
      404,
      "白名单内但不存在 404",
    );
  } finally {
    rmSync(harness, { recursive: true, force: true });
  }
});

// ── POST /api/admin/knowledge/publish ─────────────────────────────────────────────

test("publish 守卫与校验：未登录 401；非 admin 403；缺字段/空 message 400；越界 path 403（不触脚本）", async () => {
  const harness = makeHarnessFixture();
  const app = await bff({ harnessDir: harness });
  try {
    await seedUsers(app);
    assert.equal((await request(app.port, "POST", "/api/admin/knowledge/publish", { body: { path: "skills/d/SKILL.md", content: "x", message: "m" } })).status, 401);

    const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
    assert.equal((await request(app.port, "POST", "/api/admin/knowledge/publish", { cookie: `sid=${zhang}`, body: { path: "skills/d/SKILL.md", content: "x", message: "m" } })).status, 403);

    const boss = await bossLogin(app);
    for (const body of [
      { content: "x", message: "m" }, // 缺 path
      { path: "skills/demo-knowledge/SKILL.md", message: "m" }, // 缺 content
      { path: "skills/demo-knowledge/SKILL.md", content: "x" }, // 缺 message
      { path: "skills/demo-knowledge/SKILL.md", content: "x", message: "   " }, // 空 message
      { path: 42, content: "x", message: "m" }, // 非串
    ]) {
      const r = await request(app.port, "POST", "/api/admin/knowledge/publish", { cookie: `sid=${boss}`, body });
      assert.equal(r.status, 400, JSON.stringify(body));
      assert.equal(r.body.error.code, "BAD_REQUEST");
    }
    const forbidden = await request(app.port, "POST", "/api/admin/knowledge/publish", {
      cookie: `sid=${boss}`,
      body: { path: "../../evil.md", content: "x", message: "m" },
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.body.error.code, "PATH_FORBIDDEN");
    assert.equal(readFileSync(join(harness, "counter"), "utf8").length, 0, "越界请求未触脚本（eval 替身零调用）");
  } finally {
    rmSync(harness, { recursive: true, force: true });
  }
});

test("publish 成功：透传 {ok:true,sha,eval_summary}；fixture 仓已提交；audit 留痕 knowledge_publish（detail 含 sha）", async () => {
  const harness = makeHarnessFixture();
  const app = await bff({ harnessDir: harness });
  try {
    await seedUsers(app);
    const boss = await bossLogin(app);
    const res = await publishWithEnv(app, boss, {
      path: "skills/demo-knowledge/references/metrics.md",
      content: "# demo\nv2 from ui\n",
      message: "ui: 修正 metrics 口径",
    }, {
      KNOWLEDGE_EVAL_CMD: `node ${join(harness, "eval-double.mjs").replace(/\\/g, "/")}`,
      KNOWLEDGE_GATE_LEDGER: join(harness, "ledger.jsonl"),
      COUNTER: join(harness, "counter"),
      DOUBLE_FAIL: undefined,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.ok, true);
    assert.match(res.body.sha, /^[0-9a-f]{40}$/);
    assert.match(res.body.eval_summary, /\[knowledge-gate\] ✓/);

    // fixture 仓：提交成功、worktree 干净（HEAD 内容即新内容）
    const status = spawnSync("sh", ["-c", "git status --short"], { cwd: harness, encoding: "utf8" });
    assert.equal(status.stdout.trim(), "", "fixture 仓零残留");
    const show = spawnSync("sh", ["-c", "git show HEAD:skills/demo-knowledge/references/metrics.md"], { cwd: harness, encoding: "utf8" });
    assert.equal(show.stdout, "# demo\nv2 from ui\n");

    const audit = app.store.listAdminAudit(5).find((r) => r.action === "knowledge_publish");
    assert.ok(audit, "留痕存在");
    assert.equal(audit.username, "boss");
    assert.equal(audit.target, "skills/demo-knowledge/references/metrics.md");
    assert.match(audit.detail ?? "", /^ok sha=[0-9a-f]+$/);
  } finally {
    rmSync(harness, { recursive: true, force: true });
  }
});

test("publish 门拒：透传 {ok:false,reason:gate,gate_output}；fixture 仓还原干净；audit 留痕 gate 拒", async () => {
  const harness = makeHarnessFixture();
  const app = await bff({ harnessDir: harness });
  try {
    await seedUsers(app);
    const boss = await bossLogin(app);
    const res = await publishWithEnv(app, boss, {
      path: "skills/demo-knowledge/references/metrics.md",
      content: "# demo\nv3-bad\n",
      message: "ui: 坏改动",
    }, {
      KNOWLEDGE_EVAL_CMD: `node ${join(harness, "eval-double.mjs").replace(/\\/g, "/")}`,
      KNOWLEDGE_GATE_LEDGER: join(harness, "ledger.jsonl"),
      COUNTER: join(harness, "counter"),
      DOUBLE_FAIL: "1",
    });
    assert.equal(res.status, 200, "门拒是业务结果不是 HTTP 错误");
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, "gate");
    assert.ok(res.body.gate_output.some((l: string) => l.includes("FAIL")), "gate_output 尾部行透传");

    const status = spawnSync("sh", ["-c", "git status --short"], { cwd: harness, encoding: "utf8" });
    assert.equal(status.stdout.trim(), "", "fixture 仓还原干净（门拒回滚）");

    const audit = app.store.listAdminAudit(5).find((r) => r.action === "knowledge_publish");
    assert.ok(audit);
    assert.match(audit!.detail ?? "", /gate 拒/);
  } finally {
    rmSync(harness, { recursive: true, force: true });
  }
});

test("publish 脚本不可用（harnessDir 缺 scripts/）：500 INTERNAL，不炸进程", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-empty-"));
  const app = await bff({ harnessDir: dir });
  try {
    await seedUsers(app);
    const boss = await bossLogin(app);
    const res = await request(app.port, "POST", "/api/admin/knowledge/publish", {
      cookie: `sid=${boss}`,
      body: { path: "skills/demo-knowledge/SKILL.md", content: "x", message: "m" },
    });
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, "INTERNAL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── domain_requests ───────────────────────────────────────────────────────────────

test("域申请提交：任何登录用户 201 status=待受理；未登录 401；域名 2-40/example ≤1000/urgency 枚举校验 400", async () => {
  const app = await bff();
  await seedUsers(app);
  assert.equal((await request(app.port, "POST", "/api/domain-requests", { body: { domain_name: "采购", urgency: "高" } })).status, 401);

  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  const res = await request(app.port, "POST", "/api/domain-requests", {
    cookie: `sid=${zhang}`,
    body: { domain_name: "采购域", example_questions: "本月采购金额多少？", urgency: "中" },
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, "待受理");
  assert.equal(res.body.username, "zhang", "申请人取会话身份");
  assert.equal(res.body.domain_name, "采购域");
  assert.ok(String(res.body.id).startsWith("dr-"));

  const minimal = await request(app.port, "POST", "/api/domain-requests", {
    cookie: `sid=${zhang}`, body: { domain_name: "人力资源", urgency: "低" },
  });
  assert.equal(minimal.status, 201, "example_questions 可省");
  assert.equal(minimal.body.example_questions, null);

  for (const body of [
    { domain_name: "采", urgency: "高" }, // 1 字太短
    { domain_name: "域".repeat(41), urgency: "高" }, // 41 字太长
    { domain_name: "  ", urgency: "高" }, // trim 后空
    { urgency: "高" }, // 缺域名
    { domain_name: "采购域" }, // 缺 urgency
    { domain_name: "采购域", urgency: "紧急" }, // urgency 枚举外
    { domain_name: "采购域", urgency: "高", example_questions: "问".repeat(1001) }, // >1000
    { domain_name: "采购域", urgency: "高", example_questions: 42 }, // 非串
  ]) {
    const r = await request(app.port, "POST", "/api/domain-requests", { cookie: `sid=${zhang}`, body });
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.error.code, "BAD_REQUEST");
  }
  assert.equal((app.db.prepare("SELECT count(*) n FROM domain_requests").get() as { n: number }).n, 2, "非法体不落行");
});

test("域申请队列：守卫 401/403；倒序；status 过滤；非法 status/limit 400", async () => {
  const app = await bff();
  await seedUsers(app);
  assert.equal((await request(app.port, "GET", "/api/admin/domain-requests")).status, 401);
  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  assert.equal((await request(app.port, "GET", "/api/admin/domain-requests", { cookie: `sid=${zhang}` })).status, 403);
  const boss = await bossLogin(app);

  const seed = (domain: string, at: number, status = "待受理") =>
    app.db
      .prepare(
        `INSERT INTO domain_requests (id, domain_name, example_questions, urgency, username, status, note, created_at)
         VALUES (?, ?, NULL, '高', 'zhang', ?, NULL, ?)`,
      )
      .run(`dr-${randomUUID()}`, domain, status, at);
  const older = seed("采购域", Date.now() - 5_000) as unknown as { lastInsertRowid: bigint };
  void older;
  const newer = app.db
    .prepare(
      `INSERT INTO domain_requests (id, domain_name, example_questions, urgency, username, status, note, created_at)
       VALUES (?, '人力资源', NULL, '低', 'li', '受理', NULL, ?)`,
    )
    .run(`dr-${randomUUID()}`, Date.now());
  void newer;

  const res = await request(app.port, "GET", "/api/admin/domain-requests", { cookie: `sid=${boss}` });
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2, "默认全量倒序");
  assert.equal(res.body[0].domain_name, "人力资源", "新到旧");

  const filtered = await request(app.port, "GET", `/api/admin/domain-requests?status=${encodeURIComponent("待受理")}`, { cookie: `sid=${boss}` });
  assert.equal(filtered.body.length, 1);
  assert.equal(filtered.body[0].domain_name, "采购域");

  assert.equal((await request(app.port, "GET", "/api/admin/domain-requests?status=bogus", { cookie: `sid=${boss}` })).status, 400);
  assert.equal((await request(app.port, "GET", "/api/admin/domain-requests?limit=0", { cookie: `sid=${boss}` })).status, 400);
});

test("域申请 PATCH：流转矩阵（待受理→受理/搁置/驳回；受理→搁置/驳回；搁置→受理/驳回；驳回→待受理）；note 单独编辑；404/400/409；留痕 domain_request_update", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = await bossLogin(app);

  const seed = (status: string): string => {
    const id = `dr-${randomUUID()}`;
    app.db
      .prepare(
        `INSERT INTO domain_requests (id, domain_name, example_questions, urgency, username, status, note, created_at)
         VALUES (?, '采购域', NULL, '高', 'zhang', ?, NULL, ?)`,
      )
      .run(id, status, Date.now());
    return id;
  };
  const patch = (id: string, body: unknown) =>
    request(app.port, "PATCH", `/api/admin/domain-requests/${encodeURIComponent(id)}`, { cookie: `sid=${boss}`, body });

  assert.equal((await patch("dr-nosuch", { status: "受理" })).status, 404, "未知 id 404");

  // 非法流转：待受理 → （受理/搁置/驳回 都合法，逐一走完）
  const id1 = seed("待受理");
  for (const target of ["受理", "搁置", "驳回"]) {
    const id = seed("待受理");
    const r = await patch(id, { status: target });
    assert.equal(r.status, 200, `待受理→${target}`);
    assert.equal(r.body.status, target);
  }
  assert.equal((await patch(id1, { status: "待受理", note: "先补齐" })).status, 200, "同值=非流转放行，可带 note");
  void id1;

  // 受理 → 搁置/驳回 合法；受理 → 待受理 非法
  const acc = seed("受理");
  assert.equal((await patch(acc, { status: "待受理" })).status, 409);
  assert.equal((await patch(acc, { status: "搁置" })).status, 200);
  assert.equal((await patch(acc, { status: "驳回" })).status, 200, "搁置→驳回");
  assert.equal((await patch(acc, { status: "待受理" })).status, 200, "驳回→待受理（重开）");

  // 参数校验
  const id2 = seed("待受理");
  assert.equal((await patch(id2, {})).status, 400, "空体");
  assert.equal((await patch(id2, { status: "done" })).status, 400, "status 封闭集外");
  assert.equal((await patch(id2, { note: "长".repeat(501) })).status, 400, "note >500");
  assert.equal((await patch(id2, { note: 42 })).status, 400, "note 非串");

  // note 单独编辑 + 留痕
  const r = await patch(id2, { note: "等数据中台开通只读账号" });
  assert.equal(r.status, 200);
  assert.equal(r.body.note, "等数据中台开通只读账号");
  assert.equal(r.body.status, "待受理", "状态不动");
  const audit = app.store.listAdminAudit(20).filter((row) => row.action === "domain_request_update");
  assert.ok(audit.length >= 8, "每次 PATCH 留痕");
  assert.deepEqual(
    audit.slice(0, 2).map((row) => ({ target: row.target, detail: row.detail })),
    [
      { target: id2, detail: "note" },
      { target: acc, detail: "驳回→待受理" },
    ],
    "新到旧；状态变更 detail=旧→新；note-only detail=note",
  );
});

// ── 迁移 ──────────────────────────────────────────────────────────────────────────

test("迁移：旧库经 initDb 建 domain_requests 表（列齐）；migrate.ts 幂等可重跑", async () => {
  const root = mkdtempSync(join(tmpdir(), "bff-dr-"));
  try {
    const raw = new Database(join(root, "bff.db"));
    raw.exec("CREATE TABLE users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)");
    raw.close();

    const { initDb } = await import("../src/db.ts");
    const opened = initDb(root);
    const cols = (opened.prepare("PRAGMA table_info(domain_requests)").all() as { name: string }[]).map((c) => c.name);
    opened.close();
    assert.deepEqual(cols, ["id", "domain_name", "example_questions", "urgency", "username", "status", "note", "created_at"]);

    const env = { ...process.env, DATA_DIR: root };
    await execFileAsync(process.execPath, ["src/migrate.ts"], { cwd: SERVER_DIR, env }); // 幂等重跑不炸
    await execFileAsync(process.execPath, ["src/migrate.ts"], { cwd: SERVER_DIR, env });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
