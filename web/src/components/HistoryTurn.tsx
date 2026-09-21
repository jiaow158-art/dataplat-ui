// UI-T6：历史回合（BFF messages 记账的静态回显）——切会话时 GET messages 渲染既有问答。
// 非 run 事件流驱动：answer_md/report_path/status 都是 SSE 途经 BFF 时落账的快照。
import type { MessageRow } from "../types";
import FeedbackControl from "./FeedbackControl";
import Markdown from "./Markdown";
import ReportCard from "./ReportCard";

export default function HistoryTurn({ row }: { row: MessageRow }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-accent-soft px-4 py-2.5 text-sm whitespace-pre-wrap text-ink">
          {row.question}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {row.answer_md ? (
          <div className="rounded-lg border border-line bg-card px-4 py-3">
            <Markdown source={row.answer_md} />
          </div>
        ) : row.status === "failed" ? (
          <div className="rounded border border-bad/40 bg-bad/10 px-4 py-2 text-xs text-bad">该次提问未成功（{row.status}）</div>
        ) : (
          <div className="text-xs text-ink-3">（该次提问无回答记录）</div>
        )}
        {row.report_path && <ReportCard runId={row.run_id} />}
        {row.answer_md && <FeedbackControl runId={row.run_id} uiSessionId={row.ui_session_id} />}
      </div>
    </div>
  );
}
