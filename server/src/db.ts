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

  /** upsert 账号；返回是否新建（false = 改密）。 */
  upsertUser(username: string, passwordHash: string): boolean {
    const created = this.getUser(username) === undefined;
    this.db
      .prepare(
        `INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash`,
      )
      .run(username, passwordHash, this.now());
    return created;
  }

  getUser(username: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
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
