// M4-B3 审计查询页：三 Tab（按用户/按任务/按日期），结果为时间线卡片列表；
// 点任务卡就地展开 run 详情事件流（stage/sql/answer/report/error/done 分色渲染，
// SQL 一律 pre 文本——不 dangerouslySetInnerHTML）；时间本地时区显示。
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ApiError,
  apiAdminAuditDate,
  apiAdminAuditRun,
  apiAdminAuditUser,
  apiAdminSuggest,
} from "../../api";
import type { AuditRunEvent, AuditRunResult } from "../../types";
import { fmtClock, fmtDur, fmtInt, fmtTs, oneLine, statusClass } from "./format";

type Mode = "user" | "run" | "date";

const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// ── 事件流渲染（audit.mjs eventSummary 的界面版） ────────────────────────────────────

const EVENT_BADGE: Record<string, string> = {
  stage: "border-line text-ink-3",
  sql: "border-accent/40 text-accent-2",
  answer: "border-good/40 text-good",
  report: "border-warn/40 text-warn",
  error: "border-bad/40 text-bad",
  done: "border-accent/40 text-accent-2",
};

function EventRow({ ev }: { ev: AuditRunEvent }) {
  const p = ev.payload ?? {};
  const badge = EVENT_BADGE[ev.type] ?? "border-line text-ink-3";
  return (
    <div className="flex gap-2.5 py-1.5">
      <span className="w-16 shrink-0 pt-0.5 text-right font-mono text-[10px] text-ink-3">{fmtClock(ev.created_at)}</span>
      <span className={`h-fit shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] ${badge}`}>
        {ev.type}
      </span>
      <div className="min-w-0 flex-1 text-xs">
        {ev.type === "stage" && (
          <span className="text-ink-2">
            {p.stage ?? "?"}
            {p.to ? ` → ${p.to}（attempt ${p.attempt ?? "?"}）` : p.text ? ` · ${oneLine(p.text, 90)}` : ""}
          </span>
        )}
        {ev.type === "sql" && (
          <div>
            <div className="text-ink-2">
              rows={p.rows ?? "?"}
              {p.truncated ? "（截断）" : ""} · {fmtDur(p.elapsed_ms)} · ref {p.result_ref ?? "—"}
            </div>
            <pre className="mt-1 max-h-40 overflow-auto rounded border border-line bg-base px-2.5 py-1.5 font-mono text-[11px] leading-relaxed text-ink-2">
              {typeof p.sql === "string" ? p.sql : "（无 SQL 文本）"}
            </pre>
          </div>
        )}
        {ev.type === "answer" && (
          <span className="text-ink-2">
            markdown {fmtInt((p.markdown ?? "").length)} 字 · {oneLine(p.markdown, 120) || "—"}
          </span>
        )}
        {ev.type === "report" && <span className="break-all font-mono text-[11px] text-warn">{p.path ?? "?"}</span>}
        {ev.type === "error" && (
          <span className="text-bad">
            {p.code ?? "?"} · {oneLine(p.message, 140)}
          </span>
        )}
        {ev.type === "done" && (
          <span className="text-ink-2">
            <span className={statusClass(String(p.status ?? ""))}>{p.status ?? "?"}</span> · engine {p.engine ?? "?"} ·{" "}
            {fmtDur(p.elapsed_ms)}
            {p.tokens ? ` · tokens in ${fmtInt(p.tokens.input ?? 0)} / out ${fmtInt(p.tokens.output ?? 0)} / cache_read ${fmtInt(p.tokens.cache_read ?? 0)}` : ""}
            {p.recovered ? " · recovered" : ""}
          </span>
        )}
        {!["stage", "sql", "answer", "report", "error", "done"].includes(ev.type) && (
          <span className="text-ink-3">seq {ev.seq} · {ev.type}</span>
        )}
      </div>
    </div>
  );
}

/** run 详情：任务头卡 + 事件流（就地展开与按任务 Tab 共用）。 */
function RunDetail({ r }: { r: AuditRunResult }) {
  const t = r.task;
  return (
    <div className="mt-2 rounded-lg border border-line bg-base p-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs">
        <span className="font-mono text-[11px] text-ink-3">{t.run_id}</span>
        <span className="text-ink-2">
          {t.user} · 会话 <span className="font-mono text-[11px]">{t.session_id}</span>
        </span>
        <span className={statusClass(t.status)}>终态 {t.status}</span>
        <span className="text-ink-3">attempt {t.attempt} · 最终 stage {t.stage ?? "—"}</span>
        <span className="text-ink-3">耗时 {fmtDur(r.elapsed_ms)}</span>
        <span className="text-ink-3">
          {fmtTs(t.created_at)} → {fmtTs(t.updated_at)}
        </span>
      </div>
      <div className="mb-2 text-xs text-ink">{t.question}</div>
      {t.error_code && (
        <div className="mb-2 text-xs text-bad">
          {t.error_code} · {t.error_message ?? ""}
        </div>
      )}
      {r.report_path && (
        <div className="mb-2 text-xs text-warn">报告：{r.report_path}</div>
      )}
      {r.bff?.ui_session && (
        <div className="mb-2 text-[11px] text-ink-3">
          UI 会话「{r.bff.ui_session.title}」 · 记账状态 {r.bff.message?.status ?? "—"}
        </div>
      )}
      <div className="border-t border-line/60 pt-1">
        {r.events.map((ev) => (
          <EventRow key={ev.seq} ev={ev} />
        ))}
        {r.events.length === 0 && <div className="py-2 text-xs text-ink-3">（无事件）</div>}
      </div>
    </div>
  );
}

// ── 任务时间线卡（按用户/按日期共用） ────────────────────────────────────────────────

interface TaskCardItem {
  run_id: string;
  question: string;
  status: string;
  attempt: number;
  elapsed_ms: number | null;
  sql_count: number;
  sql_rows: (number | null)[];
  answer_excerpt: string | null;
  report_path: string | null;
  error_code: string | null;
  error_message: string | null;
  ts: number;
}

function TaskCard({
  item,
  username,
  expanded,
  onToggle,
}: {
  item: TaskCardItem;
  username?: string;
  expanded: { runId: string; detail: AuditRunResult | null; loading: boolean } | null;
  onToggle: (runId: string) => void;
}) {
  const open = expanded?.runId === item.run_id;
  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <button type="button" className="w-full text-left" onClick={() => onToggle(item.run_id)}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-xs text-ink-3">{fmtTs(item.ts)}</span>
          {username && <span className="text-xs text-ink-2">{username}</span>}
          <span className={`text-xs font-medium ${statusClass(item.status)}`}>{item.status}</span>
          <span className="text-xs text-ink">「{oneLine(item.question, 40)}」</span>
          <span className="ml-auto text-[10px] text-ink-3">{open ? "收起 ▲" : "详情 ▼"}</span>
        </div>
        <div className="mt-1 text-[11px] text-ink-3">
          {item.run_id.slice(0, 16)}… · attempt {item.attempt} · {fmtDur(item.elapsed_ms)} · SQL×{item.sql_count} rows=[
          {item.sql_rows.map((r) => (r == null ? "?" : String(r))).join(",")}]
          {item.report_path ? " · 有报告" : ""}
          {item.error_code ? ` · ${item.error_code}` : ""}
        </div>
        {item.answer_excerpt && <div className="mt-1 text-[11px] text-ink-2">答：{item.answer_excerpt}</div>}
      </button>
      {open &&
        (expanded?.loading ? (
          <div className="mt-2 text-xs text-ink-3">加载事件流…</div>
        ) : expanded?.detail ? (
          <RunDetail r={expanded.detail} />
        ) : (
          <div className="mt-2 text-xs text-bad">详情加载失败</div>
        ))}
    </div>
  );
}

// ── 页面 ───────────────────────────────────────────────────────────────────────────

export default function AuditPage({
  focusRun,
  onFocusConsumed,
}: {
  focusRun: string | null;
  onFocusConsumed: () => void;
}) {
  const [mode, setMode] = useState<Mode>("user");
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<{ runId: string; detail: AuditRunResult | null; loading: boolean } | null>(null);

  // 按用户
  const [nameInput, setNameInput] = useState("");
  const [sinceInput, setSinceInput] = useState("");
  const [userResult, setUserResult] = useState<{ user: string; items: any[] } | null>(null);
  const [userLoading, setUserLoading] = useState(false);
  const [nameSuggest, setNameSuggest] = useState<string[]>([]);

  // 按任务
  const [runInput, setRunInput] = useState("");
  const [runResult, setRunResult] = useState<AuditRunResult | null>(null);
  const [runLoading, setRunLoading] = useState(false);
  const [runSuggest, setRunSuggest] = useState<string[]>([]);

  // 按日期
  const [dateInput, setDateInput] = useState(todayStr());
  const [dateResult, setDateResult] = useState<{ summary: any; items: any[]; date: string } | null>(null);
  const [dateLoading, setDateLoading] = useState(false);

  const loadRun = useCallback(async (runId: string) => {
    setRunLoading(true);
    setError(null);
    try {
      setRunResult(await apiAdminAuditRun(runId));
    } catch (err) {
      setRunResult(null);
      setError(err instanceof ApiError ? err.message : "查询失败");
    } finally {
      setRunLoading(false);
    }
  }, []);

  // 统计页失败清单跳入：切到按任务 Tab 直查
  useEffect(() => {
    if (!focusRun) return;
    setMode("run");
    setRunInput(focusRun);
    void loadRun(focusRun);
    onFocusConsumed();
  }, [focusRun, loadRun, onFocusConsumed]);

  const searchUser = async () => {
    const name = nameInput.trim();
    if (!name) return;
    setUserLoading(true);
    setError(null);
    setExpanded(null);
    try {
      const r = await apiAdminAuditUser(name, sinceInput || undefined);
      setUserResult({ user: r.user, items: r.items });
    } catch (err) {
      setUserResult(null);
      setError(err instanceof ApiError ? err.message : "查询失败");
    } finally {
      setUserLoading(false);
    }
  };

  const searchDate = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      setError("日期格式应为 YYYY-MM-DD");
      return;
    }
    setDateLoading(true);
    setError(null);
    setExpanded(null);
    try {
      const r = await apiAdminAuditDate(dateInput);
      setDateResult({ summary: r.summary, items: r.items, date: r.date });
    } catch (err) {
      setDateResult(null);
      setError(err instanceof ApiError ? err.message : "查询失败");
    } finally {
      setDateLoading(false);
    }
  };

  /** 任务卡展开/收起：就地拉 run 详情。 */
  const toggleTask = async (runId: string) => {
    if (expanded?.runId === runId) {
      setExpanded(null);
      return;
    }
    setExpanded({ runId, detail: null, loading: true });
    try {
      const detail = await apiAdminAuditRun(runId);
      setExpanded({ runId, detail, loading: false });
    } catch {
      setExpanded({ runId, detail: null, loading: false });
    }
  };

  // 输入建议（防抖 250ms；suggest 为可选增强，失败静默）
  const suggestTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSuggestInput = (value: string) => {
    if (suggestTimer.current) clearTimeout(suggestTimer.current);
    if (!value.trim()) {
      setNameSuggest([]);
      setRunSuggest([]);
      return;
    }
    suggestTimer.current = setTimeout(() => {
      apiAdminSuggest(value.trim())
        .then((s) => {
          setNameSuggest(s.users);
          setRunSuggest(s.run_ids);
        })
        .catch(() => {
          /* 静默 */
        });
    }, 250);
  };

  const tabBtn = (m: Mode, label: string) => (
    <button
      type="button"
      className={`rounded px-3 py-1.5 text-xs transition-colors ${
        mode === m ? "bg-accent-soft text-ink" : "text-ink-3 hover:text-ink"
      }`}
      onClick={() => {
        setMode(m);
        setError(null);
      }}
    >
      {label}
    </button>
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-5">
      <div className="mb-4 flex gap-1 rounded-lg border border-line bg-panel p-1">
        {tabBtn("user", "按用户")}
        {tabBtn("run", "按任务")}
        {tabBtn("date", "按日期")}
      </div>

      {error && <div className="mb-4 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}

      {mode === "user" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              list="admin-audit-user-suggest"
              className="w-44 rounded border border-line bg-card px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
              placeholder="用户名"
              value={nameInput}
              onChange={(e) => {
                setNameInput(e.target.value);
                onSuggestInput(e.target.value);
              }}
            />
            <datalist id="admin-audit-user-suggest">
              {nameSuggest.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
            <input
              type="date"
              className="rounded border border-line bg-card px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
              value={sinceInput}
              onChange={(e) => setSinceInput(e.target.value)}
              title="仅看该日期起（可空）"
            />
            <button
              type="button"
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-50"
              disabled={!nameInput.trim() || userLoading}
              onClick={searchUser}
            >
              {userLoading ? "查询中…" : "查询"}
            </button>
          </div>
          {userResult && (
            <div className="space-y-2">
              <div className="text-xs text-ink-3">
                用户 {userResult.user} · {userResult.items.length} 条记录（任务 + 登录 + 开户）
              </div>
              {userResult.items.map((it, i) =>
                it.kind === "task" ? (
                  <TaskCard key={`t-${it.run_id}`} item={it} expanded={expanded} onToggle={toggleTask} />
                ) : (
                  <div key={`m-${i}`} className="flex items-center gap-2.5 rounded-lg border border-line/60 px-3 py-1.5 text-xs">
                    <span className="text-ink-3">{fmtTs(it.ts)}</span>
                    <span className="rounded bg-lift px-1.5 py-0.5 text-[10px] text-ink-3">
                      {it.kind === "login" ? "登录" : "开户"}
                    </span>
                    {it.kind === "login" && (
                      <span className="text-ink-3">
                        token {it.token_prefix}… · {it.logout_at ? `登出于 ${fmtTs(it.logout_at)}` : "存活/超时未登出"}
                      </span>
                    )}
                  </div>
                ),
              )}
              {userResult.items.length === 0 && <div className="py-6 text-center text-xs text-ink-3">（无记录）</div>}
            </div>
          )}
          {!userResult && !userLoading && <div className="py-6 text-center text-xs text-ink-3">输入用户名查询其任务与登录时间线</div>}
        </>
      )}

      {mode === "run" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              list="admin-audit-run-suggest"
              className="w-72 rounded border border-line bg-card px-2.5 py-1.5 font-mono text-xs text-ink outline-none focus:border-accent"
              placeholder="run_id（可输入前缀补全）"
              value={runInput}
              onChange={(e) => {
                setRunInput(e.target.value);
                onSuggestInput(e.target.value);
              }}
            />
            <datalist id="admin-audit-run-suggest">
              {runSuggest.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
            <button
              type="button"
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-50"
              disabled={!runInput.trim() || runLoading}
              onClick={() => loadRun(runInput.trim())}
            >
              {runLoading ? "查询中…" : "查询"}
            </button>
          </div>
          {runResult && <RunDetail r={runResult} />}
          {!runResult && !runLoading && <div className="py-6 text-center text-xs text-ink-3">输入 run_id 查任务全轨迹与事件流</div>}
        </>
      )}

      {mode === "date" && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <input
              type="date"
              className="rounded border border-line bg-card px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
            />
            <button
              type="button"
              className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-2 disabled:opacity-50"
              disabled={dateLoading}
              onClick={searchDate}
            >
              {dateLoading ? "查询中…" : "查询"}
            </button>
          </div>
          {dateResult && (
            <div className="space-y-2">
              <div className="rounded-lg border border-line bg-panel px-3 py-2 text-xs text-ink-3">
                {dateResult.date} · 任务 {dateResult.summary.tasks} 条（
                {Object.entries(dateResult.summary.by_status)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(" / ") || "无"}
                ）· 活跃 {dateResult.summary.by_user.map((u: any) => `${u.user}(${u.n})`).join("、") || "无"}
              </div>
              {dateResult.items.map((it, i) =>
                it.kind === "task" ? (
                  <TaskCard key={`t-${it.run_id}`} item={it} username={it.user} expanded={expanded} onToggle={toggleTask} />
                ) : (
                  <div key={`m-${i}`} className="flex items-center gap-2.5 rounded-lg border border-line/60 px-3 py-1.5 text-xs">
                    <span className="text-ink-3">{fmtTs(it.ts)}</span>
                    <span className="rounded bg-lift px-1.5 py-0.5 text-[10px] text-ink-3">
                      {it.kind === "login" ? "登录" : it.kind === "account" ? "开户" : "新会话"}
                    </span>
                    <span className="text-ink-2">{it.username}</span>
                    {it.kind === "login" && <span className="font-mono text-[10px] text-ink-3">{it.token_prefix}…</span>}
                    {it.kind === "ui_session" && <span className="text-ink-3">「{it.title}」</span>}
                  </div>
                ),
              )}
              {dateResult.items.length === 0 && <div className="py-6 text-center text-xs text-ink-3">（当日无记录）</div>}
            </div>
          )}
          {!dateResult && !dateLoading && <div className="py-6 text-center text-xs text-ink-3">选择日期查看全员行为一览</div>}
        </>
      )}
    </div>
  );
}
