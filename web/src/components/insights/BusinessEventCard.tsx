import { useEffect, useState } from "react";
import { apiInsightTrend } from "../../api";
import type { InsightDailyEvent, InsightTrend } from "../../types";
import PrimaryButton from "../cockpit/PrimaryButton";
import StatusTag from "../cockpit/StatusTag";
import MiniTrendChart from "./MiniTrendChart";

export const severityStyle = (e: { severity: string }) =>
  e.severity === "major"
    ? { chip: "bg-red-50 text-red-600", bar: "bg-red-500" }
    : e.severity === "minor"
      ? { chip: "bg-orange-50 text-orange-500", bar: "bg-orange-400" }
      : { chip: "bg-blue-50 text-blue-600", bar: "bg-blue-500" };
const severityLabel = (e: InsightDailyEvent) =>
  e.eventType === "target_gap" ? "目标偏差" : e.severity === "major" ? "重大异常" : "一般异常";

// P1-1 AI 洞察状态行：pending/running→分析中；failed→引导 AI问数；
// degraded、done 但摘要为空、未知态→降级口径（不编原因）。attributionSummary 只在 done 态渲染。
const insightLine = (status: string): string =>
  status === "pending" || status === "running"
    ? "AI归因分析中"
    : status === "failed"
      ? "自动归因暂未完成，可进入 AI问数继续分析"
      : "AI归因分析降级完成，详见事件详情";

export default function BusinessEventCard({
  event, rank, onOpen,
}: { event: InsightDailyEvent; rank: number; onOpen: (id: string) => void }) {
  const st = severityStyle(event);
  const [trend, setTrend] = useState<InsightTrend | null>(null);
  useEffect(() => {
    let alive = true;                                   // 卸载防泄漏
    apiInsightTrend(event.eventId).then((t) => alive && setTrend(t)).catch(() => {});
    return () => { alive = false; };
  }, [event.eventId]);
  const summary = event.attributionSummary?.trim();
  return (
    <div className="group relative overflow-hidden rounded-xl border border-ck-line bg-ck-card shadow-ck transition-colors hover:border-ck-line-strong">
      <div className={`absolute inset-y-0 left-0 w-1 ${st.bar}`} />
      <div className="p-4 pl-5">
        <div className="flex items-center gap-2">
          <span className="text-xs text-ck-ink-3">0{rank}</span>
          <StatusTag tone={event.severity === "major" ? "danger" : "warning"} size="sm">{severityLabel(event)}</StatusTag>
          {event.persistDays > 1 && (
            <span className="rounded-full bg-ck-card-soft px-2 py-0.5 text-xs text-ck-ink-3">持续第 {event.persistDays} 天</span>
          )}
        </div>
        <h3 className="mt-2 line-clamp-2 text-base font-semibold tracking-[-0.02em] text-ck-ink">{event.title}</h3>
        <p className="mt-1 line-clamp-1 text-xs text-ck-ink-3">{event.summary}</p>
        {trend && trend.series.length > 0 && trend.series.some((p) => p.cur != null || p.prev != null) && (
          <div className="mt-2"><MiniTrendChart trend={trend} height={88} /></div>
        )}
        <div className="mt-3 flex flex-wrap gap-4">
          {event.facts.slice(0, 2).map((f) => (
            <div key={f.label}>
              <div className="text-xs text-ck-ink-3">{f.label}</div>
              <div className="text-sm font-medium text-ck-ink">{f.value}</div>
            </div>
          ))}
        </div>
        {event.attributionStatus === "done" && summary ? (
          <div className="mt-3 rounded-lg bg-ck-primary-soft p-2.5">
            <div className="text-[11px] font-medium text-ck-primary">AI 洞察</div>
            <p className="mt-0.5 line-clamp-3 text-xs text-ck-ink-2">{summary}</p>
          </div>
        ) : (
          <div className="mt-3 text-xs text-ck-ink-3">{insightLine(event.attributionStatus)}</div>
        )}
        <PrimaryButton size="sm" className="mt-3" onClick={() => onOpen(event.eventId)}>
          查看详情
        </PrimaryButton>
      </div>
    </div>
  );
}
