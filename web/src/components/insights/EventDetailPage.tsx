// P0-T6 改版 ck 亮色体系：壳层（AppShell/PageHeader/StatusTag）+ 本页自绘卡（归因/影响对象）
// 换 SectionCard；10 个详情子组件不动（自持亮色词汇表）。取数/onFollowed/onOpenEvent 编排不变。
import { useEffect, useState } from "react";
import { apiInsightEvent } from "../../api";
import type { InsightEventDetail } from "../../types";
import AppShell from "../cockpit/AppShell";
import PageHeader from "../cockpit/PageHeader";
import SectionCard from "../cockpit/SectionCard";
import StatusTag from "../cockpit/StatusTag";
import type { Tone } from "../cockpit/StatusTag";
import EmptyState from "../cockpit/EmptyState";
import EventExecutiveSummary from "./EventExecutiveSummary";
import EventFactCards from "./EventFactCards";
import AttributionPath from "./AttributionPath";
import AttributionWaterfall from "./AttributionWaterfall";
import TrendPanel from "./TrendPanel";
import ImpactEntityTable from "./ImpactEntityTable";
import StatusFlowCard from "./StatusFlowCard";
import SuggestedActionsPanel from "./SuggestedActionsPanel";
import RelatedEventsCard from "./RelatedEventsCard";
import EventFollowupPanel from "./EventFollowupPanel";

// AI分析 chip → StatusTag tone（纯展示层映射，P0）——与 EventCenterPage 同一套约定
const ATTR_LABEL: Record<string, string> = { pending: "待分析", running: "分析中", done: "分析完成", degraded: "降级完成", failed: "分析失败" };
const ATTR_TONE: Record<string, Tone> = { pending: "neutral", running: "info", done: "success", degraded: "warning", failed: "danger" };

export default function EventDetailPage({
  eventId, onBack, onFollowed, onOpenEvent,
}: { eventId: string; onBack: () => void; onFollowed: (r: { uiSessionId: string; seedQuestion: string }) => void; onOpenEvent: (id: string) => void }) {
  const [d, setD] = useState<InsightEventDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setD(null);
    setErr(null);
    apiInsightEvent(eventId).then(setD).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [eventId]);
  if (err) return <AppShell><EmptyState text="事件加载失败" hint={err} /></AppShell>;
  if (!d) return <AppShell><EmptyState text="加载中…" /></AppShell>;
  const late = d.evidence.some((ev) => ev.is_late === 1); // 晚到徽标口径同事件中心（evidence 任一 is_late）
  return (
    <AppShell>
      <button type="button" className="self-start text-sm text-ck-primary hover:underline" onClick={onBack}>← 返回</button>
      <PageHeader title={d.event.title} subtitle={`首现 ${d.event.first_seen_date} · 数据日 ${d.event.data_date}`}>
        <StatusTag tone={d.event.severity === "major" ? "danger" : "warning"}>
          {d.event.event_type === "target_gap" ? "目标偏差" : d.event.severity === "major" ? "重大异常" : "一般异常"}
        </StatusTag>
        {d.event.persist_days > 1 && <StatusTag tone="neutral">持续第 {d.event.persist_days} 天</StatusTag>}
        <StatusTag tone={d.event.lifecycle === "active" ? "info" : "success"} dot>{d.event.lifecycle === "active" ? "进行中" : "已解除"}</StatusTag>
        <StatusTag tone={ATTR_TONE[d.attribution.status] ?? "neutral"}>{ATTR_LABEL[d.attribution.status] ?? d.attribution.status}</StatusTag>
        {late && <StatusTag tone="warning" size="sm">晚到</StatusTag>}
      </PageHeader>
      <EventExecutiveSummary summary={d.executiveSummary} attributionStatus={d.attribution.status} />
      <EventFactCards facts={d.facts} />
      <SectionCard title="自动归因分析">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div><h4 className="mb-2 text-xs text-ck-ink-3">下钻路径</h4><AttributionPath path={d.attribution.path} /></div>
          <div><h4 className="mb-2 text-xs text-ck-ink-3">贡献瀑布</h4><AttributionWaterfall waterfall={d.attribution.waterfall} /></div>
        </div>
        {d.attribution.findings.length > 0 && (
          <div className="mt-4">
            <h4 className="mb-2 text-xs text-ck-ink-3">关键发现（均附证据）</h4>
            <ul className="space-y-1 text-sm text-ck-ink-2">
              {d.attribution.findings.map((f, i) => (
                <li key={i}>· {f.text} <span className="text-xs text-ck-ink-3">（{f.evidence}）</span></li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TrendPanel eventId={eventId} />
        <SectionCard title="重点影响对象">
          <ImpactEntityTable entities={d.attribution.entities} />
        </SectionCard>
      </div>
      <StatusFlowCard d={d} />
      <SuggestedActionsPanel actions={d.suggestedActions} />
      <RelatedEventsCard eventId={eventId} onOpen={onOpenEvent} />
      <EventFollowupPanel eventId={eventId} prompts={d.followupPrompts} onFollowed={onFollowed} />
    </AppShell>
  );
}
