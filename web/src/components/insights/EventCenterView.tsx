import { useEffect, useState } from "react";
import { apiInsightActiveEvents, apiInsightTimeline } from "../../api";
import type { InsightActiveEvent, InsightTimelineItem } from "../../types";
import SectionCard from "../cockpit/SectionCard";
import BusinessEventTimeline from "./BusinessEventTimeline";

export default function EventCenterView({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<InsightTimelineItem[] | null>(null);
  const [active, setActive] = useState<InsightActiveEvent[] | null>(null);
  useEffect(() => {
    apiInsightTimeline(90).then(setItems).catch(() => setItems([]));
    apiInsightActiveEvents().then((r) => setActive(r.events)).catch(() => setActive([]));
  }, []);
  const watching = (active ?? []).filter((e) => !e.publishedToday);
  return (
    <div className="flex flex-col gap-4">
      {watching.length > 0 && (
        <SectionCard title="观察中（活跃未上榜，分数距发布线）" extra={`${watching.length} 条`}>
          <div className="flex flex-col divide-y divide-slate-50">
            {watching.map((e) => (
              <button key={e.event_id} type="button" className="flex items-center gap-3 py-2 text-left hover:bg-slate-50"
                      onClick={() => onOpen(e.event_id)}>
                <span className={`w-1 self-stretch rounded ${e.severity === "major" ? "bg-red-500" : "bg-orange-400"}`} />
                <span className="min-w-0 flex-1 truncate text-sm text-slate-700">{e.title}</span>
                <span className="shrink-0 text-xs text-slate-400">持续 {e.persist_days} 天</span>
                <span className="shrink-0 text-xs text-slate-500">分 {e.score}</span>
                <span className="shrink-0 text-[11px] text-slate-400">距上榜 {e.scoreGap}</span>
              </button>
            ))}
          </div>
        </SectionCard>
      )}
      <SectionCard title="经营事件时间线（近 90 天）" extra={items ? `${items.length} 条` : undefined}>
        <div className="max-h-80 overflow-y-auto">
          {items === null ? <div className="p-4 text-sm text-slate-400">加载中…</div> : <BusinessEventTimeline items={items} onOpen={onOpen} />}
        </div>
      </SectionCard>
    </div>
  );
}
