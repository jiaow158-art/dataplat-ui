// UI-T7 集成测试：GET /api/reports?run_id= —— 报告静态服务三道闸（spec §6.3/§6.4、契约 §8）：
// 1) 记账属主：run_id → messages → ui_session 属主 == 登录用户，否则 403；
// 2) 网关二次确认：以登录身份 GET /api/tasks/:id，403/404 透传拒绝（防御纵深）；
// 3) 路径遏制：report_path resolve 后必须在 REPORTS_DIR 内（防 ../ 与绝对路径逃逸）。
// 响应头：text/html; charset=utf-8 + nosniff + CSP（留内联脚本——报告含内联 ECharts）；
// download=1 → Content-Disposition: attachment。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { basename, join } from "node:path";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { GATEWAY_TOKEN, hashPw, login, request, startBff, startMockGateway, type BffHandle, type MockGateway } from "./helpers.ts";

const openBff: BffHandle[] = [];
const openGw: MockGateway[] = [];
const dirs: string[] = [];

afterEach(async () => {
  for (const h of openBff.splice(0)) await h.close();
  for (const g of openGw.splice(0)) await g.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const gwTaskOk = (_req: unknown, res: import("node:http").ServerResponse): void => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({ run_id: "run-r1", session_id: "sess-gw", status: "succeeded", stage: null, attempt: 1, error_code: null, created_at: 1 }),
  );
};

async function setup(opts: { handler?: (req: any, res: any) => void } = {}) {
  const gw = await startMockGateway(opts.handler ?? gwTaskOk);
  openGw.push(gw);
  const reportsDir = mkdtempSync(join(tmpdir(), "bff-reports-"));
  dirs.push(reportsDir);
  const bff = await startBff({ gatewayUrl: gw.url, reportsDir });
  openBff.push(bff);
  bff.store.upsertUser("zhang", hashPw("correct-horse-9"));
  bff.store.upsertUser("li", hashPw("pw-li-12345"));
  const sid = (await login(bff.port, "zhang", "correct-horse-9")).sid!;
  const liSid = (await login(bff.port, "li", "pw-li-12345")).sid!;
  return { bff, gw, sid, liSid, reportsDir };
}

/** 造一笔带报告的记账：属主 zhang；report_path 相对 reportsDir。 */
function seedReport(bff: BffHandle, reportPath: string, runId = "run-r1"): void {
  const ui = bff.store.createUiSession("zhang", "报告会话");
  bff.store.insertMessage({ uiSessionId: ui.id, runId, gatewaySessionId: "sess-gw", question: "生成报告" });
  bff.store.updateMessageReport(runId, reportPath);
}

test("属主校验：他人 run_id → 403 且不打网关；未登录 401", async () => {
  const { bff, gw, sid, liSid } = await setup();
  seedReport(bff, "sess-gw/run-r1.html");

  const before = gw.requests.length;
  const denied = await request(bff.port, "GET", "/api/reports?run_id=run-r1", { cookie: `sid=${liSid}` });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "FORBIDDEN", "403 封闭集（spec §6.3：非本人 403）");
  assert.equal(gw.requests.length, before, "记账属主已拒，不打网关");

  assert.equal((await request(bff.port, "GET", "/api/reports?run_id=run-r1")).status, 401, "未登录 401");
});

test("正常服务：HTML 全量返回 + 安全头齐（charset/nosniff/CSP）；download=1 → attachment；属主通过后网关被以本人身份确认", async () => {
  const { bff, gw, sid, reportsDir } = await setup();
  mkdirSync(join(reportsDir, "sess-gw"), { recursive: true });
  const html = "<html><body>REPORT-BODY</body></html>";
  writeFileSync(join(reportsDir, "sess-gw", "run-r1.html"), html);
  seedReport(bff, "sess-gw/run-r1.html");

  const res = await request(bff.port, "GET", "/api/reports?run_id=run-r1", { cookie: `sid=${sid}` });
  assert.equal(res.status, 200);
  assert.equal(res.raw, html, "文件内容全量返回");
  assert.equal(res.headers["content-type"], "text/html; charset=utf-8");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.equal(
    res.headers["content-security-policy"],
    "default-src 'none'; script-src 'unsafe-inline' 'self'; style-src 'unsafe-inline' 'self'; img-src 'self' data:; font-src 'self' data:",
    "CSP 收紧但留内联脚本（报告含内联 ECharts）",
  );
  assert.equal(res.headers["content-disposition"], undefined, "预览不加 attachment");

  const seen = gw.requests.find((r) => r.url === "/api/tasks/run-r1");
  assert.ok(seen, "以登录身份反代网关做二次确认");
  assert.equal(seen.headers["x-user"], "zhang");
  assert.equal(seen.headers.authorization, `Bearer ${GATEWAY_TOKEN}`);

  const dl = await request(bff.port, "GET", "/api/reports?run_id=run-r1&download=1", { cookie: `sid=${sid}` });
  assert.equal(dl.status, 200);
  assert.match(String(dl.headers["content-disposition"]), /^attachment; filename=/, "download 分支");
  assert.equal(dl.raw, html);
});

test("路径遏制：../ 穿越与绝对路径 → 404 不出内容；网关确认 403/404 透传拒绝；缺文件/未落账 → 404", async () => {
  const outside = mkdtempSync(join(tmpdir(), "bff-outside-"));
  dirs.push(outside);
  writeFileSync(join(outside, "evil.html"), "PWNED");
  const { bff, sid } = await setup();

  // ../ 逃逸（resolve 到 REPORTS_DIR 之外）
  seedReport(bff, `../../${basename(outside)}/evil.html`, "run-esc1");
  assert.equal((await request(bff.port, "GET", "/api/reports?run_id=run-esc1", { cookie: `sid=${sid}` })).status, 404);

  // 绝对路径逃逸
  seedReport(bff, join(outside, "evil.html"), "run-esc2");
  const abs = await request(bff.port, "GET", "/api/reports?run_id=run-esc2", { cookie: `sid=${sid}` });
  assert.equal(abs.status, 404);
  assert.notEqual(abs.raw, "PWNED");

  // 记账属主通过但网关判非属主/不存在 → 透传拒绝（防御纵深）
  let gwStatus = 403;
  let gwBody = { error: { code: "FORBIDDEN", message: "task owner mismatch" } };
  const deep = await setup({
    handler: (_req: any, res: any) => {
      res.writeHead(gwStatus, { "Content-Type": "application/json" });
      res.end(JSON.stringify(gwBody));
    },
  });
  seedReport(deep.bff, "sess-gw/run-r1.html");
  assert.equal((await request(deep.bff.port, "GET", "/api/reports?run_id=run-r1", { cookie: `sid=${deep.sid}` })).status, 403);
  gwStatus = 404;
  gwBody = { error: { code: "NOT_FOUND", message: "task not found" } };
  assert.equal((await request(deep.bff.port, "GET", "/api/reports?run_id=run-r1", { cookie: `sid=${deep.sid}` })).status, 404);

  // 缺文件 / 未落账 report_path / 缺 run_id 参数
  seedReport(bff, "sess-gw/missing.html", "run-miss");
  assert.equal((await request(bff.port, "GET", "/api/reports?run_id=run-miss", { cookie: `sid=${sid}` })).status, 404);
  const ui2 = bff.store.createUiSession("zhang", "无报告会话");
  bff.store.insertMessage({ uiSessionId: ui2.id, runId: "run-norep", gatewaySessionId: "sess-gw", question: "q" });
  assert.equal((await request(bff.port, "GET", "/api/reports?run_id=run-norep", { cookie: `sid=${sid}` })).status, 404);
  assert.equal((await request(bff.port, "GET", "/api/reports", { cookie: `sid=${sid}` })).status, 400);
});
