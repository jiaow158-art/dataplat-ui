// UI-T6 主区：对话流 + 底部输入框。
// Turn 模型：history（BFF 记账静态回显）/ live（SSE 进行中，含仍在跑的历史任务重连回放）/
// submitting（/api/ask 在途）/ submit-failed（提交层失败：429、网关不可达等，可整问重发）。
// 切会话：GET messages → 终态行渲染 history、非终态行挂 live（网关按 seq 全量补发，D15）。
// 历史数据用 forId 派生而非 effect 内同步重置（切换期渲染 loading，不产生级联 render）。
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ApiError, apiAsk, apiListMessages } from "../api";
import type { MessageRow } from "../types";
import HistoryTurn from "./HistoryTurn";
import RunStream from "./RunStream";

type Turn =
  | { kind: "history"; row: MessageRow }
  | { kind: "live"; runId: string; question: string; startedAt: number; uiSessionId?: string }
  | { kind: "submitting"; question: string }
  | { kind: "submit-failed"; question: string; message: string };

const isTerminalStatus = (st: string) => st === "succeeded" || st === "failed" || st === "cancelled";

interface ChatViewProps {
  sessionId: string | null;
  sessionTitle: string;
  /** 首问成功（BFF 自动建 UI 会话）后切 activeId，父级刷新会话列表拿新标题。 */
  onFirstAsk: (uiSessionId: string) => void;
  /** 追问成功后刷侧栏（updated_at 排序）。 */
  onSessionActivity: () => void;
  /** P3 边界1（方案B）：技术详情入口仅管理员——透传 RunStream。 */
  isAdmin: boolean;
  /** 驾驶舱 followup 一次性种子：变化且匹配当前会话且空闲时自动发送一次。 */
  autoAsk?: string;
  onAutoAskDone?: () => void;
}

interface SessionView {
  forId: string | null;
  turns: Turn[];
  error: string | null;
}

export default function ChatView({
  sessionId,
  sessionTitle,
  onFirstAsk,
  onSessionActivity,
  isAdmin,
  autoAsk,
  onAutoAskDone,
}: ChatViewProps) {
  const [view, setView] = useState<SessionView | null>(null);
  const [busy, setBusy] = useState(false); // ask 在途：锁输入，防双击重复提交
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    apiListMessages(sessionId)
      .then((rows) => {
        if (cancelled) return;
        setView({
          forId: sessionId,
          error: null,
          turns: rows.map((row): Turn =>
            isTerminalStatus(row.status)
              ? { kind: "history", row }
              : { kind: "live", runId: row.run_id, question: row.question, startedAt: row.created_at, uiSessionId: row.ui_session_id },
          ),
        });
      })
      .catch((err) => {
        if (!cancelled) setView({ forId: sessionId, turns: [], error: err instanceof ApiError ? err.message : "历史加载失败" });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const turns = view && view.forId === sessionId ? view.turns : [];
  const loadError = view && view.forId === sessionId ? view.error : null;

  const setTurns = (fn: (t: Turn[]) => Turn[]) =>
    setView((v) => (v && v.forId === sessionId ? { ...v, turns: fn(v.turns) } : v));

  // 内容增长自动吸底（用户上翻则不打扰）
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight;
  }, [turns]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (el) pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const ask = async (question: string) => {
    if (busy || !question.trim()) return;
    setBusy(true);
    setView((v) => ({ forId: sessionId, error: null, turns: [...(v && v.forId === sessionId ? v.turns : []), { kind: "submitting", question }] }));
    pinnedRef.current = true;
    try {
      const r = await apiAsk(question, sessionId ?? undefined);
      if (!sessionId) {
        onFirstAsk(r.ui_session_id); // 重载为真实会话视图（新消息行 status=queued → live）
      } else {
        setTurns((t) => t.map((x) => (x.kind === "submitting" && x.question === question ? { kind: "live", runId: r.run_id, question, startedAt: Date.now(), uiSessionId: r.ui_session_id } : x)));
        onSessionActivity();
      }
    } catch (err) {
      const message = err instanceof ApiError ? err.message : "提交失败，请重试";
      setTurns((t) => t.map((x) => (x.kind === "submitting" && x.question === question ? { kind: "submit-failed", question, message } : x)));
    } finally {
      setBusy(false);
    }
  };

  // 驾驶舱 followup 种子：autoAsk 变化且匹配当前会话、历史已加载且空闲时经 ask 自动发送一次（ref 防重复）。
  // 必须等 view.forId===sessionId：autoAsk 首发恰逢会话切换，apiListMessages 的回填会整体替换 turns，
  // 先行追加的 submitting turn 会被清掉 → 任务在跑但界面空白（2026-09-29 生产实测）。
  const autoRef = useRef<string | null>(null);
  useEffect(() => {
    if (autoAsk && autoRef.current !== autoAsk && sessionId && !busy
      && view && view.forId === sessionId) {
      autoRef.current = autoAsk;
      void ask(autoAsk);
      onAutoAskDone?.();
    }
  }, [autoAsk, sessionId, busy, view, ask, onAutoAskDone]);

  const retrySubmit = (question: string) => {
    // 整问重发：BFF 每次生成新 submission_id（真重跑，非网络层幂等重试）
    setTurns((t) => t.filter((x) => !(x.kind === "submit-failed" && x.question === question)));
    void ask(question);
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-ck-bg">
      <div className="flex h-12 shrink-0 items-center border-b border-ck-line bg-ck-card px-5">
        <span className="truncate text-sm text-ck-ink-2">{sessionTitle}</span>
      </div>

      <div ref={scrollRef} onScroll={onScroll} className="ck-scroll flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
          {turns.length === 0 && !loadError && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-20 text-center">
              <div className="text-lg font-medium text-ck-ink">问点什么吧</div>
              <div className="text-xs text-ck-ink-3">例如：上月瓷砖事业部库存周转情况如何？</div>
            </div>
          )}
          {loadError && <div className="rounded-lg border border-ck-danger/40 bg-ck-danger-soft px-4 py-2 text-xs text-ck-danger">{loadError}</div>}
          {turns.map((t, i) =>
            t.kind === "history" ? (
              <HistoryTurn key={t.row.id} row={t.row} />
            ) : t.kind === "live" ? (
              <RunStream
                key={t.runId}
                runId={t.runId}
                question={t.question}
                startedAt={t.startedAt}
                uiSessionId={t.uiSessionId}
                isAdmin={isAdmin}
                onRetry={(q) => {
                  setTurns((xs) => xs.filter((_, j) => j !== i));
                  void ask(q);
                }}
              />
            ) : t.kind === "submitting" ? (
              <div key={`sub-${i}`} className="flex flex-col gap-3">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg rounded-br-sm bg-ck-primary-soft px-4 py-2.5 text-sm text-ck-ink">{t.question}</div>
                </div>
                <div className="flex items-center gap-2 text-xs text-ck-ink-3">已提交，等待任务受理…</div>
              </div>
            ) : (
              <div key={`fail-${i}`} className="flex flex-col gap-3">
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-lg rounded-br-sm bg-ck-primary-soft px-4 py-2.5 text-sm text-ck-ink">{t.question}</div>
                </div>
                <div className="flex items-center justify-between rounded-lg border border-ck-danger/40 bg-ck-danger-soft px-4 py-3 text-xs">
                  <span className="text-ck-danger">提交失败 · {t.message}</span>
                  <button
                    type="button"
                    className="rounded border border-ck-danger/50 px-2.5 py-1 text-xs text-ck-danger hover:bg-ck-danger/20"
                    onClick={() => retrySubmit(t.question)}
                  >
                    重新提问
                  </button>
                </div>
              </div>
            ),
          )}
        </div>
      </div>

      <Composer disabled={busy} onSend={(q) => void ask(q)} />
    </main>
  );
}

function Composer({ disabled, onSend }: { disabled: boolean; onSend: (q: string) => void }) {
  const [draft, setDraft] = useState("");

  const send = () => {
    const q = draft.trim();
    if (!q || disabled) return;
    setDraft("");
    onSend(q);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault(); // 中文 IME 选词回车不误发
      send();
    }
  };

  return (
    <div className="shrink-0 border-t border-ck-line bg-ck-card px-4 py-3">
      <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
        <textarea
          className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-ck-line-strong bg-ck-card px-3 py-2 text-sm text-ck-ink outline-none focus:border-ck-primary disabled:opacity-60"
          rows={1}
          placeholder="输入问题，Enter 发送（Shift+Enter 换行）"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
        />
        <button
          type="button"
          className="rounded-lg bg-ck-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-ck-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={disabled || !draft.trim()}
          onClick={send}
        >
          提问
        </button>
      </div>
    </div>
  );
}
