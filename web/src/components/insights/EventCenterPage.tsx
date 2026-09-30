// M-i6 经营事件中心（spec 2026-09-30）：统计口径全由 /events?state=all 服务端返回（D-e5），
// 前端只做筛选（客户端，v1 量级几十行）与展示。三概念分立（D-e2）：lifecycle/attribution_status
// 两列各自独立；late 仅标题 Badge。
import { useEffect, useMemo, useState } from "react";
import { ApiError, apiInsightEventCenter, apiInsightFollowup, apiInsightTimeline } from "../../api";
import type { EventCenterPayload, InsightTimelineItem } from "../../types";
import BusinessEventTimeline from "./BusinessEventTimeline";
import { EventTrendCard, EventDonutCard } from "./EventCenterCharts";
import { severityStyle } from "./BusinessEventCard";

const TYPE_LABEL: Record<string, string> = { sales_decline: "销售下滑", margin_drop: "毛利下降", ar_overdue: "应收风险", target_gap: "目标缺口" };
const SEV_LABEL: Record<string, string> = { major: "重大异常", minor: "一般异常" };
const LIFE_LABEL: Record<string, string> = { active: "进行中", resolved: "已解除" };
const ATTR_LABEL: Record<string, string> = { pending: "待分析", running: "分析中", done: "分析完成", degraded: "降级完成", failed: "分析失败" };
const ATTR_STYLE: Record<string, string> = { pending: "bg-slate-100 text-slate-500", running: "bg-blue-50 text-blue-600", done: "bg-emerald-50 text-emerald-600", degraded: "bg-amber-50 text-amber-600", failed: "bg-red-50 text-red-500" };

function DeltaTag({ d, positiveIsGood }: { d: number | null; positiveIsGood: boolean }) {
  if (d === null) return <span className="text-[11px] text-slate-300">—</span>;
  const good = positiveIsGood ? d >= 0 : d <= 0;
  return (
    <span className={`text-[11px] ${good ? "text-emerald-600" : "text-red-500"}`}>
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

  if (err && !data) return <div className="p-8 text-sm text-slate-500">经营事件中心暂不可用。<br /><span className="text-xs text-slate-400">{err}</span></div>;
  const cards = data ? [
    { label: "全部事件", card: data.summary.total, good: false },
    { label: "重大异常", card: data.summary.major, good: false },
    { label: "一般异常", card: data.summary.minor, good: false },
    { label: "目标偏差", card: data.summary.targetGap, good: false },
    { label: "已解除", card: data.summary.resolved, good: true },
  ] : [];
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="px-8 pt-8 pb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-900">经营事件中心</h1>
          <p className="mt-1 text-sm text-slate-500">查看全部经营事件、状态与进展{data ? ` · 数据日 ${data.asOf}` : ""}</p>
        </div>
      </div>
      <div className="px-8 grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map(({ label, card, good }) => (
          <div key={label} className="rounded-xl bg-white p-4 ring-1 ring-slate-100">
            <div className="text-xs text-slate-400">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-900">{card.count}</div>
            <div className="mt-1"><DeltaTag d={card.delta} positiveIsGood={good} /></div>
          </div>
        ))}
        {!data && <div className="col-span-5 py-6 text-center text-sm text-slate-400">加载中…</div>}
      </div>
      <div className="mx-8 mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-white p-3 ring-1 ring-slate-100 text-xs">
        <input className="min-w-48 flex-1 rounded border border-slate-200 px-2 py-1.5" placeholder="搜索标题 / 组织 / 渠道 / 事件类型" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="date" className="rounded border border-slate-200 px-2 py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-slate-300">~</span>
        <input type="date" className="rounded border border-slate-200 px-2 py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
        {selects.map(({ label, val, set, opts, labels }) => (
          <label key={label} className="flex items-center gap-1 text-slate-400">
            {label}
            <select className="rounded border border-slate-200 px-1.5 py-1.5 text-slate-600" value={val} onChange={(e) => set(e.target.value)}>
              {opts.map((o) => <option key={o} value={o}>{o === "全部" ? "全部" : (labels[o] ?? o)}</option>)}
            </select>
          </label>
        ))}
        <label className="flex items-center gap-1 text-slate-400">
          区域
          <select className="rounded border border-slate-200 px-1.5 py-1.5 text-slate-600" value={org} onChange={(e) => setOrg(e.target.value)}>
            {orgs.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1 text-slate-400">
          <input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} /> 晚到
        </label>
        <span className="ml-auto text-slate-400">{filtered.length} 条</span>
      </div>
      <div className="mx-8 mt-4 flex flex-col gap-4 xl:flex-row">
        <div className="min-w-0 flex-1">
          <div className="overflow-x-auto rounded-xl bg-white ring-1 ring-slate-100">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  {["#", "事件标题", "严重度", "事件类型", "影响范围", "关键事实", "首次发现", "持续天数", "事件状态", "AI分析状态", "操作"].map((h) => <th key={h} className="px-3 py-2.5 font-normal whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && <tr><td colSpan={11} className="px-3 py-10 text-center text-slate-300">{!data ? "…" : data.events.length === 0 ? "暂无经营事件" : "暂无匹配事件"}</td></tr>}
                {filtered.map((e, i) => (
                  <tr key={e.event_id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                    <td className="px-3 py-2.5 text-slate-300">{i + 1}</td>
                    <td className="max-w-56 px-3 py-2.5">
                      <button type="button" className="flex items-center gap-1 text-left font-medium text-slate-800 hover:text-blue-600" onClick={() => onOpenEvent(e.event_id)}>
                        <span className="truncate">{e.title}</span>
                        {e.late && <span className="shrink-0 rounded bg-amber-50 px-1 py-0.5 text-[10px] text-amber-600">晚到</span>}
                      </button>
                    </td>
                    <td className="px-3 py-2.5"><span className={`rounded-full px-2 py-0.5 ${severityStyle(e).chip}`}>{e.severity === "major" ? "重大异常" : "一般异常"}</span></td>
                    <td className="px-3 py-2.5 text-slate-600 whitespace-nowrap">{TYPE_LABEL[e.event_type] ?? e.event_type}</td>
                    <td className="max-w-28 truncate px-3 py-2.5 text-slate-600">{e.org ?? "—"}</td>
                    <td className="max-w-44 truncate px-3 py-2.5 text-slate-500">{e.facts[0] ? `${e.facts[0].label} ${e.facts[0].value}` : "—"}</td>
                    <td className="px-3 py-2.5 text-slate-500 whitespace-nowrap">{e.first_seen_date}</td>
                    <td className="px-3 py-2.5 text-slate-500">{e.persist_days} 天</td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><span className={e.lifecycle === "active" ? "text-blue-600" : "text-emerald-600"}>● {e.lifecycle === "active" ? "进行中" : "已解除"}</span></td>
                    <td className="px-3 py-2.5 whitespace-nowrap"><span className={`rounded-full px-2 py-0.5 ${ATTR_STYLE[e.attribution_status] ?? ATTR_STYLE.pending}`}>{ATTR_LABEL[e.attribution_status] ?? e.attribution_status}</span></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <button type="button" className="rounded bg-blue-600 px-2 py-1 text-white hover:bg-blue-700" onClick={() => onOpenEvent(e.event_id)}>详情</button>
                      <button type="button" className="ml-1 rounded border border-slate-200 px-2 py-1 text-slate-600 hover:border-blue-400 hover:text-blue-600 disabled:opacity-50" disabled={followBusy === e.event_id} onClick={() => void follow(e.event_id)}>
                        {followBusy === e.event_id ? "分析中…" : "继续分析"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data?.truncated && <div className="mt-2 text-[11px] text-amber-600">事件超过 500 条已截断显示——请联系管理员调整</div>}
          <div className="mt-4 rounded-xl bg-white p-6 ring-1 ring-slate-100">
            <h3 className="text-sm font-semibold text-slate-900">近期事件动态</h3>
            <div className="mt-2 max-h-72 overflow-y-auto"><TimelineSection onOpenEvent={onOpenEvent} /></div>
          </div>
        </div>
        <div className="flex w-full flex-col gap-4 xl:w-96 xl:shrink-0">
          {data && <EventTrendCard points={data.trend.points} />}
          {data && <EventDonutCard title="事件类型分布" items={data.eventTypeDistribution} total={data.events.length} />}
          {data && <EventDonutCard title="事件生命周期分布" items={data.lifecycleDistribution} total={data.events.length} palette={["#2563eb", "#10b981"]} />}
        </div>
      </div>
      {err && data && <div className="mx-8 mb-6 text-xs text-red-500">{err}</div>}
      <div className="pb-8" />
    </div>
  );
}

function TimelineSection({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [items, setItems] = useState<InsightTimelineItem[] | null>(null);
  useEffect(() => { apiInsightTimeline(30).then(setItems).catch(() => setItems([])); }, []);
  return items === null ? <div className="p-4 text-sm text-slate-400">加载中…</div>
    : <BusinessEventTimeline items={items} onOpen={onOpenEvent} />;
}
