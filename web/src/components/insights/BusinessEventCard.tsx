import { useEffect, useState } from "react";
import { apiInsightTrend } from "../../api";
import type { InsightDailyEvent, InsightTrend } from "../../types";
import MiniTrendChart from "./MiniTrendChart";

export const severityStyle = (e: { severity: string }) =>
  e.severity === "major"
    ? { chip: "bg-red-50 text-red-600", bar: "bg-red-500" }
    : e.severity === "minor"
      ? { chip: "bg-orange-50 text-orange-500", bar: "bg-orange-400" }
      : { chip: "bg-blue-50 text-blue-600", bar: "bg-blue-500" };
const severityLabel = (e: InsightDailyEvent) =>
  e.eventType === "target_gap" ? "目标偏差" : e.severity === "major" ? "重大异常" : "一般异常";

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
  const insight = event.attributionSummary?.trim() || null;
  return (
    <div className="relative overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-100">
      <div className={`absolute inset-y-0 left-0 w-1 ${st.bar}`} />
      <div className="p-5 pl-6">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">0{rank}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${st.chip}`}>{severityLabel(event)}</span>
          {event.persistDays > 1 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">持续第 {event.persistDays} 天</span>
          )}
        </div>
        <h3 className="mt-2 text-base font-semibold text-slate-900">{event.title}</h3>
        <p className="mt-1 line-clamp-2 text-sm text-slate-500">{event.summary}</p>
        <div className="mt-3"><MiniTrendChart trend={trend} /></div>
        <div className="mt-3 flex flex-wrap gap-4">
          {event.facts.slice(0, 3).map((f) => (
            <div key={f.label}>
              <div className="text-xs text-slate-400">{f.label}</div>
              <div className="text-sm font-medium text-slate-800">{f.value}</div>
            </div>
          ))}
        </div>
        {insight && (
          <div className="mt-3 rounded-lg bg-blue-50/60 p-3">
            <div className="text-[11px] font-medium text-blue-500">AI 洞察</div>
            <p className="mt-1 line-clamp-3 text-xs text-slate-600">{insight}</p>
          </div>
        )}
        <button
          className="mt-4 rounded-lg bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
          onClick={() => onOpen(event.eventId)}
        >
          查看详情
        </button>
      </div>
    </div>
  );
}
