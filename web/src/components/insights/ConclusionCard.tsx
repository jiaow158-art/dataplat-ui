// ED-1 L2：AI 分析摘要（归因 done/degraded）或事件检测事实（pending/failed/running——
// 修正4/验收6：pending 不得呈现"AI 已归因"假象）。红线：内容零改写、不做首句截取冒充结论——
// 默认 3~4 行（line-clamp-4）+ 展开完整内容。
import { useState } from "react";
import SectionCard from "../cockpit/SectionCard";

export default function ConclusionCard({ summary, attributionStatus }: { summary: string; attributionStatus: string }) {
  const [open, setOpen] = useState(false);
  const isAi = attributionStatus === "done" || attributionStatus === "degraded";
  const label =
    attributionStatus === "done" ? "AI 归因 · 分析完成"
    : attributionStatus === "degraded" ? "AI 归因 · 降级完成"
    : attributionStatus === "failed" ? "检测层事实（归因失败）"
    : attributionStatus === "running" ? "检测层事实（AI 归因进行中）"
    : "检测层事实（AI 归因未生成）";
  return (
    <SectionCard>
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-semibold text-ck-ink">{isAi ? "AI 分析摘要" : "事件检测事实"}</h3>
        <span className="shrink-0 text-xs text-ck-ink-3">{label}</span>
      </div>
      <p className={`mt-3 text-sm leading-6 text-ck-ink-2 ${open ? "" : "line-clamp-4"}`}>{summary}</p>
      <button
        type="button"
        className="mt-2 text-xs text-ck-primary transition-colors hover:underline"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "收起" : "展开完整内容"}
      </button>
    </SectionCard>
  );
}
