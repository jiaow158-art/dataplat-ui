// UI-T6：进行中/刚完成的一次提问（live turn）——SSE 六类事件全渲染。
// 结构：用户问题气泡 → 过程区（stage 状态条 + sql 折叠条）→ 回答气泡 → 报告卡片 → 终态条。
// 终态有回答时挂「有问题」反馈入口（反馈闭环 §三B）。
import { useEffect, useState } from "react";
import { useTaskStream, type SqlRecord } from "../hooks/useTaskStream";
import FeedbackControl from "./FeedbackControl";
import Markdown from "./Markdown";
import ReportCard from "./ReportCard";

interface RunStreamProps {
  runId: string;
  question: string;
  startedAt: number;
  /** 反馈提交时随行（可选）——定位对话上下文。 */
  uiSessionId?: string;
  onRetry: (question: string) => void;
  onTerminal?: () => void;
}

export default function RunStream({ runId, question, startedAt, uiSessionId, onRetry, onTerminal }: RunStreamProps) {
  const s = useTaskStream(runId, onTerminal);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (s.terminal) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [s.terminal]);

  const elapsedMs = s.done?.elapsedMs ?? (s.terminal ? null : now - startedAt);

  return (
    <div className="flex flex-col gap-3">
      <QuestionBubble text={question} />

      <div className="flex flex-col gap-2">
        {!s.terminal && <StatusStrip conn={s.conn} stageText={s.stageText ?? "已提交"} attempt={s.attempt} elapsedMs={elapsedMs} />}
        {s.sqls.map((rec, i) => (
          <SqlBar key={i} index={i} rec={rec} />
        ))}
        {s.answer && (
          <div className="rounded-lg border border-line bg-card px-4 py-3">
            <Markdown source={s.answer} />
          </div>
        )}
        {s.reportPath && <ReportCard runId={runId} />}
        {s.terminal && s.answer && <FeedbackControl runId={runId} uiSessionId={uiSessionId} />}
        {s.error && <ErrorBar code={s.error.code} message={s.error.message} onRetry={() => onRetry(question)} />}
        {s.done && <DoneBar info={s.done} fromStatus={s.terminalFromStatus} />}
      </div>
    </div>
  );
}

// ── 子构件 ────────────────────────────────────────────────────────────────────────

function QuestionBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent-soft px-4 py-2.5 text-sm whitespace-pre-wrap text-ink">
        {text}
      </div>
    </div>
  );
}

function StatusStrip(props: { conn: string; stageText: string; attempt: number; elapsedMs: number | null }) {
  const reconnecting = props.conn === "reconnecting";
  return (
    <div className="flex items-center gap-2 text-xs">
      {reconnecting ? (
        <span className="flex items-center gap-1.5 text-warn">
          <Spinner className="text-warn" />
          连接中断，自动重连中…（已收事件不丢失）
        </span>
      ) : (
        <span className="flex items-center gap-1.5 text-ink-2">
          <Spinner />
          {props.stageText}
        </span>
      )}
      {props.attempt > 1 && (
        <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">恢复中 · 第 {props.attempt} 次尝试</span>
      )}
      {props.elapsedMs != null && props.elapsedMs >= 0 && <span className="text-ink-3">{fmtElapsed(props.elapsedMs)}</span>}
    </div>
  );
}

function SqlBar({ index, rec }: { index: number; rec: SqlRecord }) {
  const [open, setOpen] = useState(false);
  const rowsLabel = rec.rows == null ? "" : ` · ${rec.rows.toLocaleString()} 行${rec.truncated ? "（截断）" : ""}`;
  return (
    <div className="rounded border border-line bg-panel text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ink-2 hover:text-ink"
        onClick={() => setOpen(!open)}
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <span>SQL #{index + 1}{rowsLabel}</span>
        {rec.elapsedMs != null && <span className="ml-auto text-ink-3">{rec.elapsedMs} ms</span>}
      </button>
      {open && (
        <pre className="mx-3 mb-2 overflow-x-auto rounded bg-base p-2.5 font-mono text-[11px] leading-relaxed text-ink-2">
          {rec.sql}
        </pre>
      )}
    </div>
  );
}

function ErrorBar(props: { code: string; message: string; onRetry: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded border border-bad/40 bg-bad/10 px-4 py-3 text-xs">
      <div>
        <div className="font-medium text-bad">任务失败 · {props.code}</div>
        <div className="mt-0.5 text-ink-2">{props.message}</div>
      </div>
      <button
        type="button"
        className="shrink-0 rounded border border-bad/50 px-2.5 py-1 text-xs text-bad hover:bg-bad/20"
        onClick={props.onRetry}
      >
        重新提问
      </button>
    </div>
  );
}

function DoneBar(props: { info: { status: string; elapsedMs: number | null; tokens: { input: number; output: number; cache_read: number } | null; recovered: boolean }; fromStatus: boolean }) {
  const { status, elapsedMs, tokens, recovered } = props.info;
  if (status === "cancelled") {
    return <div className="text-xs text-ink-3">任务已取消</div>;
  }
  const meta = (
    <>
      {elapsedMs != null && <span>耗时 {fmtElapsed(elapsedMs)}</span>}
      {tokens && (
        <span>
          tokens：输入 {tokens.input.toLocaleString()} / 输出 {tokens.output.toLocaleString()} / 缓存 {tokens.cache_read.toLocaleString()}
        </span>
      )}
      {recovered && <span className="rounded bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">恢复重试</span>}
    </>
  );
  if (status === "failed") {
    // 失败终态：原因已在 ErrorBar 展示，这里只补计费/耗时 meta
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
        {meta}
        {props.fromStatus && <span>（过程事件流中断，结果以任务状态为准）</span>}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-3">
      <span className="text-good">✓ 已完成</span>
      {meta}
      {props.fromStatus && <span>（过程事件流中断，结果以任务状态为准）</span>}
    </div>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-3 w-3 animate-spin ${className || "text-accent-2"}`} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function fmtElapsed(ms: number): string {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)} 秒`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return `${m} 分 ${r} 秒`;
}
