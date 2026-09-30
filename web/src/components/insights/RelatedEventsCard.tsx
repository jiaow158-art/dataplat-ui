import { useEffect, useState } from "react";
import { apiInsightRelated } from "../../api";
import type { InsightRelated } from "../../types";

export default function RelatedEventsCard({
  eventId, onOpen,
}: { eventId: string; onOpen: (id: string) => void }) {
  const [rel, setRel] = useState<InsightRelated | null>(null);
  const [tab, setTab] = useState<"sameType" | "sameRegion">("sameType");
  useEffect(() => {
    let alive = true;
    apiInsightRelated(eventId).then((r) => alive && setRel(r)).catch(() => alive && setRel(null));
    return () => { alive = false; };
  }, [eventId]);
  const items = rel?.[tab] ?? [];
  return (
    <div className="rounded-xl bg-white p-6 ring-1 ring-slate-100">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">相关经营事件</h3>
        <div className="flex gap-2 text-xs">
          <button type="button" className={tab === "sameType" ? "text-blue-600" : "text-slate-400"}
                  onClick={() => setTab("sameType")}>同类</button>
          <button type="button" className={tab === "sameRegion" ? "text-blue-600" : "text-slate-400"}
                  onClick={() => setTab("sameRegion")}>同区域</button>
        </div>
      </div>
      <div className="mt-3 flex flex-col gap-2">
        {items.length === 0 && <div className="text-xs text-slate-400">暂无相关事件</div>}
        {items.map((e) => (
          <button key={e.event_id} type="button" className="flex items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                  onClick={() => onOpen(e.event_id)}>
            <span className="truncate text-xs text-slate-700">{e.title}</span>
            <span className="ml-2 shrink-0 text-[11px] text-slate-400">{e.data_date}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
