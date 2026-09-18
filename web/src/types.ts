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
