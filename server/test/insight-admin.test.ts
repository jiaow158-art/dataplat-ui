// SCH-1 数据更新管理面（BFF 层）：is_admin 门禁、Origin 拒绝、action 白名单、
// by=登录名服务端注入、token 透传到 insight-api（mock 上游断言头）。
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { hashPw, login, request, startBff, type BffHandle } from "./helpers.ts";

const openBff: BffHandle[] = [];
const openUps: http.Server[] = [];
afterEach(async () => {
  for (const h of openBff.splice(0)) await h.close();
  for (const s of openUps.splice(0)) { s.close(); s.closeAllConnections?.(); }
});

async function setup(flagOn = true) {
  const captured: { headers: http.IncomingHttpHeaders; body: string; url: string }[] = [];
  const up = http.createServer((req, res) => {
    let b = "";
    req.on("data", (c: Buffer) => (b += c));
    req.on("end", () => {
      captured.push({ headers: req.headers, body: b, url: req.url! });
      if (req.url === "/admin/status") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ scheduler: null, lock: null, recent_runs: [], queue: [], cache: [], freeze_note: "x" }));
      } else {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ request_id: "rq-1", status: "pending" }));
      }
    });
  });
  await new Promise<void>((r) => up.listen(0, "127.0.0.1", r));
  openUps.push(up);
  const port = (up.address() as import("node:net").AddressInfo).port;
  const bff = await startBff({ insightUrl: `http://127.0.0.1:${port}`, insightAdminToken: "tok-bff" });
  openBff.push(bff);
  bff.store.upsertUser("boss", hashPw("pw-boss-12345"), { isAdmin: true });
  bff.store.upsertUser("staff", hashPw("pw-staff-12345"));
  if (flagOn) {
    bff.store.setFlag("boss", "insight_cockpit", true);
    bff.store.setFlag("staff", "insight_cockpit", true);
  }
  const bossSid = (await login(bff.port, "boss", "pw-boss-12345")).sid!;
  const staffSid = (await login(bff.port, "staff", "pw-staff-12345")).sid!;
  return { bff, captured, bossSid, staffSid };
}

test("非管理员 403；管理员 200 且 token/用户名透传到上游", async () => {
  const { bff, captured, bossSid, staffSid } = await setup();
  // 普通用户：403（重型触发不可达——裁定4）
  assert.equal((await request(bff.port, "GET", "/api/insight/admin/status", { cookie: `sid=${staffSid}` })).status, 403);
  assert.equal((await request(bff.port, "POST", "/api/insight/admin/trigger", { cookie: `sid=${staffSid}`, body: { action: "daily_run" } })).status, 403);
  assert.equal(captured.length, 0, "门禁拦截在上游之前");
  // 管理员：透传
  const st = await request(bff.port, "GET", "/api/insight/admin/status", { cookie: `sid=${bossSid}` });
  assert.equal(st.status, 200);
  assert.equal(captured[0]!.headers["x-insight-admin-token"], "tok-bff");
  // POST：by=登录名注入、Origin 跨源拒绝
  const tr = await request(bff.port, "POST", "/api/insight/admin/trigger",
    { cookie: `sid=${bossSid}`, body: { action: "daily_run" } });
  assert.equal(tr.status, 201);
  assert.deepEqual(JSON.parse(captured.at(-1)!.body), { action: "daily_run", by: "boss" }, "by 由服务端注入");
  const cs = await request(bff.port, "POST", "/api/insight/admin/trigger",
    { cookie: `sid=${bossSid}`, headers: { origin: "https://evil.example" }, body: { action: "daily_run" } });
  assert.equal(cs.status, 403, "跨 Origin POST 拒绝");
  // action 白名单
  assert.equal((await request(bff.port, "POST", "/api/insight/admin/trigger",
    { cookie: `sid=${bossSid}`, body: { action: "phase_scan" } })).status, 400);
});

test("未配置 insightAdminToken → 503 封闭集", async () => {
  const bff = await startBff({ insightUrl: "http://127.0.0.1:1" }); // 无 token
  openBff.push(bff);
  bff.store.upsertUser("boss", hashPw("pw-boss-12345"), { isAdmin: true });
  bff.store.setFlag("boss", "insight_cockpit", true);
  const sid = (await login(bff.port, "boss", "pw-boss-12345")).sid!;
  const r = await request(bff.port, "GET", "/api/insight/admin/status", { cookie: `sid=${sid}` });
  assert.equal(r.status, 503);
  assert.equal(r.body.error.code, "INSIGHT_ADMIN_UNSET");
});

test("flag 关闭时管理面同样 403（gate 前置）", async () => {
  const { bff, bossSid } = await setup(false);
  const r = await request(bff.port, "GET", "/api/insight/admin/status", { cookie: `sid=${bossSid}` });
  assert.equal(r.status, 403);
  assert.equal(r.body.error.code, "FLAG_OFF");
});
