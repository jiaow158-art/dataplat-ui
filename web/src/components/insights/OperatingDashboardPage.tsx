import { useEffect, useState } from "react";
import { apiInsightDaily } from "../../api";
import type { InsightDaily } from "../../types";
import AppShell from "../cockpit/AppShell";
import DataFreshness from "../cockpit/DataFreshness";
import EmptyState from "../cockpit/EmptyState";
import StatusTag from "../cockpit/StatusTag";
import BusinessEventList from "./BusinessEventList";
import EventCenterView from "./EventCenterView";
import HealthPanel from "./HealthPanel";

export default function OperatingDashboardPage({
  onOpenEvent, onOpenEventCenter, onOpenTarget,
}: { onOpenEvent: (id: string) => void; onOpenEventCenter: () => void; onOpenTarget: () => void }) {
  const [daily, setDaily] = useState<InsightDaily | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    setErr(null);
    apiInsightDaily().then(setDaily).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [reloadKey]);
  const major = daily?.events.filter((e) => e.severity === "major").length ?? 0;
  const minor = daily?.events.filter((e) => e.severity === "minor").length ?? 0;
  const targetGap = daily?.events.filter((e) => e.eventType === "target_gap").length ?? 0; // 与 severity 芯片跨维度计数
  if (err) {
    return (
      <AppShell>
        <div className="text-sm text-ck-ink-2">
          经营洞察暂不可用，AI 问数不受影响。
          <br />
          <span className="text-xs text-ck-ink-3">{err}</span>
          <button
            type="button"
            className="ml-3 rounded border border-ck-line-strong px-2.5 py-1 text-xs text-ck-ink-2 transition-colors hover:border-ck-primary hover:text-ck-ink"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            重试
          </button>
        </div>
      </AppShell>
    );
  }
  const unreadyRadars = daily
    ? daily.dataFreshness.radars.filter((r) => !r.ready).map((r) => r.detector).join("、")
    : "";
  return (
    <AppShell>
      {/* P1-1 hero：页内局部 JSX（通用页头组件留给其他页）——大字 N 件事项 + 三枚计数芯片 + 右侧时效 */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em] text-ck-ink">今日经营关注</h1>
          <div className="mt-1 text-sm text-ck-ink-3">
            截至 {daily?.briefDate ?? "…"}{daily?.stale ? "（当前为最近一期已发布简报）" : ""}
          </div>
          {daily?.dataFreshness.overall === "not_ready" && (
            <div className="mt-2 text-base font-medium text-ck-warning">数据未就绪——今日简报未定稿，不代表无异常</div>
          )}
          {daily && daily.eventCount > 0 && (
            <div className="mt-2 text-lg text-ck-ink-2">
              有 <span className="text-3xl font-semibold text-ck-primary">{daily.eventCount}</span> 件经营事项值得你关注
            </div>
          ) /* 零事件态由列表区承担，hero 不重复大字；not_ready 警行与 N 行共存（review finding 1） */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <StatusTag tone="danger">重大异常 {major}</StatusTag>
            <StatusTag tone="warning">一般异常 {minor}</StatusTag>
            <StatusTag tone="info">目标偏差 {targetGap}</StatusTag>
          </div>
        </div>
        <DataFreshness asOf={daily?.dataDate} briefDate={daily?.briefDate} />
      </div>
      {daily && daily.dataFreshness.overall !== "ready" && daily.dataFreshness.radars.length > 0 && (
        <DataFreshness notice={`部分雷达数据未就绪：${unreadyRadars}`} />
      )}
      <div className="flex flex-col gap-5 xl:flex-row">
        <div className="min-w-0 flex-1">
          {daily === null ? (
            <div className="py-10 text-center text-sm text-ck-ink-3">经营简报加载中…</div>
          ) : daily.events.length === 0 ? (
            daily.dataFreshness.overall !== "ready" ? (
              <EmptyState text="部分经营数据尚未就绪" hint={unreadyRadars} />
            ) : (
              <EmptyState
                text="今日暂无重大经营事项需要特别关注"
                hint={daily.dataFreshness.radars.length > 0 && daily.dataFreshness.radars.every((r) => r.ready) ? "四雷达检测均已完成" : undefined}
              />
            )
          ) : (
            <BusinessEventList events={daily.events} onOpen={onOpenEvent} />
          )}
        </div>
        {/* B1：透传 onOpenTarget（经营概览·目标进度 → 目标管理） */}
        <div className="xl:w-80 xl:shrink-0"><HealthPanel onOpenTarget={onOpenTarget} /></div>
      </div>
      <EventCenterView onOpen={onOpenEvent} onOpenEventCenter={onOpenEventCenter} />
    </AppShell>
  );
}
