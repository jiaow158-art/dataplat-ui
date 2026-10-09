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
  EventCenterPayload,
  FeedbackCategory,
  IncidentRow,
  IncidentStatus,
  InsightActiveEvent,
  InsightDaily,
  InsightEventDetail,
  InsightFollowupResult,
  InsightHealthScore,
  InsightRelated,
  InsightTimelineItem,
  InsightTrend,
  KnowledgeFileMeta,
  KnowledgePublishResult,
  MeInfo,
  MessageRow,
  RegionMapPayload,
  StatsResult,
  TargetOverview,
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
export const apiCreateSession = (title?: string) => api<UiSession>("POST", "/api/sessions", title ? { title } : {});
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

// ── M-i3 经营洞察 ─────────────────────────────────────────────────────────────────
export const apiInsightEnabled = () => api<{ enabled: boolean }>("GET", "/api/insight/enabled");
export const apiInsightDaily = (date?: string) =>
  api<InsightDaily>("GET", `/api/insight/daily${date ? `?date=${encodeURIComponent(date)}` : ""}`);
export const apiInsightEvent = (id: string) =>
  api<InsightEventDetail>("GET", `/api/insight/events/${encodeURIComponent(id)}`);
export const apiInsightTimeline = (days = 30) =>
  api<InsightTimelineItem[]>("GET", `/api/insight/timeline?days=${days}`);
export const apiInsightFollowup = (eventId: string, prompt?: string) =>
  api<InsightFollowupResult>("POST", `/api/insight/events/${encodeURIComponent(eventId)}/followup`, prompt ? { prompt } : {});

// ── M-i5 驾驶舱 v1.1（健康分/活跃事件/迷你趋势/关联事件）──────────────────────────
export const apiInsightHealthScore = () => api<InsightHealthScore>("GET", "/api/insight/health-score");
export const apiInsightActiveEvents = () => api<{ briefDate: string; events: InsightActiveEvent[] }>("GET", "/api/insight/events?state=active");
export const apiInsightTrend = (eventId: string, months = 12) =>
  api<InsightTrend>("GET", `/api/insight/events/${encodeURIComponent(eventId)}/trend?months=${months}`);
export const apiInsightRelated = (eventId: string) =>
  api<InsightRelated>("GET", `/api/insight/events/${encodeURIComponent(eventId)}/related`);

// ── M-i6 经营事件中心（state=all 全量统计口径，服务端唯一权威）──────────────────────
export const apiInsightEventCenter = () => api<EventCenterPayload>("GET", "/api/insight/events?state=all");
export const apiInsightSubscriptions = () => api<{items: Array<Record<string, unknown>>}>("GET", "/api/insight/subscriptions");
export const apiInsightAddSubscription = (body: {kind:string; value:string; label?:string}) => api<Record<string, unknown>>("POST", "/api/insight/subscriptions", body);
export const apiInsightRemoveSubscription = (id:string) => api<{removed:boolean}>("DELETE", `/api/insight/subscriptions/${encodeURIComponent(id)}`);
export const apiInsightNotifications = () => api<{items: Array<Record<string, unknown>>}>("GET", "/api/insight/notifications");
export const apiInsightReadAllNotifications = () => api<{updated:number}>("POST", "/api/insight/notifications/read-all", {});

// ── M-i7 目标管理（口径服务端唯一权威；annual/months/centers 可局部降级）──────────────
export const apiInsightTargetOverview = () => api<TargetOverview>("GET", "/api/insight/target-overview");

// ── M-i8 区域作战地图（五块可局部降级；同窗同比/level 三档/事件关联口径全在服务端）───────
export const apiInsightRegionMap = () => api<RegionMapPayload>("GET", "/api/insight/region-map");

// ── SCH-1 数据更新管理（仅 is_admin；BFF 门禁 + insight-api token 双保险）──────────────
export interface InsightPipelineRun {
  run_id: string; job_type: string; phase: string; brief_date: string | null;
  status: string; trigger_type: string; triggered_by: string | null;
  scheduled_at: number | null; started_at: number | null; finished_at: number | null;
  retry_count: number; error_message: string | null; heartbeat_at: number | null;
}
export interface InsightAdminStatus {
  scheduler: { v: string; updated_at: number } | null;
  lock: { holder: string; acquired_at: number; heartbeat_at: number; brief_date: string | null } | null;
  recent_runs: InsightPipelineRun[];
  queue: Array<{ request_id: string; action: string; brief_date: string | null; requested_by: string; requested_at: number; status: string; note: string | null }>;
  cache: Array<{ key: string }>;
  freeze_note: string;
}
export const apiInsightAdminStatus = () => api<InsightAdminStatus>("GET", "/api/insight/admin/status");
export const apiInsightAdminTrigger = (action: string, briefDate?: string) =>
  api<{ request_id: string; status: string }>("POST", "/api/insight/admin/trigger", { action, brief_date: briefDate });
