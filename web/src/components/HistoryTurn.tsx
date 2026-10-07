// UI-T6 + P3：历史回合（BFF messages 记账的静态回显）——切会话时 GET messages 渲染既有问答。
// 非 run 事件流驱动：answer_md/report_path/status 都是 SSE 途经 BFF 时落账的快照。
// 历史无 SQL/过程事件（协议既定）——与 live 完成态同观感：层1 答案卡直接呈现。
import type { MessageRow } from "../types";
import AnswerCard from "./AnswerCard";
import FeedbackControl from "./FeedbackControl";
import ReportCard from "./ReportCard";

export default function HistoryTurn({ row }: { row: MessageRow }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-lg rounded-br-sm bg-ck-primary-soft px-4 py-2.5 text-sm whitespace-pre-wrap text-ck-ink">
          {row.question}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        {row.answer_md ? (
          <AnswerCard markdown={row.answer_md} />
        ) : row.status === "failed" ? (
          <div className="rounded-lg border border-ck-danger/40 bg-ck-danger-soft px-4 py-2 text-xs text-ck-danger">该次提问未成功（{row.status}）</div>
        ) : (
          <div className="text-xs text-ck-ink-3">（该次提问无回答记录）</div>
        )}
        {row.report_path && <ReportCard runId={row.run_id} />}
        {row.answer_md && <FeedbackControl runId={row.run_id} uiSessionId={row.ui_session_id} />}
      </div>
    </div>
  );
}
