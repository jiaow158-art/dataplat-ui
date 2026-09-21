// BFF API 的载荷类型（对齐 server/src/db.ts 行结构与契约 §2/§6 字段白名单）。

export interface UiSession {
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
  status: string; // queued | running | succeeded | failed | cancelled
  created_at: number;
}

export interface AskResult {
  run_id: string;
  session_id: string;
  ui_session_id: string;
}

export interface TaskStatus {
  run_id: string;
  session_id: string;
  status: string; // queued | running | succeeded | failed | cancelled
  stage: string | null;
  attempt: number;
  error_code: string | null;
  created_at: number;
}

// ── 管理后台（M4-B2/B3/B4；对齐 server/src/app.ts admin 端点响应形态）─────────────────

export interface MeInfo {
  username: string;
  is_admin: number; // 0 | 1
}

export interface AdminUserRow {
  username: string;
  is_admin: number;
  disabled: number;
  created_at: number;
}

export interface AdminAuditOpRow {
  id: string;
  username: string; // 操作者（CLI 记 "<cli>"）
  action: string; // user_create|user_disable|user_enable|password_reset|grant_admin|revoke_admin
  target: string;
  detail: string | null;
  created_at: number;
}

/** 任务时间线卡（按用户/按日期共用形态；user 供按日期全员视图标注归属）。 */
export interface AuditTaskItem {
  kind: "task";
  ts: number;
  run_id: string;
  user: string;
  question: string;
  status: string;
  attempt: number;
  elapsed_ms: number | null;
  elapsed_source: "done" | "wall";
  sql_count: number;
  sql_rows: (number | null)[];
  answer_excerpt: string | null;
  report_path: string | null;
  error_code: string | null;
  error_message: string | null;
}

export interface AuditUserResult {
  user: string;
  since: string | null;
  items: (
    | AuditTaskItem
    | { kind: "account"; ts: number }
    | { kind: "login"; ts: number; token_prefix: string; expires_at: number; logout_at: number | null }
  )[];
}

export interface AuditDateResult {
  date: string;
  summary: { tasks: number; by_status: Record<string, number>; by_user: { user: string; n: number }[] };
  items: (
    | AuditTaskItem
    | { kind: "account" | "ui_session"; ts: number; username: string; title?: string }
    | { kind: "login"; ts: number; username: string; token_prefix: string; logout_at: number | null }
  )[];
}

export interface AuditRunEvent {
  seq: number;
  type: string; // stage | sql | answer | report | error | done
  payload: any;
  created_at: number;
}

export interface AuditRunResult {
  task: {
    run_id: string;
    session_id: string;
    user: string;
    scope_group: string;
    question: string;
    status: string;
    stage: string | null;
    attempt: number;
    error_code: string | null;
    error_message: string | null;
    created_at: number;
    updated_at: number;
    deadline: number | null;
  };
  events: AuditRunEvent[];
  elapsed_ms: number | null;
  report_path: string | null;
  bff: {
    ui_session: { id: string; title: string; created_at: number } | null;
    message: { id: string; status: string; created_at: number; report_path: string | null } | null;
  } | null;
}

// ── 用户反馈闭环（知识健康治理 §三B；对齐 server/src/db.ts 封闭集）──────────────────

export type FeedbackCategory = "数值不对" | "口径不对" | "看不懂" | "其他";
export type IncidentStatus = "待归因" | "修复中" | "已发布" | "驳回";

export interface IncidentRow {
  id: string;
  username: string;
  run_id: string;
  ui_session_id: string | null;
  category: FeedbackCategory;
  description: string | null;
  status: IncidentStatus;
  resolution_note: string | null;
  fix_commit: string | null;
  created_at: number;
  updated_at: number;
  /** 联 messages 按 run_id 带出的问题文本（管理队列直读；无对应消息行为 null）。 */
  question: string | null;
}

export interface StatsResult {
  totals: {
    all: number;
    succeeded: number;
    failed: number;
    cancelled: number;
    running: number;
    queued: number;
    terminal: number;
    success_rate_pct: number | null;
  };
  active_users: number;
  tokens: { input: number; output: number; cache_read: number };
  today: { date: string; tasks: number; users: string[]; new_users: number };
  daily: { date: string; count: number }[]; // 近 14 天（末日=今日）
  fail_by_code: { code: string; count: number; sample_message: string | null }[];
  failed: {
    run_id: string;
    user: string;
    question: string;
    status: string;
    error_code: string | null;
    attempt: number;
    created_at: number;
  }[];
}
