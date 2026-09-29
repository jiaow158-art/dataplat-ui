import { useEffect, useState } from "react";
import { apiInsightEvent } from "../../api";
import type { InsightEventDetail } from "../../types";
import { severityStyle } from "./BusinessEventCard";
import EventExecutiveSummary from "./EventExecutiveSummary";
import EventFactCards from "./EventFactCards";
import AttributionPath from "./AttributionPath";
import AttributionWaterfall from "./AttributionWaterfall";
import TrendPanel from "./TrendPanel";
import ImpactEntityTable from "./ImpactEntityTable";
import SuggestedActionsPanel from "./SuggestedActionsPanel";
import EventFollowupPanel from "./EventFollowupPanel";

export default function EventDetailPage({
  eventId, onBack, onFollowed,
}: { eventId: string; onBack: () => void; onFollowed: (r: { uiSessionId: string; seedQuestion: string }) => void }) {
  const [d, setD] = useState<InsightEventDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    setErr(null);
    apiInsightEvent(eventId).then(setD).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [eventId]);
  if (err) return <div className="p-8 text-sm text-slate-500">事件加载失败：{err}</div>;
  if (!d) return <div className="p-8 text-sm text-slate-400">加载中…</div>;
  const st = severityStyle(d.event);
  return (
    <div className="h-full overflow-y-auto bg-slate-50 p-8">
      <button className="text-sm text-blue-600 hover:underline" onClick={onBack}>← 返回今日经营关注</button>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs ${st.chip}`}>
          {d.event.event_type === "target_gap" ? "目标偏差" : d.event.severity === "major" ? "重大异常" : "一般异常"}
        </span>
        {d.event.persist_days > 1 && (
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-500">持续第 {d.event.persist_days} 天</span>
        )}
        <span className="text-xs text-slate-400">
          首现 {d.event.first_seen_date}｜数据日 {d.event.data_date}｜状态 {d.event.status === "analyzed" ? "分析完成" : "已发现"}
        </span>
      </div>
      <h2 className="mt-2 text-lg font-semibold text-slate-900">{d.event.title}</h2>
      <div className="mt-6 space-y-6">
        <EventExecutiveSummary summary={d.executiveSummary} attributionStatus={d.attribution.status} />
        <EventFactCards facts={d.facts} />
        <div className="rounded-xl bg-white p-6 ring-1 ring-slate-100">
          <h3 className="text-sm font-semibold text-slate-900">自动归因分析</h3>
          <div className="mt-4 grid grid-cols-1 gap-8 lg:grid-cols-2">
            <div><h4 className="mb-2 text-xs text-slate-400">下钻路径</h4><AttributionPath path={d.attribution.path} /></div>
            <div><h4 className="mb-2 text-xs text-slate-400">贡献瀑布</h4><AttributionWaterfall waterfall={d.attribution.waterfall} /></div>
          </div>
          {d.attribution.findings.length > 0 && (
            <div className="mt-4">
              <h4 className="mb-2 text-xs text-slate-400">关键发现（均附证据）</h4>
              <ul className="space-y-1 text-sm text-slate-700">
                {d.attribution.findings.map((f, i) => (
                  <li key={i}>· {f.text} <span className="text-xs text-slate-400">（{f.evidence}）</span></li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <TrendPanel />
          <div className="rounded-xl bg-white p-6 ring-1 ring-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">重点影响对象</h3>
            <div className="mt-3"><ImpactEntityTable entities={d.attribution.entities} /></div>
          </div>
        </div>
        <SuggestedActionsPanel actions={d.suggestedActions} />
        <EventFollowupPanel eventId={eventId} prompts={d.followupPrompts} onFollowed={onFollowed} />
      </div>
    </div>
  );
}
