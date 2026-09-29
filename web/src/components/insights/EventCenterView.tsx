import { useEffect, useState } from "react";
import { apiInsightTimeline } from "../../api";
import type { InsightTimelineItem } from "../../types";
import BusinessEventTimeline from "./BusinessEventTimeline";

export default function EventCenterView({ onOpen }: { onOpen: (id: string) => void }) {
  const [items, setItems] = useState<InsightTimelineItem[] | null>(null);
  useEffect(() => {
    apiInsightTimeline(90).then(setItems).catch(() => setItems([]));
  }, []);
  return (
    <div className="rounded-xl bg-white p-6 ring-1 ring-slate-100">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">经营事件时间线（近 90 天）</h3>
        {items && <span className="text-xs text-slate-400">{items.length} 条</span>}
      </div>
      <div className="mt-2 max-h-80 overflow-y-auto">
        {items === null ? <div className="p-4 text-sm text-slate-400">加载中…</div> : <BusinessEventTimeline items={items} onOpen={onOpen} />}
      </div>
    </div>
  );
}
