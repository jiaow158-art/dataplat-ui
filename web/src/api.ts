// BFF API 客户端：fetch 封装。浏览器只信 cookie（红线：全前端无任何 token 概念）；
// 错误统一归一为 ApiError{status, code, message}（BFF 错误体 {error:{code,message}} 封闭集）。
import type {
  AdminAuditOpRow,
  AdminUserRow,
  AskResult,
  AuditDateResult,
  AuditRunResult,
  AuditUserResult,
  DomainRequestRow,
  DomainRequestStatus,
  FeedbackCategory,
  IncidentRow,
  IncidentStatus,
  KnowledgeFileMeta,
  KnowledgePublishResult,
  MeInfo,
  MessageRow,
  StatsResult,
  TaskStatus,
  UiSession,
  UrgencyLevel,
} from "./types";

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, "NETWORK", "无法连接服务器，请稍后重试");
  }
  if (!res.ok) {
    let code = "HTTP_ERROR";
    let message = `请求失败（HTTP ${res.status}）`;
    try {
      const j = (await res.json()) as { error?: { code?: string; message?: string } };
      if (j.error?.code) code = j.error.code;
      if (j.error?.message) message = j.error.message;
    } catch {
      /* 非 JSON 错误体：保留兜底文案 */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ── 账号会话 ──────────────────────────────────────────────────────────────────────

export const apiMe = () => api<MeInfo>("GET", "/api/me");
export const apiLogin = (username: string, password: string) =>
  api<{ username: string }>("POST", "/api/auth/login", { username, password });
export const apiLogout = () => api<void>("POST", "/api/auth/logout");

// ── UI 会话 CRUD ──────────────────────────────────────────────────────────────────

export const apiListSessions = () => api<UiSession[]>("GET", "/api/sessions");
export const apiCreateSession = () => api<UiSession>("POST", "/api/sessions", {});
export const apiRenameSession = (id: string, title: string) =>
  api<UiSession>("PATCH", `/api/sessions/${encodeURIComponent(id)}`, { title });
export const apiDeleteSession = (id: string) =>
  api<void>("DELETE", `/api/sessions/${encodeURIComponent(id)}`);

// ── 对话流（UI-T6） ───────────────────────────────────────────────────────────────

export const apiAsk = (question: string, uiSessionId?: string) =>
  api<AskResult>("POST", "/api/ask", uiSessionId ? { question, ui_session_id: uiSessionId } : { question });
export const apiListMessages = (uiSessionId: string) =>
  api<MessageRow[]>("GET", `/api/sessions/${encodeURIComponent(uiSessionId)}/messages`);
export const apiTaskStatus = (runId: string) =>
  api<TaskStatus>("GET", `/api/tasks/${encodeURIComponent(runId)}/status`);

// ── 用户反馈闭环（知识健康治理 §三B）──────────────────────────────────────────────

export const apiSubmitFeedback = (
  runId: string,
  category: FeedbackCategory,
  description?: string,
  uiSessionId?: string,
) =>
  api<IncidentRow>("POST", "/api/feedback", {
    run_id: runId,
    ui_session_id: uiSessionId,
    category,
    description,
  });

// ── 管理后台（M4-B2/B3/B4；cookie 会话 + BFF 侧 admin 守卫） ────────────────────────

export const apiAdminUsers = () => api<AdminUserRow[]>("GET", "/api/admin/users");
export const apiAdminCreateUser = (username: string, password: string, isAdmin: boolean) =>
  api<AdminUserRow>("POST", "/api/admin/users", { username, password, is_admin: isAdmin });
export const apiAdminResetPassword = (username: string, password: string) =>
  api<{ username: string }>("POST", `/api/admin/users/${encodeURIComponent(username)}/reset-password`, { password });
export const apiAdminSetDisabled = (username: string, disabled: boolean) =>
  api<AdminUserRow>("POST", `/api/admin/users/${encodeURIComponent(username)}/${disabled ? "disable" : "enable"}`);
export const apiAdminAuditOps = (limit = 50) =>
  api<AdminAuditOpRow[]>("GET", `/api/admin/audit-ops?limit=${limit}`);
export const apiAdminAuditUser = (name: string, since?: string) =>
  api<AuditUserResult>(
    "GET",
    `/api/admin/audit/user?name=${encodeURIComponent(name)}${since ? `&since=${since}` : ""}`,
  );
export const apiAdminAuditRun = (runId: string) =>
  api<AuditRunResult>("GET", `/api/admin/audit/run/${encodeURIComponent(runId)}`);
export const apiAdminAuditDate = (date: string) =>
  api<AuditDateResult>("GET", `/api/admin/audit/date?date=${encodeURIComponent(date)}`);
export const apiAdminStats = () => api<StatsResult>("GET", "/api/admin/stats");
export const apiAdminSuggest = (q: string) =>
  api<{ users: string[]; run_ids: string[] }>("GET", `/api/admin/audit/suggest?q=${encodeURIComponent(q)}`);
export const apiAdminIncidents = (status?: string, limit = 100) =>
  api<IncidentRow[]>(
    "GET",
    `/api/admin/incidents?${status ? `status=${encodeURIComponent(status)}&` : ""}limit=${limit}`,
  );
export const apiAdminUpdateIncident = (
  id: string,
  body: { status?: IncidentStatus; resolution_note?: string; fix_commit?: string },
) => api<IncidentRow>("PATCH", `/api/admin/incidents/${encodeURIComponent(id)}`, body);

// ── 知识库管理入口 + 域申请（知识健康治理 §四）──────────────────────────────────────

export const apiAdminKnowledgeFiles = () => api<KnowledgeFileMeta[]>("GET", "/api/admin/knowledge/files");
export const apiAdminKnowledgeFile = (path: string) =>
  api<{ path: string; content: string }>("GET", `/api/admin/knowledge/file?path=${encodeURIComponent(path)}`);
/** 保存即发布：走 harness 发布脚本过 C2 门（79 场景离线回归）；门拒时 ok:false 且内容已回滚。 */
export const apiAdminKnowledgePublish = (path: string, content: string, message: string) =>
  api<KnowledgePublishResult>("POST", "/api/admin/knowledge/publish", { path, content, message });

export const apiSubmitDomainRequest = (
  domain_name: string,
  urgency: UrgencyLevel,
  example_questions?: string,
) => api<DomainRequestRow>("POST", "/api/domain-requests", { domain_name, urgency, example_questions });

export const apiAdminDomainRequests = (status?: DomainRequestStatus, limit = 200) =>
  api<DomainRequestRow[]>(
    "GET",
    `/api/admin/domain-requests?${status ? `status=${encodeURIComponent(status)}&` : ""}limit=${limit}`,
  );
export const apiAdminUpdateDomainRequest = (id: string, body: { status?: DomainRequestStatus; note?: string }) =>
  api<DomainRequestRow>("PATCH", `/api/admin/domain-requests/${encodeURIComponent(id)}`, body);
