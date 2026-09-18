// BFF API 客户端：fetch 封装。浏览器只信 cookie（红线：全前端无任何 token 概念）；
// 错误统一归一为 ApiError{status, code, message}（BFF 错误体 {error:{code,message}} 封闭集）。
import type { AskResult, MessageRow, TaskStatus, UiSession } from "./types";

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

export const apiMe = () => api<{ username: string }>("GET", "/api/me");
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
