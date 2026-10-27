// UI-T6 + P3 三层化：进行中/刚完成的一次提问（live turn）——SSE 六类事件全渲染。
// P3 边界（2026-10-07 裁定）：
//   层1 经营答案（AnswerCard，answer 到达即第一视觉——边界4）；
//   层2 分析过程（业务化 stage 时间线，全员可见，默认折叠）；
//   层3 技术详情（SQL 编号/行数/耗时/工具名/tokens，仅 isAdmin 入口——边界1 方案B，位于答案之后）。
//   运行态 AnalysisStatus 只显业务阶段 + 已完成计数，不显「第 N 项」——边界3。
// 普通经营用户默认全程不见 SQL/工具日志；反馈闭环（§三B）保留。
import { useEffect, useState } from "react";
import { recoveryNoticeText, useTaskStream, type SqlRecord, type StreamState } from "../hooks/useTaskStream.ts";
import AnswerCard from "./AnswerCard";
import FeedbackControl from "./FeedbackControl";
import ReportCard from "./ReportCard";

interface RunStreamProps {
  runId: string;
  question: string;
  startedAt: number;
  /** 反馈提交时随行（可选）——定位对话上下文。 */
  uiSessionId?: string;
  /** 边界1（方案B）：技术详情入口仅管理员渲染；普通用户只有经营答案与业务化过程。 */
  isAdmin: boolean;
  onRetry: (question: string) => void;
  onTerminal?: () => void;
}

export default function RunStream({ runId, question, startedAt, uiSessionId, isAdmin, onRetry, onTerminal }: RunStreamProps) {
  const s = useTaskStream(runId, onTerminal);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (s.terminal) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [s.terminal]);

  const elapsedMs = s.done?.elapsedMs ?? (s.terminal ? null : now - startedAt);
  const scriptRuns = s.timeline.filter((m) => m.stage === "script_running").length;
  // 已完成计数 = SQL 完成数 + 脚本数。脚本 stage 事件=调用开始（无独立完成事件），
  // 在跑的那一个尚未完成，扣除——运行中不虚报，终态时自然等于全部（诚实计数，边界3）。
  const inFlightScript = !s.terminal && s.stage === "script_running";
  const doneCount = s.sqls.length + scriptRuns - (inFlightScript ? 1 : 0);

  return (
    <div className="flex flex-col gap-3">
      <QuestionBubble text={question} />

      {/* 层1：经营答案第一视觉（边界4）；报告卡同属业务产出紧随其后 */}
      {s.answer && <AnswerCard markdown={s.answer} />}
      {s.reportPath && <ReportCard runId={runId} />}

      {/* 过程区：运行期间占主视觉；answer 到达后退居答案之下 */}
      <ProcessBlock s={s} isAdmin={isAdmin} doneCount={doneCount} elapsedMs={elapsedMs} />

      {s.recoveryRequired && <RecoveryNotice s={s} />}

      {s.error && (
        <ErrorBar
          code={s.error.code}
          message={s.error.message}
          onRetry={s.recoveryRequired ? undefined : () => onRetry(question)}
        />
      )}
      {s.terminal && s.answer && <FeedbackControl runId={runId} uiSessionId={uiSessionId} />}
    </div>
  );
}

// ── 过程区（层2/层3 容器与开合）──────────────────────────────────────────────────

function ProcessBlock({ s, isAdmin, doneCount, elapsedMs }: { s: StreamState; isAdmin: boolean; doneCount: number; elapsedMs: number | null }) {
  const [showProcess, setShowProcess] = useState(false);
  const [showTech, setShowTech] = useState(false);
  // recovery 由独立 RecoveryNotice 承载；不显示运行中 spinner，也不落“分析完成”。
  if (s.recoveryRequired) return null;
  const running = !s.terminal;
  const failed = s.error != null || s.done?.status === "failed";

  if (running) {
    return (
      <div className="flex flex-col gap-2">
        <AnalysisStatus s={s} doneCount={doneCount} elapsedMs={elapsedMs} />
        {isAdmin && (
          <TechToggle open={showTech} onToggle={() => setShowTech((v) => !v)} />
        )}
        {isAdmin && showTech && <TechDetailPanel s={s} />}
      </div>
    );
  }

  // 终态：收成一行 + 折叠入口（边界4：位于答案之后）
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ck-ink-3">
        {s.done?.status === "cancelled" ? (
          <span>任务已取消</span>
        ) : !failed ? (
          <span className="font-medium text-ck-success">✓ 分析完成</span>
        ) : null /* 失败文案由 ErrorBar 承担（收尾行不重复“任务失败”字样，review finding） */}
        {!failed && doneCount > 0 && <span>已完成 {doneCount} 项数据查询与分析</span>}
        {s.done?.elapsedMs != null && <span>总耗时 {fmtElapsed(s.done.elapsedMs)}</span>}
        {s.done?.recovered && (
          <span className="rounded bg-ck-warning-soft px-1.5 py-0.5 text-[10px] text-ck-warning">恢复重试</span>
        )}
        {s.terminalFromStatus && <span>（过程事件流中断，结果以任务状态为准）</span>}
        <button
          type="button"
          className="rounded px-1 text-ck-primary transition-colors hover:underline"
          onClick={() => setShowProcess((v) => !v)}
        >
          {showProcess ? "收起分析过程" : "查看分析过程"}
        </button>
        {isAdmin && (
          <button
            type="button"
            className="rounded px-1 text-ck-ink-3 transition-colors hover:text-ck-ink hover:underline"
            onClick={() => setShowTech((v) => !v)}
          >
            {showTech ? "收起技术详情" : "查看技术详情"}
          </button>
        )}
      </div>
      {showProcess && <AnalysisProcessPanel s={s} />}
      {isAdmin && showTech && <TechDetailPanel s={s} />}
    </div>
  );
}

/** 运行态 AnalysisStatus：业务阶段 + 已完成计数（边界3：不显「第 N 项」）。 */
function AnalysisStatus({ s, doneCount, elapsedMs }: { s: StreamState; doneCount: number; elapsedMs: number | null }) {
  const reconnecting = s.conn === "reconnecting";
  const label = s.stage ? (STAGE_LABEL[s.stage] ?? "正在分析经营数据…") : "已提交，等待任务受理…";
  return (
    <div className="rounded-xl border border-ck-line bg-ck-card px-4 py-3 shadow-ck">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="flex items-center gap-2 font-medium text-ck-ink">
          <Spinner />
          {label}
        </span>
        {reconnecting && (
          <span className="rounded bg-ck-warning-soft px-1.5 py-0.5 text-[11px] text-ck-warning">
            连接中断，自动重连中…（已收事件不丢失）
          </span>
        )}
        {s.attempt > 1 && (
          <span className="rounded bg-ck-warning-soft px-1.5 py-0.5 text-[11px] text-ck-warning">恢复中 · 第 {s.attempt} 次尝试</span>
        )}
        {elapsedMs != null && elapsedMs >= 0 && <span className="text-xs text-ck-ink-3">{fmtElapsed(elapsedMs)}</span>}
      </div>
      {doneCount > 0 && <div className="mt-1 text-xs text-ck-ink-3">已完成 {doneCount} 项数据查询与分析</div>}
    </div>
  );
}

/** 层2 分析过程：真实 stage 轨迹按连续段压缩（业务文案直译词表，零伪造步骤）。 */
function AnalysisProcessPanel({ s }: { s: StreamState }) {
  const groups: { stage: string; n: number }[] = [];
  for (const m of s.timeline) {
    const last = groups[groups.length - 1];
    if (last && last.stage === m.stage) last.n += 1;
    else groups.push({ stage: m.stage, n: 1 });
  }
  const lastStage = s.timeline.length > 0 ? s.timeline[s.timeline.length - 1].stage : null;
  return (
    <div className="rounded-xl border border-ck-line bg-ck-card-soft px-4 py-3">
      <div className="mb-2 text-xs font-medium text-ck-ink-2">分析过程</div>
      {groups.length === 0 ? (
        <div className="text-xs text-ck-ink-3">尚未收到执行阶段记录</div>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {groups.map((g, i) => {
            const active = !s.terminal && g.stage === lastStage && g.stage === s.stage;
            const unit = GROUP_UNIT[g.stage];
            return (
              <li key={i} className="flex items-center gap-2 text-xs">
                {active ? <Spinner /> : <span className="text-ck-success">✓</span>}
                <span className="text-ck-ink-2">{GROUP_LABEL[g.stage] ?? g.stage}</span>
                {g.n > 1 && unit && <span className="text-ck-ink-3">· {g.n} {unit}</span>}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/** 层3 入口（运行中，管理员）：默认折叠。 */
function TechToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="w-fit rounded px-1 text-xs text-ck-ink-3 transition-colors hover:text-ck-ink hover:underline"
      onClick={onToggle}
    >
      {open ? "收起技术详情" : "查看技术详情"}
    </button>
  );
}

/** 层3 技术详情（仅管理员渲染）：meta + SQL 明细 + 工具调用轨迹。
 *  SQL 按完成序编号（sqls 数组），工具行来自 stage 轨迹原文——两者不互相配对（并行调用下
 *  调用序≠完成序，配对会张冠李戴）。 */
function TechDetailPanel({ s }: { s: StreamState }) {
  const tokens = s.done?.tokens;
  const toolCalls = s.timeline.filter((m) => m.stage === "analyzing" || m.stage === "script_running");
  return (
    <div className="rounded-xl border border-ck-line bg-ck-card px-4 py-3">
      <div className="mb-2 text-xs font-medium text-ck-ink-2">技术详情</div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ck-ink-3">
        <span>SQL 查询 {s.sqls.length} 条</span>
        {s.done?.elapsedMs != null && <span>总耗时 {fmtElapsed(s.done.elapsedMs)}</span>}
        {tokens && (
          <span>
            tokens：输入 {tokens.input.toLocaleString()} / 输出 {tokens.output.toLocaleString()} / 缓存 {tokens.cache_read.toLocaleString()}
          </span>
        )}
        {s.attempt > 1 && <span className="rounded bg-ck-warning-soft px-1.5 py-0.5 text-[10px] text-ck-warning">恢复重试 · 第 {s.attempt} 次尝试</span>}
      </div>
      {s.sqls.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {s.sqls.map((rec, i) => (
            <SqlBar key={i} index={i} rec={rec} />
          ))}
        </div>
      )}
      {toolCalls.length > 0 && (
        <div className="mt-3 flex flex-col gap-1">
          <div className="text-[11px] text-ck-ink-3">工具调用（按到达序）</div>
          {toolCalls.map((m, i) => (
            <div key={i} className="truncate font-mono text-[11px] text-ck-ink-3" title={m.text ?? undefined}>
              {m.text ?? m.stage}
            </div>
          ))}
        </div>
      )}
      {s.sqls.length === 0 && toolCalls.length === 0 && <div className="text-xs text-ck-ink-3">暂无技术记录</div>}
    </div>
  );
}

// ── 子构件 ────────────────────────────────────────────────────────────────────────

function QuestionBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-lg rounded-br-sm bg-ck-primary-soft px-4 py-2.5 text-sm whitespace-pre-wrap text-ck-ink">
        {text}
      </div>
    </div>
  );
}

function SqlBar({ index, rec }: { index: number; rec: SqlRecord }) {
  const [open, setOpen] = useState(false);
  const rowsLabel = rec.rows == null ? "" : ` · ${rec.rows.toLocaleString()} 行${rec.truncated ? "（截断）" : ""}`;
  return (
    <div className="rounded border border-ck-line bg-ck-card-soft text-xs">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-ck-ink-2 hover:text-ck-ink"
        onClick={() => setOpen(!open)}
      >
        <span className={`inline-block transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
        <span>SQL #{index + 1}{rowsLabel}</span>
        {rec.elapsedMs != null && <span className="ml-auto text-ck-ink-3">{rec.elapsedMs} ms</span>}
      </button>
      {open && (
        <pre className="mx-3 mb-2 overflow-x-auto rounded bg-ck-bg p-2.5 font-mono text-[11px] leading-relaxed text-ck-ink-2">
          {rec.sql}
        </pre>
      )}
    </div>
  );
}

function RecoveryNotice({ s }: { s: StreamState }) {
  const text = recoveryNoticeText(s);
  return (
    <div className="rounded-lg border border-ck-warning/40 bg-ck-warning-soft px-4 py-3 text-xs">
      <div className="font-medium text-ck-warning">{text.title}</div>
      <div className="mt-1 text-ck-ink-2">{text.detail}</div>
      <div className="mt-1 text-ck-ink-3">系统会自动查询任务状态；恢复完成后可继续查看结果。</div>
    </div>
  );
}

function ErrorBar(props: { code: string; message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-ck-danger/40 bg-ck-danger-soft px-4 py-3 text-xs">
      <div>
        <div className="font-medium text-ck-danger">任务失败 · {props.code}</div>
        <div className="mt-0.5 text-ck-ink-2">{props.message}</div>
      </div>
      {props.onRetry && (
        <button
          type="button"
          className="shrink-0 rounded border border-ck-danger/50 px-2.5 py-1 text-xs text-ck-danger hover:bg-ck-danger/20"
          onClick={props.onRetry}
        >
          重新提问
        </button>
      )}
    </div>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-3.5 w-3.5 animate-spin ${className || "text-ck-primary"}`} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14.5 8A6.5 6.5 0 0 0 8 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** 层2 运行态业务文案：stage 词表直译（真实服务端状态，不伪造步骤——P3 扫描结论4）。 */
const STAGE_LABEL: Record<string, string> = {
  queued: "已提交，排队受理",
  analyzing: "正在理解问题",
  querying: "正在核对经营数据",
  script_running: "正在分析计算",
  report_checking: "正在生成报告",
  publishing: "正在发布报告",
  repairing: "正在恢复",
};

/** 层2 段名（完成态时间线用）。 */
const GROUP_LABEL: Record<string, string> = {
  queued: "排队受理",
  analyzing: "理解问题",
  querying: "核对经营数据",
  script_running: "分析计算",
  report_checking: "生成报告",
  publishing: "发布报告",
  repairing: "恢复重试",
};

/** 段计数单位（仅多段/多项时显示）。 */
const GROUP_UNIT: Record<string, string> = {
  querying: "项查询",
  script_running: "项脚本",
  repairing: "次",
};

function fmtElapsed(ms: number): string {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(sec < 10 ? 1 : 0)} 秒`;
  const m = Math.floor(sec / 60);
  const r = Math.round(sec % 60);
  return `${m} 分 ${r} 秒`;
}
