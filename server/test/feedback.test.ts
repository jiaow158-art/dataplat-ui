// 用户反馈闭环（知识健康治理 §三B）：POST /api/feedback 提交校验与 60s 幂等窗口；
// GET /api/admin/incidents 守卫/倒序/联 messages 带 question/过滤与 limit；
// PATCH 流转矩阵（非法 409 BAD_TRANSITION）、已发布强制 fix_commit（8-40 hex）、
// updated_at 变更、admin_audit 留痕（action=incident_update，detail=旧状态→新状态）；
// incidents 表迁移幂等（initDb/migrate.ts）。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { hashPw, login, request, startBff, type BffHandle } from "./helpers.ts";

const SERVER_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

const openHandles: BffHandle[] = [];

afterEach(async () => {
  for (const h of openHandles.splice(0)) await h.close();
});

async function bff(): Promise<BffHandle> {
  const h = await startBff();
  openHandles.push(h);
  return h;
}

async function seedUsers(app: BffHandle): Promise<void> {
  app.store.upsertUser("boss", hashPw("pw-boss-12345"), { isAdmin: true });
  app.store.upsertUser("zhang", hashPw("pw-zhang-12345"));
  app.store.upsertUser("li", hashPw("pw-li-123456"));
}

/** 直插 incident 行（绕过 store 以精确控制 created_at/updated_at/status）。 */
function seedIncident(
  app: BffHandle,
  over: { id?: string; username?: string; run_id?: string; category?: string; status?: string; created_at?: number; fix_commit?: string } = {},
): string {
  const id = over.id ?? `fb-${randomUUID()}`;
  const now = Date.now();
  app.db
    .prepare(
      `INSERT INTO incidents (id, username, run_id, ui_session_id, category, description, status, resolution_note, fix_commit, created_at, updated_at)
       VALUES (?, ?, ?, NULL, ?, NULL, ?, NULL, ?, ?, ?)`,
    )
    .run(id, over.username ?? "zhang", over.run_id ?? "run-x", over.category ?? "数值不对", over.status ?? "待归因", over.fix_commit ?? null, over.created_at ?? now, over.created_at ?? now);
  return id;
}

// ── 迁移 ──────────────────────────────────────────────────────────────────────────

test("迁移：旧库经 initDb 建 incidents 表；migrate.ts 幂等可重跑", async () => {
  const root = mkdtempSync(join(tmpdir(), "bff-fb-"));
  try {
    const raw = new Database(join(root, "bff.db"));
    raw.exec("CREATE TABLE users (username TEXT PRIMARY KEY, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL)");
    raw.close();

    // 先跑 initDb（等价 migrate.ts 内部路径）
    const { initDb } = await import("../src/db.ts");
    const opened = initDb(root);
    const cols = (opened.prepare("PRAGMA table_info(incidents)").all() as { name: string }[]).map((c) => c.name);
    opened.close();
    assert.deepEqual(
      cols,
      ["id", "username", "run_id", "ui_session_id", "category", "description", "status", "resolution_note", "fix_commit", "created_at", "updated_at"],
      "incidents 列齐（fb-uuid/username/run_id/ui_session_id/category/description/status/resolution_note/fix_commit/created_at/updated_at）",
    );

    const env = { ...process.env, DATA_DIR: root };
    await execFileAsync(process.execPath, ["src/migrate.ts"], { cwd: SERVER_DIR, env }); // 幂等重跑不炸
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── POST /api/feedback ────────────────────────────────────────────────────────────

test("feedback 提交：登录即可（非 admin）落 incidents status=待归因；未登录 401；最小体合法", async () => {
  const app = await bff();
  await seedUsers(app);

  assert.equal((await request(app.port, "POST", "/api/feedback", { body: { run_id: "run-1", category: "数值不对" } })).status, 401, "未登录 401");

  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  const res = await request(app.port, "POST", "/api/feedback", {
    cookie: `sid=${zhang}`,
    body: { run_id: "run-fb-1", ui_session_id: "us-1", category: "口径不对", description: "金额含税口径与报表不一致" },
  });
  assert.equal(res.status, 201, "普通登录用户即可提交（非 admin 专属）");
  assert.equal(res.body.status, "待归因");
  assert.equal(res.body.username, "zhang", "反馈人取会话身份（不信自报）");
  assert.ok(res.body.id.startsWith("fb-"), "id 前缀 fb-<uuid>");
  const row = app.db.prepare("SELECT * FROM incidents WHERE id = ?").get(res.body.id) as any;
  assert.equal(row.run_id, "run-fb-1");
  assert.equal(row.category, "口径不对");
  assert.equal(row.description, "金额含税口径与报表不一致");
  assert.equal(row.fix_commit, null);

  const minimal = await request(app.port, "POST", "/api/feedback", {
    cookie: `sid=${zhang}`,
    body: { run_id: "run-fb-2", category: "其他" },
  });
  assert.equal(minimal.status, 201, "ui_session_id/description 可省");
  assert.equal(minimal.body.description, null);
  assert.equal(minimal.body.ui_session_id, null);
});

test("feedback 校验：category 封闭集外/run_id 缺失或非串/description 超 500 或非串/ui_session_id 非串 → 400", async () => {
  const app = await bff();
  await seedUsers(app);
  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;

  for (const body of [
    { run_id: "run-1", category: "价格不对" }, // category 封闭集外
    { run_id: "run-1", category: "" },
    { run_id: "run-1" }, // 缺 category
    { category: "数值不对" }, // 缺 run_id
    { run_id: "", category: "数值不对" }, // 空 run_id
    { run_id: " ", category: "数值不对" }, // 空白 run_id
    { run_id: 123, category: "数值不对" }, // run_id 非串
    { run_id: "run-1", category: "数值不对", description: "长".repeat(501) }, // >500 字
    { run_id: "run-1", category: "数值不对", description: 42 }, // description 非串
    { run_id: "run-1", category: "数值不对", ui_session_id: 42 }, // ui_session_id 非串
  ]) {
    const res = await request(app.port, "POST", "/api/feedback", { cookie: `sid=${zhang}`, body });
    assert.equal(res.status, 400, `body=${JSON.stringify(body)} → 400`);
    assert.equal(res.body.error.code, "BAD_REQUEST");
  }
  assert.equal(app.db.prepare("SELECT count(*) n FROM incidents").get().n, 0, "非法体不落行");
});

test("feedback 幂等窗口：同 run 同用户同分类 60s 内重复提交 201 不重复落行；换分类/换用户/过期后均另落行", async () => {
  const app = await bff();
  await seedUsers(app);
  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  const li = (await login(app.port, "li", "pw-li-123456")).sid!;

  const count = () => (app.db.prepare("SELECT count(*) n FROM incidents").get() as { n: number }).n;
  const post = (sid: string, body: unknown) => request(app.port, "POST", "/api/feedback", { cookie: `sid=${sid}`, body });

  const first = await post(zhang, { run_id: "run-1", category: "数值不对" });
  assert.equal(first.status, 201);
  assert.equal(count(), 1);

  const dup = await post(zhang, { run_id: "run-1", category: "数值不对" });
  assert.equal(dup.status, 201, "窗口内重复提交仍 201");
  assert.equal(dup.body.id, first.body.id, "返回既有行");
  assert.equal(count(), 1, "不重复落行");

  const otherCat = await post(zhang, { run_id: "run-1", category: "看不懂" });
  assert.equal(otherCat.status, 201);
  assert.notEqual(otherCat.body.id, first.body.id, "换分类是新反馈");
  const otherUser = await post(li, { run_id: "run-1", category: "数值不对" });
  assert.equal(otherUser.status, 201);
  assert.equal(count(), 3);

  seedIncident(app, { username: "zhang", run_id: "run-old", category: "数值不对", created_at: Date.now() - 61_000 }); // 窗口外旧行（另用 run 隔离，免被 run-1 新行命中）
  const afterWindow = await post(zhang, { run_id: "run-old", category: "数值不对" });
  assert.equal(afterWindow.status, 201);
  assert.notEqual(afterWindow.body.id, first.body.id, "超过 60s 幂等窗口，另落新行");
  assert.equal(count(), 5);
});

// ── GET /api/admin/incidents ──────────────────────────────────────────────────────

test("incidents 队列守卫：未登录 401；非 admin 403；admin 200", async () => {
  const app = await bff();
  await seedUsers(app);
  assert.equal((await request(app.port, "GET", "/api/admin/incidents")).status, 401);
  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  assert.equal((await request(app.port, "GET", "/api/admin/incidents", { cookie: `sid=${zhang}` })).status, 403);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;
  const res = await request(app.port, "GET", "/api/admin/incidents", { cookie: `sid=${boss}` });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test("incidents 队列列表：倒序；联 messages 按 run_id 带出 question；status 过滤；limit；非法参 400", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;

  const ui = app.store.createUiSession("zhang", "库存问数");
  app.store.insertMessage({ uiSessionId: ui.id, runId: "run-q1", gatewaySessionId: "sess-gw-1", question: "本月瓷砖销量如何" });

  const older = seedIncident(app, { username: "zhang", run_id: "run-q1", category: "数值不对", created_at: Date.now() - 5_000 });
  const newer = seedIncident(app, { username: "li", run_id: "run-q2", category: "看不懂", status: "修复中", created_at: Date.now() });

  const res = await request(app.port, "GET", "/api/admin/incidents", { cookie: `sid=${boss}` });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((r: any) => r.id), [newer, older], "created_at 倒序（新到旧）");
  assert.equal(res.body[1].question, "本月瓷砖销量如何", "联 messages 带出问题文本（队列直读）");
  assert.equal(res.body[0].question, null, "无对应消息行为 null");

  const filtered = await request(app.port, "GET", `/api/admin/incidents?status=${encodeURIComponent("待归因")}`, { cookie: `sid=${boss}` });
  assert.deepEqual(filtered.body.map((r: any) => r.id), [older], "status 过滤");

  assert.equal((await request(app.port, "GET", "/api/admin/incidents?status=bogus", { cookie: `sid=${boss}` })).status, 400, "status 封闭集外 400");
  assert.equal((await request(app.port, "GET", "/api/admin/incidents?limit=0", { cookie: `sid=${boss}` })).status, 400, "limit 0 非法");
  const limited = await request(app.port, "GET", "/api/admin/incidents?limit=1", { cookie: `sid=${boss}` });
  assert.equal(limited.body.length, 1, "limit 生效");
});

// ── PATCH /api/admin/incidents/:id ────────────────────────────────────────────────

test("incident PATCH 守卫与基础：未登录 401；非 admin 403；未知 id 404；空体 400", async () => {
  const app = await bff();
  await seedUsers(app);
  const id = seedIncident(app);

  assert.equal((await request(app.port, "PATCH", `/api/admin/incidents/${id}`, { body: { status: "修复中" } })).status, 401);
  const zhang = (await login(app.port, "zhang", "pw-zhang-12345")).sid!;
  assert.equal((await request(app.port, "PATCH", `/api/admin/incidents/${id}`, { cookie: `sid=${zhang}`, body: { status: "修复中" } })).status, 403);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;
  assert.equal((await request(app.port, "PATCH", "/api/admin/incidents/fb-nosuch", { cookie: `sid=${boss}`, body: { status: "修复中" } })).status, 404);
  assert.equal((await request(app.port, "PATCH", `/api/admin/incidents/${id}`, { cookie: `sid=${boss}`, body: {} })).status, 400, "至少带一个可更新字段");
});

test("incident 流转矩阵：待归因→修复中/驳回；修复中→已发布(需 fix_commit)/驳回；驳回→待归因；非法流转 409 BAD_TRANSITION", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;
  const id = seedIncident(app);
  const patch = (body: unknown) => request(app.port, "PATCH", `/api/admin/incidents/${id}`, { cookie: `sid=${boss}`, body });

  let res = await patch({ status: "修复中" });
  assert.equal(res.status, 200, "待归因→修复中");
  assert.equal(res.body.status, "修复中");

  res = await patch({ status: "驳回" });
  assert.equal(res.status, 200, "修复中→驳回");
  assert.equal(res.body.status, "驳回");

  res = await patch({ status: "已发布" });
  assert.equal(res.status, 409, "驳回→已发布 非法");
  assert.equal(res.body.error.code, "BAD_TRANSITION");

  res = await patch({ status: "待归因" });
  assert.equal(res.status, 200, "驳回→待归因（重开）");
  res = await patch({ status: "已发布" });
  assert.equal(res.status, 409, "待归因→已发布 非法（必须先进修复中）");
  assert.equal(res.body.error.code, "BAD_TRANSITION");

  await patch({ status: "修复中" });
  res = await patch({ status: "已发布" });
  assert.equal(res.status, 400, "修复中→已发布 缺 fix_commit 400");
  res = await patch({ status: "已发布", fix_commit: "deadbeef" });
  assert.equal(res.status, 200, "修复中→已发布 带 fix_commit");
  assert.equal(res.body.status, "已发布");
  assert.equal(res.body.fix_commit, "deadbeef");

  res = await patch({ status: "驳回" });
  assert.equal(res.status, 409, "已发布是终态，不可再流转");
  assert.equal(res.body.error.code, "BAD_TRANSITION");

  const id2 = seedIncident(app);
  const patch2 = (body: unknown) => request(app.port, "PATCH", `/api/admin/incidents/${id2}`, { cookie: `sid=${boss}`, body });
  assert.equal((await patch2({ status: "done" })).status, 400, "status 封闭集外 400");
  assert.equal((await patch2({ fix_commit: "xyz" })).status, 400, "fix_commit 非 hex 400");
  assert.equal((await patch2({ fix_commit: "abcdefg" })).status, 400, "fix_commit 7 位太短 400");
  assert.equal((await patch2({ fix_commit: "a".repeat(41) })).status, 400, "fix_commit 41 位太长 400");
  assert.equal((await patch2({ fix_commit: "0f1e2d3c4b5a69788796a5b4" })).status, 200, "24 位 hex 合法（仅改 fix_commit 不触发流转）");
});

test("incident PATCH：updated_at 递增；resolution_note 可单独编辑（不动状态）；admin_audit 留痕 incident_update（detail=旧→新）", async () => {
  const app = await bff();
  await seedUsers(app);
  const boss = (await login(app.port, "boss", "pw-boss-12345")).sid!;
  const id = seedIncident(app, { created_at: Date.now() - 10_000 });
  const patch = (body: unknown) => request(app.port, "PATCH", `/api/admin/incidents/${id}`, { cookie: `sid=${boss}`, body });

  const res = await patch({ status: "修复中", resolution_note: "确认为 dm.amount 口径分歧" });
  assert.equal(res.status, 200);
  assert.equal(res.body.resolution_note, "确认为 dm.amount 口径分歧");
  assert.ok(res.body.updated_at > Date.now() - 10_000, "每次变更写 updated_at");

  const noteOnly = await patch({ resolution_note: "已登记分歧登记表，等 Owner 裁决" });
  assert.equal(noteOnly.status, 200, "resolution_note 单独可编辑");
  assert.equal(noteOnly.body.status, "修复中", "状态不动");
  assert.equal(noteOnly.body.resolution_note, "已登记分歧登记表，等 Owner 裁决");

  const audit = app.store.listAdminAudit(10).filter((r) => r.action === "incident_update");
  assert.equal(audit.length, 2, "每次 PATCH 各留痕");
  assert.deepEqual(
    audit.map((r) => ({ username: r.username, target: r.target, detail: r.detail })),
    [
      { username: "boss", target: id, detail: "修复中→修复中" },
      { username: "boss", target: id, detail: "待归因→修复中" },
    ],
    "新到旧；detail=旧状态→新状态；target=incident id",
  );
});
