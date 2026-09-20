// UI-T2：BFF 数据记账层 —— SQLite 初始化 + 记账查询（spec §2/§3）。
// 与网关库分工：任务/事件的事实源永远是网关；本库是 UI 域便利副本（账号、登录会话、
// 会话标题、消息历史索引）——BFF 重启丢记账不影响任务正确性，只影响历史回显（spec §8 已接受）。
// better-sqlite3 同步 API + WAL（与网关同栈同约定：WAL 未生效即拒绝启动）。
import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface UserRow {
  username: string;
  password_hash: string;
  is_admin: number;
  created_at: number;
}

export interface SessionRow {
  token: string;
  username: string;
  expires_at: number;
}

export interface UiSessionRow {
  id: string;
  username: string;
  title: string;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  ui_session_id: string;
  run_id: string;
  gateway_session_id: string;
  question: string;
  answer_md: string | null;
  report_path: string | null;
  status: string;
  created_at: number;
}

export interface InsertMessageInput {
  uiSessionId: string;
  runId: string;
  gatewaySessionId: string;
  question: string;
}

export interface LoginLogRow {
  id: string;
  username: string;
  token_prefix: string;
  created_at: number;
  expires_at: number;
  logout_at: number | null;
}

/** M4-B5 留痕动作封闭集（user_disable/user_enable 为 B2 用户管理页预留）。 */
export type AdminAuditAction =
  | "user_create"
  | "user_disable"
  | "user_enable"
  | "password_reset"
  | "grant_admin"
  | "revoke_admin";

export interface AdminAuditRow {
  id: string;
  username: string;
  action: AdminAuditAction;
  target: string;
  detail: string | null;
  created_at: number;
}

/** 建库：DATA_DIR 下 bff.db，WAL 断言（对齐网关 src/server/index.ts 的启动围栏）。 */
export function initDb(dataDir: string): Database.Database {
  mkdirSync(dataDir, { recursive: true });
  const db = new Database(join(dataDir, "bff.db"));
  db.pragma("journal_mode = WAL");
  const journalMode = db.pragma("journal_mode", { simple: true });
  if (journalMode !== "wal") {
    db.close();
    throw new Error(`[CONFIG] WAL 未生效（journal_mode=${journalMode}）——网络盘/旧文件系统会丢并发写，拒绝启动`);
  }
  db.exec(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8"));
  // M4-B1：旧库补列（SQLite 的 ADD COLUMN 无 IF NOT EXISTS——pragma 检测后 ALTER，幂等；
  // 新库由 schema.sql 直接带上该列，此处自然跳过）。
  const userCols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
  if (!userCols.some((c) => c.name === "is_admin")) {
    db.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0");
  }
  return db;
}

export class BffStore {
  private db: Database.Database;
  private now: () => number;

  constructor(db: Database.Database, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  // ---------- 账号（admin CLI 写，登录读） ----------

  /** upsert 账号；返回是否新建（false = 改密）。opts.isAdmin 建号/改密时置角色；不传则不动角色。 */
  upsertUser(username: string, passwordHash: string, opts?: { isAdmin?: boolean }): boolean {
    const created = this.getUser(username) === undefined;
    if (created) {
      this.db
        .prepare("INSERT INTO users (username, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?)")
        .run(username, passwordHash, opts?.isAdmin ? 1 : 0, this.now());
    } else if (opts?.isAdmin !== undefined) {
      this.db
        .prepare("UPDATE users SET password_hash = ?, is_admin = ? WHERE username = ?")
        .run(passwordHash, opts.isAdmin ? 1 : 0, username);
    } else {
      this.db.prepare("UPDATE users SET password_hash = ? WHERE username = ?").run(passwordHash, username);
    }
    return created;
  }

  getUser(username: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
  }

  /** M4-B1 角色翻转（admin:grant 用）；返回用户是否存在。 */
  setAdmin(username: string, isAdmin: boolean): boolean {
    return this.db.prepare("UPDATE users SET is_admin = ? WHERE username = ?").run(isAdmin ? 1 : 0, username).changes > 0;
  }

  // ---------- 管理操作留痕（M4-B5：CLI 与 B2 程序化入口都经此处落账） ----------

  insertAdminAudit(entry: { username: string; action: AdminAuditAction; target: string; detail?: string }): AdminAuditRow {
    const row: AdminAuditRow = {
      id: `aa-${randomUUID()}`,
      username: entry.username,
      action: entry.action,
      target: entry.target,
      detail: entry.detail ?? null,
      created_at: this.now(),
    };
    this.db
      .prepare("INSERT INTO admin_audit (id, username, action, target, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(row.id, row.username, row.action, row.target, row.detail, row.created_at);
    return row;
  }

  /** 管理操作留痕查询（B2 界面用）：新到旧。 */
  listAdminAudit(limit: number): AdminAuditRow[] {
    return this.db.prepare("SELECT * FROM admin_audit ORDER BY created_at DESC, rowid DESC LIMIT ?").all(limit) as AdminAuditRow[];
  }

  // ---------- 登录会话 ----------

  createSession(token: string, username: string, expiresAt: number): void {
    this.db.prepare("INSERT INTO sessions (token, username, expires_at) VALUES (?, ?, ?)").run(token, username, expiresAt);
  }

  findSession(token: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE token = ?").get(token) as SessionRow | undefined;
  }

  deleteSession(token: string): boolean {
    return this.db.prepare("DELETE FROM sessions WHERE token = ?").run(token).changes > 0;
  }

  /** 顺手清掉已过期行（登录时调用，免单开清扫任务）。 */
  pruneExpiredSessions(now: number): number {
    return this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now).changes;
  }

  // ---------- 登录记账（M4-B6 旁路：不动 sessions 语义） ----------

  /** 登录成功写一行（token_prefix=token 前 6 位——不存全 token，对齐网关 audit.mjs 惯例）。 */
  recordLogin(username: string, tokenPrefix: string, createdAt: number, expiresAt: number): void {
    this.db
      .prepare("INSERT INTO login_log (id, username, token_prefix, created_at, expires_at) VALUES (?, ?, ?, ?, ?)")
      .run(`ll-${randomUUID()}`, username, tokenPrefix, createdAt, expiresAt);
  }

  /** 登出终态：按 token 前缀定位最近一行未登出记录置 logout_at（未命中返回 false——行可能已被置终态）。 */
  markLogout(token: string, at: number): boolean {
    return this.db
      .prepare(
        `UPDATE login_log SET logout_at = ?
         WHERE id = (SELECT id FROM login_log WHERE token_prefix = ? AND logout_at IS NULL
                     ORDER BY created_at DESC, rowid DESC LIMIT 1)`,
      )
      .run(at, token.slice(0, 6)).changes > 0;
  }

  /** 登录史查询（管理员端点用）：可选按用户过滤，新到旧。 */
  listLogins(user: string | undefined, limit: number): LoginLogRow[] {
    const sql = user
      ? "SELECT * FROM login_log WHERE username = ? ORDER BY created_at DESC, rowid DESC LIMIT ?"
      : "SELECT * FROM login_log ORDER BY created_at DESC, rowid DESC LIMIT ?";
    return (user ? this.db.prepare(sql).all(user, limit) : this.db.prepare(sql).all(limit)) as LoginLogRow[];
  }

  // ---------- UI 会话（spec §4：标题=首问前 30 字，可重命名） ----------

  createUiSession(username: string, title: string): UiSessionRow {
    const ts = this.now();
    const row: UiSessionRow = { id: `us-${randomUUID()}`, username, title, created_at: ts, updated_at: ts };
    this.db
      .prepare("INSERT INTO ui_sessions (id, username, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .run(row.id, row.username, row.title, row.created_at, row.updated_at);
    return row;
  }

  /** 本人会话列表（最近活跃在前）。 */
  listUiSessions(username: string): UiSessionRow[] {
    return this.db
      .prepare("SELECT * FROM ui_sessions WHERE username = ? ORDER BY updated_at DESC, rowid DESC")
      .all(username) as UiSessionRow[];
  }

  getUiSession(id: string): UiSessionRow | undefined {
    return this.db.prepare("SELECT * FROM ui_sessions WHERE id = ?").get(id) as UiSessionRow | undefined;
  }

  renameUiSession(id: string, title: string): UiSessionRow {
    this.db.prepare("UPDATE ui_sessions SET title = ?, updated_at = ? WHERE id = ?").run(title, this.now(), id);
    return this.getUiSession(id)!;
  }

  touchUiSession(id: string): void {
    this.db.prepare("UPDATE ui_sessions SET updated_at = ? WHERE id = ?").run(this.now(), id);
  }

  /** 删 UI 记账（网关侧任务按其自身策略保留——spec §8 非目标）；级联清 messages。 */
  deleteUiSession(id: string): boolean {
    return this.db.transaction((): boolean => {
      this.db.prepare("DELETE FROM messages WHERE ui_session_id = ?").run(id);
      return this.db.prepare("DELETE FROM ui_sessions WHERE id = ?").run(id).changes > 0;
    })();
  }

  // ---------- 消息记账（ask 提交/SSE 途经事件落账） ----------

  insertMessage(input: InsertMessageInput): MessageRow {
    const row: MessageRow = {
      id: `msg-${randomUUID()}`,
      ui_session_id: input.uiSessionId,
      run_id: input.runId,
      gateway_session_id: input.gatewaySessionId,
      question: input.question,
      answer_md: null,
      report_path: null,
      status: "queued",
      created_at: this.now(),
    };
    this.db
      .prepare(
        `INSERT INTO messages (id, ui_session_id, run_id, gateway_session_id, question, answer_md, report_path, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.ui_session_id, row.run_id, row.gateway_session_id, row.question, row.answer_md, row.report_path, row.status, row.created_at);
    return row;
  }

  getMessageByRunId(runId: string): MessageRow | undefined {
    return this.db.prepare("SELECT * FROM messages WHERE run_id = ?").get(runId) as MessageRow | undefined;
  }

  listMessages(uiSessionId: string): MessageRow[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE ui_session_id = ? ORDER BY created_at, rowid")
      .all(uiSessionId) as MessageRow[];
  }

  /** 本 UI 会话最近一次提问的网关逻辑会话（追问时透传，D14 历史注入在网关侧）。 */
  latestGatewaySessionId(uiSessionId: string): string | null {
    const r = this.db
      .prepare("SELECT gateway_session_id FROM messages WHERE ui_session_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
      .get(uiSessionId) as { gateway_session_id: string } | undefined;
    return r?.gateway_session_id ?? null;
  }

  updateMessageAnswer(runId: string, answerMd: string): boolean {
    return this.db.prepare("UPDATE messages SET answer_md = ? WHERE run_id = ?").run(answerMd, runId).changes > 0;
  }

  updateMessageReport(runId: string, reportPath: string): boolean {
    return this.db.prepare("UPDATE messages SET report_path = ? WHERE run_id = ?").run(reportPath, runId).changes > 0;
  }

  updateMessageStatus(runId: string, status: string): boolean {
    return this.db.prepare("UPDATE messages SET status = ? WHERE run_id = ?").run(status, runId).changes > 0;
  }
}
