// ED-1 事件详情「经营事件诊断书」（2026-10-08 裁定版）：
// L1 标题/状态+继续AI分析 → L2 AI分析摘要（或检测事实，pending 不冒充已归因）→
// L3 关键经营事实（per-type 显式映射）→ L4 主要影响因素（findings 原文零改写）→
// L5 贡献结构（0 中心分组，可加总性校验，跨维度不相加）→ L6 相关影响对象（原始顺序非 Top5）→
// L7 当前状态（生命周期与旧归因时效分离）→ 趋势/相关事件（证据层，保留）→
// L8 完整分析路径（默认折叠）→ L9 追问（结构化派生）。
// props 签名不变（onBack/onFollowed/onOpenEvent）——P2 overlay 三路关闭与来源页保态零触碰。
import { useEffect, useState } from "react";
import { ApiError, apiInsightEvent, apiInsightFollowup } from "../../api";
import type { InsightEventDetail } from "../../types";
import AppShell from "../cockpit/AppShell";
import PageHeader from "../cockpit/PageHeader";
import SectionCard from "../cockpit/SectionCard";
import StatusTag from "../cockpit/StatusTag";
import type { Tone } from "../cockpit/StatusTag";
import EmptyState from "../cockpit/EmptyState";
import ConclusionCard from "./ConclusionCard";
import KpiStrip from "./KpiStrip";
import FindingsCard from "./FindingsCard";
import ContributionChart from "./ContributionChart";
import AttributionPath from "./AttributionPath";
import TrendPanel from "./TrendPanel";
import ImpactEntityTable from "./ImpactEntityTable";
import CurrentStatusCard from "./CurrentStatusCard";
import RelatedEventsCard from "./RelatedEventsCard";
import EventFollowupPanel, { deriveFollowupPrompts } from "./EventFollowupPanel";

// AI分析 chip → StatusTag tone（纯展示层映射，P0）——与 EventCenterPage 同一套约定
const ATTR_LABEL: Record<string, string> = { pending: "待分析", running: "分析中", done: "分析完成", degraded: "降级完成", failed: "分析失败" };
const ATTR_TONE: Record<string, Tone> = { pending: "neutral", running: "info", done: "success", degraded: "warning", failed: "danger" };

export default function EventDetailPage({
  eventId, onBack, onFollowed, onOpenEvent,
}: { eventId: string; onBack: () => void; onFollowed: (r: { uiSessionId: string; seedQuestion: string }) => void; onOpenEvent: (id: string) => void }) {
  const [d, setD] = useState<InsightEventDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 追问编排（页头「继续AI分析」与页尾追问面板共用——D-e7 既有链路）
  const [followBusy, setFollowBusy] = useState(false);
  const [followErr, setFollowErr] = useState<string | null>(null);
  const follow = async (prompt?: string) => {
    if (followBusy) return;
    setFollowBusy(true);
    setFollowErr(null);
    try {
      onFollowed(await apiInsightFollowup(eventId, prompt));
    } catch (e) {
      setFollowErr(e instanceof ApiError ? e.message : "追问创建失败");
    } finally {
      setFollowBusy(false);
    }
  };
  const [pathOpen, setPathOpen] = useState(false);
  useEffect(() => {
    setD(null);
    setErr(null);
    apiInsightEvent(eventId).then(setD).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, [eventId]);
  if (err) return <AppShell><EmptyState text="事件加载失败" hint={err} /></AppShell>;
  if (!d) return <AppShell><EmptyState text="加载中…" /></AppShell>;
  const late = d.evidence.some((ev) => ev.is_late === 1); // 晚到徽标口径同事件中心（evidence 任一 is_late）
  const prompts = [...new Set([...deriveFollowupPrompts(d.attribution.entities), ...d.followupPrompts])]; // 去重防同名 key
  return (
    <AppShell>
      <button type="button" className="self-start text-sm text-ck-primary hover:underline" onClick={onBack}>← 返回</button>
      <PageHeader
        title={d.event.title}
        subtitle={`首现 ${d.event.first_seen_date} · 数据日 ${d.event.data_date}`}
        meta={
          <div className="flex flex-col items-end gap-1">
            <button
              type="button"
              disabled={followBusy}
              onClick={() => void follow()}
              className="rounded-lg bg-ck-primary px-3.5 py-1.5 text-sm font-medium text-white transition-colors hover:bg-ck-primary-hover disabled:opacity-50"
            >
              {followBusy ? "创建中…" : "继续 AI 分析"}
            </button>
            {followErr && <span className="text-xs text-ck-danger">{followErr}</span>}
          </div>
        }
      >
        <StatusTag tone={d.event.severity === "major" ? "danger" : "warning"}>
          {d.event.event_type === "target_gap" ? "目标偏差" : d.event.severity === "major" ? "重大异常" : "一般异常"}
        </StatusTag>
        {d.event.persist_days > 1 && <StatusTag tone="neutral">持续第 {d.event.persist_days} 天</StatusTag>}
        <StatusTag tone={d.event.lifecycle === "active" ? "info" : "success"} dot>{d.event.lifecycle === "active" ? "进行中" : "已解除"}</StatusTag>
        <StatusTag tone={ATTR_TONE[d.attribution.status] ?? "neutral"}>{ATTR_LABEL[d.attribution.status] ?? d.attribution.status}</StatusTag>
        {late && <StatusTag tone="warning" size="sm">晚到</StatusTag>}
      </PageHeader>

      {/* L2 结论区（AI 摘要或检测事实——pending 诚实降级） */}
      <ConclusionCard summary={d.executiveSummary} attributionStatus={d.attribution.status} />

      {/* L3 关键经营事实：随真实数据量 1~4 张动态排布 */}
      <KpiStrip d={d} />

      {/* L4+L5 主要影响因素 / 贡献结构：各自整卡纵排（内容量自适应，不强制 50/50） */}
      {d.attribution.findings.length > 0 && <FindingsCard findings={d.attribution.findings} />}
      {d.attribution.status === "done" || d.attribution.status === "degraded" ? (
        <SectionCard title="贡献结构（较上期变化）">
          <ContributionChart d={d} />
        </SectionCard>
      ) : null}

      {/* L6+L7 相关影响对象 / 当前状态 */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <SectionCard title="相关影响对象">
          <ImpactEntityTable entities={d.attribution.entities} />
        </SectionCard>
        <CurrentStatusCard d={d} />
      </div>

      {/* 证据层：趋势 / 相关事件（保留） */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <TrendPanel eventId={eventId} />
        <RelatedEventsCard eventId={eventId} onOpen={onOpenEvent} />
      </div>

      {/* L8 完整分析路径：默认折叠（业务结论在第一层，技术路径在第二层） */}
      <SectionCard
        title="完整分析路径"
        extra={
          <button
            type="button"
            className="text-xs text-ck-primary hover:underline"
            onClick={() => setPathOpen((v) => !v)}
          >
            {pathOpen ? "收起" : "展开 L0-L4 下钻路径与归因原文"}
          </button>
        }
      >
        {!pathOpen ? (
          <p className="text-sm text-ck-ink-3">已折叠——上方为业务化呈现；展开可查看见完整 L0-L4 下钻路径、贡献明细与归因原文。</p>
        ) : (
          <div className="flex flex-col gap-5">
            <div>
              <h4 className="mb-2 text-xs text-ck-ink-3">下钻路径</h4>
              <AttributionPath path={d.attribution.path} />
            </div>
            {d.attribution.summary && (
              <div>
                <h4 className="mb-2 text-xs text-ck-ink-3">归因摘要原文</h4>
                <p className="text-sm leading-6 text-ck-ink-2">{d.attribution.summary}</p>
              </div>
            )}
            {d.attribution.runId && (
              <p className="break-all text-[11px] text-ck-ink-3">归因任务：{d.attribution.runId}{d.attribution.reportPath ? ` · 报告：${d.attribution.reportPath}` : ""}</p>
            )}
          </div>
        )}
      </SectionCard>

      {/* L9 追问 */}
      <EventFollowupPanel prompts={prompts} busy={followBusy} err={followErr} onAsk={(p) => void follow(p)} />
    </AppShell>
  );
}
