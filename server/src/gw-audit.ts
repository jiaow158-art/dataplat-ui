// M4-B3/B4：BFF 侧只读查询网关库（engine-gateway gateway.db 的 tasks/events/publications）。
// audit.mjs / pilot-daily.mjs 的 TS port。红线对齐：一律 { readonly: true } 打开、本模块
// 无任何写路径；调用方打开即查即关（不跨请求持有句柄——网关侧迁移/重启不留陈旧连接）。
// 事件 payload 形状由网关 spec §5 词表定义（stage/sql/answer/report/error/done），此处只读
// 不解释合法性——非法 JSON 保留 null，渲染层自行兜底。
import Database from "better-sqlite3";

export interface GwTaskRow {
  run_id: string;
  client_submission_id: string | null;
  session_id: string;
  user: string;
  scope_group: string;
  question: string;
  status: string;
  stage: string | null;
  attempt: number;
  lease_owner: string | null;
  lease_expires_at: number | null;
  cancel_requested: number;
  deadline: number | null;
  error_code: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export interface GwEventRow {
  seq: number;
  type: string;
  payload: any;
  created_at: number;
}

/** 只读打开网关库（fileMustExist：路径配了但文件不存在按错误处理，不静默建新库）。 */
export function openGwReadonly(path: string): Database.Database {
  return new Database(path, { readonly: true, fileMustExist: true });
}

const pad = (n: number) => String(n).padStart(2, "0");

/** 本地时区日键 YYYY-MM-DD（与网关侧 audit.mjs / pilot-daily.mjs 口径一致）。 */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** 压成单行并截断（时间线摘要用；JSON 输出无表格语境，不转义竖线）。 */
export function oneLine(s: unknown, n: number): string {
  const str = s == null ? "" : String(s).replace(/\s+/g, " ").trim();
  return str.length > n ? str.slice(0, n) + "…" : str;
}

/** 事件流（payload 安全解析；非法 JSON 保留 null）。 */
export function eventsOf(db: Database.Database, runId: string): GwEventRow[] {
  return (
    db.prepare("SELECT seq, type, payload, created_at FROM events WHERE run_id = ? ORDER BY seq").all(runId) as {
      seq: number;
      type: string;
      payload: string;
      created_at: number;
    }[]
  ).map((r) => {
    let payload: any = null;
    try {
      payload = JSON.parse(r.payload);
    } catch {
      /* 非法 payload 保留 null */
    }
    return { seq: r.seq, type: r.type, payload, created_at: r.created_at };
  });
}

export interface TaskDigest {
  sqlCount: number;
  /** SQL 事件序列的行数（truncated 在 UI 侧以 * 标注；行数缺失记 null）。 */
  rowsSeq: (number | null)[];
  elapsedMs: number | null;
  elapsedSource: "done" | "wall";
  answer: string | null;
  reportPath: string | null;
}

/** 单任务要点聚合（audit.mjs taskDigest 的 port：耗时优先 done 事件，退回墙钟）。 */
export function taskDigest(db: Database.Database, t: GwTaskRow): TaskDigest {
  const evs = eventsOf(db, t.run_id);
  const sqls = evs.filter((e) => e.type === "sql");
  const done = evs.find((e) => e.type === "done");
  const answer = [...evs].reverse().find((e) => e.type === "answer");
  const pub = db.prepare("SELECT report_path FROM publications WHERE run_id = ?").get(t.run_id) as
    | { report_path: string }
    | undefined;
  const reportPath: unknown = pub?.report_path ?? evs.find((e) => e.type === "report")?.payload?.path ?? null;
  return {
    sqlCount: sqls.length,
    rowsSeq: sqls.map((e) => (typeof e.payload?.rows === "number" ? e.payload.rows : null)),
    elapsedMs: typeof done?.payload?.elapsed_ms === "number" ? done.payload.elapsed_ms : t.updated_at - t.created_at,
    elapsedSource: done ? "done" : "wall",
    answer: typeof answer?.payload?.markdown === "string" ? answer.payload.markdown : null,
    reportPath: typeof reportPath === "string" ? reportPath : null,
  };
}

export function getTask(db: Database.Database, runId: string): GwTaskRow | undefined {
  return db.prepare("SELECT * FROM tasks WHERE run_id = ?").get(runId) as GwTaskRow | undefined;
}

export function tasksByUser(db: Database.Database, user: string): GwTaskRow[] {
  return db.prepare("SELECT * FROM tasks WHERE user = ? ORDER BY created_at, rowid").all(user) as GwTaskRow[];
}

export function allTasks(db: Database.Database): GwTaskRow[] {
  return db.prepare("SELECT * FROM tasks ORDER BY created_at, rowid").all() as GwTaskRow[];
}

/** [t0, t1) 创建时间窗（本地时区当日审计用）。 */
export function tasksInRange(db: Database.Database, t0: number, t1: number): GwTaskRow[] {
  return db
    .prepare("SELECT * FROM tasks WHERE created_at >= ? AND created_at < ? ORDER BY created_at, rowid")
    .all(t0, t1) as GwTaskRow[];
}

/** done 事件全量（tokens 聚合用；每 run 至多一条）。 */
export function doneEventRows(db: Database.Database): { run_id: string; payload: string }[] {
  return db.prepare("SELECT run_id, payload FROM events WHERE type = 'done'").all() as { run_id: string; payload: string }[];
}

/** run_id 前缀补全（LIKE 转义 %/_/\）。 */
export function runIdsByPrefix(db: Database.Database, prefix: string, limit: number): string[] {
  const esc = prefix.replace(/[\\%_]/g, (m) => `\\${m}`);
  return (
    db
      .prepare("SELECT run_id FROM tasks WHERE run_id LIKE ? ESCAPE '\\' ORDER BY created_at DESC LIMIT ?")
      .all(`${esc}%`, limit) as { run_id: string }[]
  ).map((r) => r.run_id);
}
