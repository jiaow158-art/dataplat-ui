// M3-T1 方案A：前端静态托管 —— web/ 构建产物 dist 由 BFF 托管（同事只访问 58090 一个端口）。
// 覆盖：入口 index.html、静态资源、SPA fallback（非 /api GET 兜底 index.html）、
// API 面不受影响（未知 /api/* 仍走 JSON 404）、未配置 staticDir 时行为与原版一致。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request, startBff, login, hashPw, type BffHandle } from "./helpers.ts";

const openBff: BffHandle[] = [];
const openDist: string[] = [];

afterEach(async () => {
  for (const h of openBff.splice(0)) await h.close();
  for (const d of openDist.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** 造一个最小 dist：index.html（含标记）+ assets/app.js。 */
function makeDist(): string {
  const dist = openDist[(openDist.push(mkdtempSync(join(tmpdir(), "bff-dist-"))) - 1)];
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>dataplat</title><!--dist-entry-->");
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "assets", "app.js"), "console.log('app');");
  return dist;
}

test("static: GET / 返回 dist/index.html", async () => {
  const h = openBff[(openBff.push(await startBff({ staticDir: makeDist() })) - 1)];
  const res = await request(h.port, "GET", "/");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"] as string, /text\/html/);
  assert.ok(res.raw.includes("dist-entry"));
});

test("static: GET /assets/app.js 返回静态资源", async () => {
  const h = openBff[(openBff.push(await startBff({ staticDir: makeDist() })) - 1)];
  const res = await request(h.port, "GET", "/assets/app.js");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"] as string, /javascript/);
  assert.equal(res.raw, "console.log('app');");
});

test("static: SPA fallback —— 未知非 /api GET 兜底 index.html（前端路由深链）", async () => {
  const h = openBff[(openBff.push(await startBff({ staticDir: makeDist() })) - 1)];
  const res = await request(h.port, "GET", "/sessions/abc-123");
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"] as string, /text\/html/);
  assert.ok(res.raw.includes("dist-entry"));
});

test("static: 登录后未知 /api/* 仍是 JSON 404（API 面不受托管影响）", async () => {
  const h = openBff[(openBff.push(await startBff({ staticDir: makeDist() })) - 1)];
  h.store.upsertUser("zhang", hashPw("correct-horse-9"));
  const sess = await login(h.port, "zhang", "correct-horse-9");
  const res = await request(h.port, "GET", "/api/no-such-endpoint", { cookie: `sid=${sess.sid}` });
  assert.equal(res.status, 404);
  assert.equal((res.body as { error: { code: string } }).error.code, "NOT_FOUND");
});

test("static: 未配置 staticDir 时 GET / 保持原 404 JSON 行为", async () => {
  const h = openBff[(openBff.push(await startBff())) - 1];
  const res = await request(h.port, "GET", "/");
  assert.equal(res.status, 404);
  assert.equal((res.body as { error: { code: string } }).error.code, "NOT_FOUND");
});
