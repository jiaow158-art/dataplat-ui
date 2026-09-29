import { useEffect, useState } from "react";
import { apiInsightDaily } from "../../api";
import type { InsightDaily } from "../../types";
import TodayAttentionHeader from "./TodayAttentionHeader";
import BusinessEventList from "./BusinessEventList";
import EventCenterView from "./EventCenterView";

export default function OperatingDashboardPage({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [daily, setDaily] = useState<InsightDaily | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiInsightDaily().then(setDaily).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  if (err) {
    return (
      <div className="p-8 text-sm text-slate-500">
        经营洞察暂不可用，AI 问数不受影响。
        <br />
        <span className="text-xs text-slate-400">{err}</span>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <TodayAttentionHeader daily={daily} />
      <div className="px-8">
        <BusinessEventList events={daily?.events ?? []} onOpen={onOpenEvent} />
        {daily && daily.dataFreshness.overall !== "ready" && daily.dataFreshness.radars.length > 0 && (
          <div className="mt-4 rounded-xl bg-amber-50 p-4 text-xs text-amber-700 ring-1 ring-amber-100">
            部分雷达数据未就绪：{daily.dataFreshness.radars.filter((r) => !r.ready).map((r) => r.detector).join("、")}
          </div>
        )}
      </div>
      <div className="mt-6 px-8 pb-8">
        <EventCenterView onOpen={onOpenEvent} />
      </div>
    </div>
  );
}
