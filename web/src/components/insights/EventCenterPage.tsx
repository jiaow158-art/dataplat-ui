// M-i6 经营事件中心（spec 2026-09-30）：统计口径全由 /events?state=all 服务端返回（D-e5），
// 前端只做筛选（客户端，v1 量级几十行）与展示。三概念分立（D-e2）：lifecycle/attribution_status
// 同格两层竖排各自独立；late 仅标题 Badge。
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiInsightEventCenter, apiInsightFollowup } from "../../api";
import type { EventCenterEvent, EventCenterPayload } from "../../types";
import AppShell from "../cockpit/AppShell";
import PageHeader from "../cockpit/PageHeader";
import SectionCard from "../cockpit/SectionCard";
import KpiCard from "../cockpit/KpiCard";
import StatusTag from "../cockpit/StatusTag";
import type { Tone } from "../cockpit/StatusTag";
import FilterBar, { filterControlClass } from "../cockpit/FilterBar";
import EmptyState from "../cockpit/EmptyState";
import PrimaryButton from "../cockpit/PrimaryButton";
import { EventDonutCard } from "./EventCenterCharts";

const TYPE_LABEL: Record<string, string> = { sales_decline: "销售下滑", margin_drop: "毛利下降", ar_overdue: "应收风险", target_gap: "目标缺口" };
const SEV_LABEL: Record<string, string> = { major: "重大异常", minor: "一般异常" };
const LIFE_LABEL: Record<string, string> = { active: "进行中", resolved: "已解除" };
const ATTR_LABEL: Record<string, string> = { pending: "待分析", running: "分析中", done: "分析完成", degraded: "降级完成", failed: "分析失败" };
// AI分析 chip → StatusTag tone（纯展示层映射，P0）
const ATTR_TONE: Record<string, Tone> = { pending: "neutral", running: "info", done: "success", degraded: "warning", failed: "danger" };

function DeltaTag({ d, positiveIsGood }: { d: number | null; positiveIsGood: boolean }) {
  if (d === null) return <span className="text-[10px] text-ck-ink-3">—</span>;
  const good = positiveIsGood ? d >= 0 : d <= 0;
  return (
    <span className={`text-[10px] ${good ? "text-ck-success" : "text-ck-danger"}`}>
      {d > 0 ? "↑" : d < 0 ? "↓" : ""}{Math.abs(d)}% 较上期
    </span>
  );
}

export default function EventCenterPage({
  onOpenEvent, onFollowed,
}: { onOpenEvent: (id: string) => void; onFollowed: (r: { uiSessionId: string; seedQuestion: string }) => void }) {
  const [data, setData] = useState<EventCenterPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // 筛选态（全客户端）：值存原始 key（major/active/pending…），"全部"=不过滤
  const [q, setQ] = useState("");
  const [sev, setSev] = useState("全部");
  const [etype, setEtype] = useState("全部");
  const [life, setLife] = useState("全部");
  const [attr, setAttr] = useState("全部");
  const [org, setOrg] = useState("全部");
  const [lateOnly, setLateOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  useEffect(() => {
    apiInsightEventCenter().then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  const orgs = useMemo(() => ["全部", ...new Set((data?.events ?? []).map((e) => e.org).filter((x): x is string => !!x))], [data]);
  const filtered = useMemo(() => (data?.events ?? []).filter((e) => {
    if (sev !== "全部" && e.severity !== sev) return false;
    if (etype !== "全部" && e.event_type !== etype) return false;
    if (life !== "全部" && e.lifecycle !== life) return false;
    if (attr !== "全部" && e.attribution_status !== attr) return false;
    if (org !== "全部" && e.org !== org) return false;
    if (lateOnly && !e.late) return false;
    if (from && e.first_seen_date < from) return false;
    if (to && e.first_seen_date > to) return false;
    if (q.trim()) {
      const hay = `${e.title} ${e.org ?? ""} ${e.channel ?? ""} ${TYPE_LABEL[e.event_type] ?? ""}`;
      if (!hay.includes(q.trim())) return false;
    }
    return true;
  }), [data, q, sev, etype, life, attr, org, lateOnly, from, to]);

  // 下拉筛选：值=原始 key、展示=查 label map（区域例外——选项本身就是展示文案）
  const selects: Array<{ label: string; val: string; set: (v: string) => void; opts: string[]; labels: Record<string, string> }> = [
    { label: "严重程度", val: sev, set: setSev, opts: ["全部", "major", "minor"], labels: SEV_LABEL },
    { label: "事件类型", val: etype, set: setEtype, opts: ["全部", ...Object.keys(TYPE_LABEL)], labels: TYPE_LABEL },
    { label: "事件状态", val: life, set: setLife, opts: ["全部", "active", "resolved"], labels: LIFE_LABEL },
    { label: "AI分析状态", val: attr, set: setAttr, opts: ["全部", ...Object.keys(ATTR_LABEL)], labels: ATTR_LABEL },
  ];

  const follow = async (id: string) => {
    if (followBusy) return; // 同一时刻只允许一个在途
    setFollowBusy(id);
    try { onFollowed(await apiInsightFollowup(id)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : "追问创建失败"); }
    finally { setFollowBusy(null); }
  };

  if (err && !data) {
    return (
      <AppShell>
        <div className="text-sm text-ck-ink-2">
          经营事件中心暂不可用。
          <br />
          <span className="text-xs text-ck-ink-3">{err}</span>
        </div>
      </AppShell>
    );
  }
  const cards = data ? [
    { label: "全部事件", card: data.summary.total, good: false },
    { label: "重大异常", card: data.summary.major, good: false },
    { label: "一般异常", card: data.summary.minor, good: false },
    { label: "目标偏差", card: data.summary.targetGap, good: false },
    { label: "已解除", card: data.summary.resolved, good: true },
  ] : [];
  return (
    <AppShell>
      <PageHeader title="经营事件中心" subtitle={`查看全部经营事件、状态与进展${data ? ` · 数据日 ${data.asOf}` : ""}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {cards.map(({ label, card, good }) => (
          <KpiCard key={label} label={label} value={card.count} sub={<DeltaTag d={card.delta} positiveIsGood={good} />} />
        ))}
        {!data && <div className="col-span-2 py-6 text-center text-sm text-ck-ink-3 md:col-span-5">加载中…</div>}
      </div>
      <FilterBar count={`${filtered.length} 条`}>
        <input className={`min-w-48 flex-1 ${filterControlClass}`} placeholder="搜索标题 / 组织 / 渠道 / 事件类型" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="date" className={filterControlClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-ck-ink-3">~</span>
        <input type="date" className={filterControlClass} value={to} onChange={(e) => setTo(e.target.value)} />
        {selects.map(({ label, val, set, opts, labels }) => (
          <label key={label} className="flex items-center gap-1 text-ck-ink-3">
            {label}
            <select className={filterControlClass} value={val} onChange={(e) => set(e.target.value)}>
              {opts.map((o) => <option key={o} value={o}>{o === "全部" ? "全部" : (labels[o] ?? o)}</option>)}
            </select>
          </label>
        ))}
        <label className="flex items-center gap-1 text-ck-ink-3">
          区域
          <select className={filterControlClass} value={org} onChange={(e) => setOrg(e.target.value)}>
            {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-ck-ink-3">
          <input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} /> 晚到
        </label>
      </FilterBar>
      {/* P6 七列表（1366 无横滚）：1366−256 侧栏−2×32(lg:px-8)≈1046、再扣滚动条≈1030 内容宽；
          事件 30%≈310px 两行 line-clamp 足够；操作 10%≈103px 竖排 h-7 按钮+文字链足够 */}
      <div className="flex flex-col gap-5 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <SectionCard padding="none">
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col style={{ width: "30%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "10%" }} />
              </colgroup>
              <thead>
                <tr className="border-b border-ck-line text-left text-ck-ink-3">
                  {["事件", "严重程度", "关键事实", "影响范围", "持续时间", "当前状态", "操作"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={7}><EmptyState text={!data ? "…" : data.events.length === 0 ? "暂无经营事件" : "暂无匹配事件"} /></td></tr>}
                {filtered.map((e) => (
                  <tr key={e.event_id} className="border-b border-ck-line/60 last:border-0 hover:bg-ck-card-soft">
                    {/* 事件两行：标题（两行截断，保可读性）+晚到 badge；次行 类型·首次发现 MM-DD */}
                    <td className="px-3 py-2.5 align-top">
                      <button type="button" className="flex items-start gap-1 text-left font-semibold text-ck-ink transition-colors hover:text-ck-primary" onClick={() => onOpenEvent(e.event_id)}>
                        <span className="line-clamp-2" title={e.title}>{e.title}</span>
                        {e.late && <span className="shrink-0"><StatusTag tone="warning" size="sm">晚到</StatusTag></span>}
                      </button>
                      <div className="mt-0.5 text-xs text-ck-ink-3">{TYPE_LABEL[e.event_type] ?? e.event_type} · 首次发现 {e.first_seen_date.slice(5)}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top">
                      <StatusTag tone={e.severity === "major" ? "danger" : "warning"} size="sm">{e.severity === "major" ? "重大异常" : "一般异常"}</StatusTag>
                    </td>
                    <td className="px-3 py-2.5 align-top text-ck-ink-3">
                      {e.facts[0] ? (
                        <div className="line-clamp-2" title={`${e.facts[0].label} ${e.facts[0].value}`}>
                          {e.facts[0].label} <span className="font-medium text-ck-ink">{e.facts[0].value}</span>
                        </div>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="truncate text-ck-ink-2" title={e.org ?? undefined}>{e.org ?? "—"}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 align-top text-ck-ink-3">{e.persist_days} 天</td>
                    {/* 当前状态两层：生命周期 + AI分析，各自独立（D-e2） */}
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <StatusTag tone={e.lifecycle === "active" ? "info" : "success"} dot size="sm">{e.lifecycle === "active" ? "进行中" : "已解除"}</StatusTag>
                        <StatusTag tone={ATTR_TONE[e.attribution_status] ?? "neutral"} size="sm">{ATTR_LABEL[e.attribution_status] ?? e.attribution_status}</StatusTag>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <PrimaryButton size="sm" onClick={() => onOpenEvent(e.event_id)}>查看详情</PrimaryButton>
                        <button type="button" className="text-left text-ck-primary hover:underline disabled:pointer-events-none disabled:text-ck-ink-3" disabled={followBusy === e.event_id} onClick={() => void follow(e.event_id)}>
                          {followBusy === e.event_id ? "分析中…" : "继续分析"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </SectionCard>
          {data?.truncated && <div className="text-[11px] text-ck-warning">事件超过 500 条已截断显示——请联系管理员调整</div>}
          <SectionCard title="近期事件动态">
            <div className="max-h-72 overflow-y-auto">
              {data ? <ActivityTimeline events={data.events} onOpenEvent={onOpenEvent} /> : <div className="p-4 text-sm text-ck-ink-3">加载中…</div>}
            </div>
          </SectionCard>
        </div>
        <div className="flex w-full flex-col gap-5 xl:w-80 xl:shrink-0">
          {data && <TrendSummaryCard data={data} />}
          {data && <EventDonutCard title="事件类型分布" items={data.eventTypeDistribution} total={data.events.length} />}
          {data && <EventDonutCard title="事件生命周期分布" items={data.lifecycleDistribution} total={data.events.length} palette={["#2563eb", "#10b981"]} />}
        </div>
      </div>
      {err && data && <div className="text-xs text-ck-danger">{err}</div>}
    </AppShell>
  );
}

/** U4 低样本不画折线：右栏首卡改「近 30 天摘要」KpiCard（口径全在服务端，这里只取值展示）。 */
function TrendSummaryCard({ data }: { data: EventCenterPayload }) {
  // 集中日=近 30 天新发 total 最大的点（并列取最新日期）；全零 → 无集中日
  const peak = data.trend.points.reduce<{ date: string; total: number } | null>((best, p) => {
    if (p.total <= 0) return best;
    if (!best || p.total > best.total || (p.total === best.total && p.date > best.date)) return { date: p.date, total: p.total };
    return best;
  }, null);
  const d = data.summary.total.delta;
  return (
    <KpiCard
      label="近 30 天摘要"
      value={`新增 ${data.summary.total.count} 条`}
      sub={
        <>
          集中日 {peak ? peak.date : "无集中日"} ·{" "}
          <span className={d == null ? "" : d > 0 ? "text-ck-danger" : d < 0 ? "text-ck-success" : ""}>
            较上期 {d == null ? "—" : `${d > 0 ? "+" : ""}${d}%`}
          </span>
        </>
      }
    />
  );
}

// U5 动态色点：发现=蓝 / 归因完成·解除=绿 / 降级=橙 / 失败=红
const ACT_DOT: Record<string, string> = { found: "bg-ck-primary", attr_done: "bg-ck-success", attr_degraded: "bg-ck-warning", attr_failed: "bg-ck-danger", resolved: "bg-ck-success" };
const ACT_TXT: Record<string, string> = { found: "text-ck-primary", attr_done: "text-ck-success", attr_degraded: "text-ck-warning", attr_failed: "text-ck-danger", resolved: "text-ck-success" };
const ATTR_ACT: Record<string, { kind: string; label: string }> = {
  done: { kind: "attr_done", label: "归因完成" },
  degraded: { kind: "attr_degraded", label: "归因降级" },
  failed: { kind: "attr_failed", label: "归因失败" },
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const fmtActClock = (sec: number) => {
  const d = new Date(sec * 1000); // insight-api 时间戳为 epoch 秒（同 StatusFlowCard generatedAt*1000）
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

/** U5 真·事件动态：只收录带时间戳的事实——发现(created_at) / 归因(attribution_generated_at，
 * 仅 done/degraded/failed) / 解除(resolved_at 日期串)；"持续第 N 天"不进时间线（表格列已有）。
 * 按时间倒序取 12 条；服务端未部署新字段时条目自然缺失，不炸。 */
function ActivityTimeline({ events, onOpenEvent }: { events: EventCenterEvent[]; onOpenEvent: (id: string) => void }) {
  const items = useMemo(() => {
    const out: Array<{ t: number; kind: string; label: string; title: string; eventId: string; timeText: string }> = [];
    for (const e of events) {
      if (e.created_at)
        out.push({ t: e.created_at, kind: "found", label: "首次发现", title: e.title, eventId: e.event_id, timeText: fmtActClock(e.created_at) });
      const act = e.attribution_generated_at ? ATTR_ACT[e.attribution_status] : undefined;
      if (e.attribution_generated_at && act)
        out.push({ t: e.attribution_generated_at, kind: act.kind, label: act.label, title: e.title, eventId: e.event_id, timeText: fmtActClock(e.attribution_generated_at) });
      if (e.resolved_at)
        out.push({ t: Date.parse(e.resolved_at) / 1000, kind: "resolved", label: "已解除", title: e.title, eventId: e.event_id, timeText: e.resolved_at.slice(5, 10) });
    }
    return out.sort((a, b) => b.t - a.t).slice(0, 12);
  }, [events]);
  if (!items.length) return <div className="py-6 text-center text-sm text-ck-ink-3">暂无动态</div>;
  return (
    <div className="relative">
      {/* 中轴竖线：时间列 w-[4.5rem]+gap-3 后即轴心（88px=5.5rem） */}
      <div className="absolute bottom-2 left-[5.5rem] top-2 w-px bg-ck-line" />
      <ul className="relative">
        {items.map((it, i) => (
          <li key={`${it.eventId}-${it.kind}-${i}`} className="flex items-center gap-3 py-1.5">
            <span className="w-[4.5rem] shrink-0 text-right font-mono text-[11px] text-ck-ink-3">{it.timeText}</span>
            <span className="relative z-10 flex h-2 w-2 shrink-0 items-center justify-center rounded-full bg-ck-card ring-1 ring-ck-line-strong">
              <span className="h-1 w-1 rounded-full bg-ck-line-strong" />
            </span>
            <span className="flex min-w-0 items-center gap-1.5">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${ACT_DOT[it.kind] ?? "bg-ck-line-strong"}`} />
              <span className={`shrink-0 text-[11px] font-medium ${ACT_TXT[it.kind] ?? "text-ck-ink-3"}`}>{it.label}</span>
              <button
                type="button"
                className="min-w-0 truncate text-left text-xs text-ck-ink-2 transition-colors hover:text-ck-primary"
                title={it.title}
                onClick={() => onOpenEvent(it.eventId)}
              >
                {it.title}
              </button>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
