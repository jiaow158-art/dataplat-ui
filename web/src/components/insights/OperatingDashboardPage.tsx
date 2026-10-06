import { useEffect, useState } from "react";
import { apiInsightActiveEvents, apiInsightDaily } from "../../api";
import type { InsightActiveEvent, InsightDaily } from "../../types";
import AppShell from "../cockpit/AppShell";
import PageHeader from "../cockpit/PageHeader";
import DataFreshness from "../cockpit/DataFreshness";
import StatusTag from "../cockpit/StatusTag";
import BusinessEventList from "./BusinessEventList";
import EventCenterView from "./EventCenterView";
import HealthPanel from "./HealthPanel";

export default function OperatingDashboardPage({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [daily, setDaily] = useState<InsightDaily | null>(null);
  const [active, setActive] = useState<InsightActiveEvent[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiInsightDaily().then(setDaily).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    apiInsightActiveEvents().then((r) => setActive(r.events)).catch(() => setActive([]));
  }, []);
  const watching = (active?.filter((e) => !e.publishedToday).length) ?? 0;
  const major = daily?.events.filter((e) => e.severity === "major").length ?? 0;
  const minor = daily?.events.filter((e) => e.severity === "minor").length ?? 0;
  if (err) {
    return (
      <AppShell>
        <div className="text-sm text-ck-ink-2">
          经营洞察暂不可用，AI 问数不受影响。
          <br />
          <span className="text-xs text-ck-ink-3">{err}</span>
        </div>
      </AppShell>
    );
  }
  return (
    <AppShell>
      <PageHeader
        title="今日经营关注"
        subtitle={
          daily
            ? daily.dataFreshness.overall === "not_ready"
              ? "数据未就绪——今日简报未定稿，不代表无异常"
              : `截至 ${daily.briefDate}，发现 ${daily.eventCount} 件值得关注的经营事项${daily.stale ? "（当前为最近一期已发布简报）" : ""}`
            : "加载中…"
        }
        meta={<DataFreshness asOf={daily?.dataDate} briefDate={daily?.briefDate} />}
      >
        <StatusTag tone="danger">重大异常 {major}</StatusTag>
        <StatusTag tone="warning">一般异常 {minor}</StatusTag>
        <StatusTag tone="info">观察中 {watching}</StatusTag>
      </PageHeader>
      {daily && daily.dataFreshness.overall !== "ready" && daily.dataFreshness.radars.length > 0 && (
        <DataFreshness
          notice={`部分雷达数据未就绪：${daily.dataFreshness.radars.filter((r) => !r.ready).map((r) => r.detector).join("、")}`}
        />
      )}
      <div className="flex flex-col gap-5 xl:flex-row">
        <div className="min-w-0 flex-1">
          <BusinessEventList events={daily?.events ?? []} onOpen={onOpenEvent} />
        </div>
        <div className="xl:w-80 xl:shrink-0"><HealthPanel /></div>
      </div>
      <EventCenterView onOpen={onOpenEvent} />
    </AppShell>
  );
}
