import { useEffect, useState } from "react";
import { apiInsightActiveEvents, apiInsightTimeline } from "../../api";
import type { InsightActiveEvent, InsightTimelineItem } from "../../types";
import SectionCard from "../cockpit/SectionCard";
import BusinessEventTimeline from "./BusinessEventTimeline";

export default function EventCenterView({
  onOpen, onOpenEventCenter,
}: { onOpen: (id: string) => void; onOpenEventCenter: () => void }) {
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
        // P1-1 其他关注事项：不暴露排序分数机制；最多 5 条，更多去事件中心
        <SectionCard title="其他关注事项" extra={`${watching.length} 条`}>
          <div className="text-xs text-ck-ink-3">仍在持续关注，但未进入今日重点</div>
          <div className="mt-1 flex flex-col divide-y divide-ck-card-soft">
            {watching.slice(0, 5).map((e) => (
              <button key={e.event_id} type="button" className="flex items-center gap-3 py-2 text-left hover:bg-ck-card-soft"
                      onClick={() => onOpen(e.event_id)}>
                <span className={`w-1 self-stretch rounded ${e.severity === "major" ? "bg-red-500" : "bg-orange-400"}`} />
                <span className="min-w-0 flex-1 truncate text-sm text-ck-ink-2">{e.title}</span>
                <span className="shrink-0 text-xs text-ck-ink-3">持续 {e.persist_days} 天</span>
              </button>
            ))}
          </div>
          {watching.length > 5 && (
            <button type="button" className="mt-1 text-sm text-ck-primary" onClick={onOpenEventCenter}>
              查看全部 →
            </button>
          )}
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
