export default function EventExecutiveSummary({ summary, attributionStatus }: { summary: string; attributionStatus: string }) {
  const label = attributionStatus === "done" ? "已归因" : attributionStatus === "degraded" ? "归因降级（AI 原文）" : attributionStatus === "failed" ? "归因失败" : "归因生成中";
  return (
    <div className="rounded-xl bg-white p-6 ring-1 ring-slate-100">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-900">AI 执行摘要</h3>
        <span className="text-xs text-slate-400">{label}</span>
      </div>
      <p className="mt-3 text-sm leading-6 text-slate-700">{summary}</p>
    </div>
  );
}
