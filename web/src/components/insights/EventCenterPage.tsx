// M-i6 经营事件中心（spec 2026-09-30）：统计口径全由 /events?state=all 服务端返回（D-e5），
// 前端只做筛选（客户端，v1 量级几十行）与展示。三概念分立（D-e2）：lifecycle/attribution_status
// 同格两层竖排各自独立；late 仅标题 Badge。
// P1-4 问题总控台化：态势五卡 / 两层筛选（裁定3）/ 近30天经营摘要（裁定4/5）/ 字段排序（§十四）。
import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { ApiError, apiInsightEventCenter, apiInsightFollowup, apiInsightRegionMap } from "../../api";
import type { EventCenterEvent, EventCenterPayload, RegionMapDegraded, RegionMapPayload } from "../../types";
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

// ── P1-4 ──
// 裁定3 快捷状态分段：majorActive 固定语义=active∧major（与 KPI「重大异常」卡同口径）
type QuickMode = "全部" | "active" | "resolved" | "majorActive";
const QUICK_KEYS: QuickMode[] = ["全部", "active", "resolved", "majorActive"];
const QUICK_LABEL: Record<QuickMode, string> = { "全部": "全部", active: "进行中", resolved: "已解除", majorActive: "重大异常" };
// §十四 排序：recent=服务端序（first_seen_date DESC）不重排；longest=persist_days 字段序（非经营优先级）
type SortMode = "recent" | "longest";
const SORT_LABEL: Record<SortMode, string> = { recent: "最近发现", longest: "持续最久" };
/** 分段/排序 pill：样式对齐既有 tab pill（RegionBattleMapPage） */
const pillCls = (on: boolean) =>
  `rounded px-2 py-0.5 text-[11px] transition-colors ${on ? "bg-ck-primary-soft font-medium text-ck-primary" : "text-ck-ink-3 hover:text-ck-ink-2"}`;

// P2-b B2：region-map 载荷局部降级判别（{available:false}；与 RegionBattleMapPage 同款局部小拷贝）
const isDegraded = (x: unknown): x is RegionMapDegraded =>
  typeof x === "object" && x !== null && (x as RegionMapDegraded).available === false;

export default function EventCenterPage({
  onOpenEvent, onFollowed, onOpenRegion, onOpenTargetPage,
}: {
  onOpenEvent: (id: string) => void;
  onFollowed: (r: { uiSessionId: string; seedQuestion: string }) => void;
  onOpenRegion: (region: string) => void; // B2：唯一大区足迹 → 区域作战地图
  onOpenTargetPage: () => void; // B3：target_gap → 目标管理
}) {
  const [data, setData] = useState<EventCenterPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // B2：区域关联独立拉取（服务端销售足迹），失败=null → 不出区域链接（诚实降级，不挡页面）
  const [regionMap, setRegionMap] = useState<RegionMapPayload | null>(null);
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
  // 裁定3 两层筛选：L1 快捷状态分段常显；L2「更多筛选」默认收起（高级层允许自由 life×sev 组合）
  const [quick, setQuick] = useState<QuickMode>("全部");
  const [moreOpen, setMoreOpen] = useState(false);
  // §十四 表格排序 toggle（纯字段序，非经营优先级）
  const [sortMode, setSortMode] = useState<SortMode>("recent");
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  useEffect(() => {
    apiInsightEventCenter().then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    apiInsightRegionMap().then(setRegionMap).catch(() => setRegionMap(null));
  }, []);
  const orgs = useMemo(() => ["全部", ...new Set((data?.events ?? []).map((e) => e.org).filter((x): x is string => !!x))], [data]);
  const filtered = useMemo(() => {
    // 裁定3：快捷分段驱动 life/sev（不与 L2 选择双重叠加）；quick=全部 时 L2 life/sev 照常生效
    const lifeEff = quick === "active" || quick === "majorActive" ? "active" : quick === "resolved" ? "resolved" : life;
    const sevEff = quick === "majorActive" ? "major" : sev;
    return (data?.events ?? []).filter((e) => {
      if (sevEff !== "全部" && e.severity !== sevEff) return false;
      if (etype !== "全部" && e.event_type !== etype) return false;
      if (lifeEff !== "全部" && e.lifecycle !== lifeEff) return false;
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
    });
  }, [data, q, sev, etype, life, attr, org, lateOnly, from, to, quick]);
  // §十四：recent=服务端序（最近发现）不重排；longest=persist_days desc、first_seen desc tie-break
  const rows = useMemo(() => {
    if (sortMode === "recent") return filtered;
    return [...filtered].sort((a, b) => b.persist_days - a.persist_days || (b.first_seen_date ?? "").localeCompare(a.first_seen_date ?? ""));
  }, [filtered, sortMode]);

  // P2-b B2（裁定）：regionEvents 为服务端「销售足迹」关联（事件↔大区），不做标题模糊匹配；
  // 反转为 event_id → 大区列表，仅映射到唯一大区（length===1）的事件出「区域视角」链接，
  // 跨大区/无足迹事件保持普通详情；拉取失败或 regionEvents 降级 → 整表为 null，无链接
  const eventRegions = useMemo(() => {
    const re = regionMap?.regionEvents;
    if (!re || isDegraded(re)) return null;
    const m = new Map<string, string[]>();
    for (const [region, evts] of Object.entries(re)) {
      for (const ev of evts) {
        const cur = m.get(ev.event_id);
        if (cur) cur.push(region);
        else m.set(ev.event_id, [region]);
      }
    }
    return m;
  }, [regionMap]);

  // 下拉筛选（L2）：值=原始 key、展示=查 label map（区域例外——选项本身就是展示文案）。
  // 裁定3 单向同步：L2 改动 life/sev 时快捷分段回「全部」，避免双源打架
  const selects: Array<{ label: string; val: string; set: (v: string) => void; opts: string[]; labels: Record<string, string> }> = [
    { label: "严重程度", val: sev, set: (v) => { setSev(v); setQuick("全部"); }, opts: ["全部", "major", "minor"], labels: SEV_LABEL },
    { label: "事件类型", val: etype, set: setEtype, opts: ["全部", ...Object.keys(TYPE_LABEL)], labels: TYPE_LABEL },
    { label: "事件状态", val: life, set: (v) => { setLife(v); setQuick("全部"); }, opts: ["全部", "active", "resolved"], labels: LIFE_LABEL },
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
  // 态势五卡（§三）：active/resolved 取服务端 lifecycleDistribution（全量口径）；其余为客户端
  // 确定性算术——capped=data.truncated 时逐卡注明（裁定1）；近7日窗口锚定 asOf，非自然日今天（裁定2）
  const evts = data?.events ?? [];
  const capped = data?.truncated ?? false;
  const activeN = data?.lifecycleDistribution.find((d) => d.key === "active")?.count ?? 0;
  const resolvedN = data?.lifecycleDistribution.find((d) => d.key === "resolved")?.count ?? 0;
  const majorActive = evts.filter((e) => e.lifecycle === "active" && e.severity === "major").length;
  const cutoff7 = data ? new Date(Date.parse(data.asOf) - 6 * 86400e3).toISOString().slice(0, 10) : "";
  const last7 = cutoff7 ? evts.filter((e) => e.first_seen_date && e.first_seen_date >= cutoff7).length : 0;
  const dayN = data ? evts.filter((e) => e.first_seen_date === data.asOf).length : 0;
  // 持续最久＝进行中事件 persist_days 极值（极值事实，不造阈值）；存在性单独跟踪（0 天≠无进行中），
  // 比较用 >= 使当日新发（persist_days=0）也能带出标题
  const hasActive = evts.some((e) => e.lifecycle === "active");
  const longest = evts.reduce<{ days: number; title: string | null }>(
    (best, e) => (e.lifecycle === "active" && e.persist_days >= best.days ? { days: e.persist_days, title: e.title } : best),
    { days: 0, title: null },
  );
  const kpis = data ? [
    { label: "进行中", value: activeN, sub: "全量生命周期口径" },
    { label: "重大异常", value: majorActive, sub: `当前进行中${capped ? " · 基于最近500条" : ""}` },
    { label: "近7日新增", value: last7, sub: `${data.asOf.slice(5)} 当日新增 +${dayN}${capped ? " · 基于最近500条" : ""}` },
    { label: "持续最久", value: hasActive ? `${longest.days} 天` : "—", sub: <span className="line-clamp-2" title={longest.title ?? undefined}>{hasActive ? `${longest.title ?? ""}${capped ? " · 基于最近500条" : ""}` : "暂无进行中事件"}</span> },
    { label: "已解除", value: resolvedN, sub: `近30日解除 ${data.summary.resolved.count} 条` },
  ] : [];
  return (
    <AppShell>
      <PageHeader title="经营事件中心" subtitle={`查看全部经营事件、状态与进展${data ? ` · 数据日 ${data.asOf}` : ""}`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {kpis.map((k) => (
          <KpiCard key={k.label} label={k.label} value={k.value} sub={k.sub} />
        ))}
        {!data && <div className="col-span-2 py-6 text-center text-sm text-ck-ink-3 md:col-span-5">加载中…</div>}
      </div>
      {/* 裁定1：截断时统一提示——客户端统计基于已加载的最近 500 条，服务端口径照常展示 */}
      {data?.truncated && <div className="text-[11px] text-ck-warning">部分统计基于最近 500 条已加载事件</div>}
      <FilterBar count={`${filtered.length} 条`}>
        {/* L1 常显（裁定3）：搜索 / 日期 / 快捷状态分段 / 更多筛选 */}
        <input className={`min-w-48 flex-1 ${filterControlClass}`} placeholder="搜索标题 / 组织 / 渠道 / 事件类型" value={q} onChange={(e) => setQ(e.target.value)} />
        <input type="date" className={filterControlClass} value={from} onChange={(e) => setFrom(e.target.value)} />
        <span className="text-ck-ink-3">~</span>
        <input type="date" className={filterControlClass} value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="flex items-center gap-0.5">
          {QUICK_KEYS.map((k) => (
            <button key={k} type="button" className={pillCls(quick === k)} onClick={() => setQuick(k)}>{QUICK_LABEL[k]}</button>
          ))}
        </div>
        <button type="button" className={filterControlClass} onClick={() => setMoreOpen((v) => !v)}>更多筛选 {moreOpen ? "⌃" : "⌄"}</button>
        {/* L2 折叠（默认收起）：严重程度/事件类型/事件状态/AI分析状态 + 区域 + 晚到；允许自由 life×sev 组合（裁定3） */}
        {moreOpen && (
          <div className="mt-1 flex w-full flex-wrap items-center gap-2 border-t border-ck-line pt-2">
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
          </div>
        )}
      </FilterBar>
      {/* P6 七列表（1366 无横滚）：1366−256 侧栏−2×32(lg:px-8)≈1046、再扣滚动条≈1030 内容宽；
          事件 29%≈299px 两行 line-clamp 足够；操作 11%≈113px（含 px-2）容 nowrap 按钮不溢出卡缘；
          1920 下内容宽≈1576px、各列绝对更宽，无回归 */}
      <div className="flex flex-col gap-5 xl:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <SectionCard
            padding="none"
            title="事件清单"
            extra={(
              // §十四 字段排序（非经营优先级）：默认=服务端最近发现序
              <div className="flex items-center gap-1" title="字段排序（非经营优先级）">
                {(["recent", "longest"] as SortMode[]).map((m) => (
                  <button key={m} type="button" className={pillCls(sortMode === m)} onClick={() => setSortMode(m)}>{SORT_LABEL[m]}</button>
                ))}
              </div>
            )}
          >
            <table className="w-full table-fixed text-xs">
              <colgroup>
                <col style={{ width: "29%" }} />
                <col style={{ width: "9%" }} />
                <col style={{ width: "20%" }} />
                <col style={{ width: "12%" }} />
                <col style={{ width: "8%" }} />
                <col style={{ width: "11%" }} />
                <col style={{ width: "11%" }} />
              </colgroup>
              <thead>
                <tr className="border-b border-ck-line text-left text-ck-ink-3">
                  {["事件", "严重程度", "关键事实", "影响范围", "持续时间", "当前状态", "操作"].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 font-normal">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7}><EmptyState text={!data ? "…" : data.events.length === 0 ? "暂无经营事件" : "暂无匹配事件"} /></td></tr>}
                {rows.map((e) => {
                  const regions = eventRegions?.get(e.event_id);
                  const uniqRegion = regions?.length === 1 ? regions[0] : null; // 非唯一大区不出区域链接
                  return (
                  <tr key={e.event_id} className="border-b border-ck-line/60 last:border-0 hover:bg-ck-card-soft">
                    {/* 事件两行：标题（两行截断，保可读性）+晚到 badge；次行 类型·首次发现 MM-DD + 上下文桥接链接 */}
                    <td className="px-3 py-2.5 align-top">
                      <button type="button" className="flex items-start gap-1 text-left font-semibold text-ck-ink transition-colors hover:text-ck-primary" onClick={() => onOpenEvent(e.event_id)}>
                        <span className="line-clamp-2" title={e.title}>{e.title}</span>
                        {e.late && <span className="shrink-0"><StatusTag tone="warning" size="sm">晚到</StatusTag></span>}
                      </button>
                      {/* 次行允许折行（1366 事件列 29%）容纳 B2/B3 从属链接；标题两行截断不受影响 */}
                      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-xs text-ck-ink-3">
                        <span className="whitespace-nowrap">{TYPE_LABEL[e.event_type] ?? e.event_type} · 首次发现 {e.first_seen_date.slice(5)}</span>
                        {/* B2（裁定）：regionEvents 销售足迹关联，非标题模糊匹配；非唯一大区不出链接 */}
                        {uniqRegion && (
                          <button type="button" className="text-xs text-ck-primary hover:underline" onClick={() => onOpenRegion(uniqRegion)}>· 区域视角</button>
                        )}
                        {/* B3（裁定）：只做类型级跳转，不造目标筛选语义 */}
                        {e.event_type === "target_gap" && (
                          <button type="button" className="text-xs text-ck-primary hover:underline" onClick={onOpenTargetPage}>· 看目标</button>
                        )}
                      </div>
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
                    {/* 持续天数＝首次发现至今；只加粗不着色（§六裁定：无业务阈值，禁红黄绿） */}
                    <td className="whitespace-nowrap px-3 py-2.5 align-top text-ck-ink-3">
                      <span className="font-medium text-ck-ink" title="持续天数＝首次发现至今">{e.persist_days}</span> 天
                    </td>
                    {/* 当前状态两层：生命周期 + AI分析，各自独立（D-e2） */}
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <StatusTag tone={e.lifecycle === "active" ? "info" : "success"} dot size="sm">{e.lifecycle === "active" ? "进行中" : "已解除"}</StatusTag>
                        <StatusTag tone={ATTR_TONE[e.attribution_status] ?? "neutral"} size="sm">AI · {ATTR_LABEL[e.attribution_status] ?? e.attribution_status}</StatusTag>
                      </div>
                    </td>
                    <td className="px-2 py-2.5 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <PrimaryButton size="sm" className="whitespace-nowrap" onClick={() => onOpenEvent(e.event_id)}>查看详情</PrimaryButton>
                        <button type="button" className="text-left text-ck-primary hover:underline disabled:pointer-events-none disabled:text-ck-ink-3" disabled={followBusy === e.event_id} onClick={() => void follow(e.event_id)}>
                          {followBusy === e.event_id ? "分析中…" : "继续分析 →"}
                        </button>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </SectionCard>
          {data?.truncated && <div className="text-[11px] text-ck-warning">事件超过 500 条已截断显示——请联系管理员调整</div>}
          <SectionCard title="事件动态">
            <div className="max-h-72 overflow-y-auto">
              {data ? <ActivityTimeline events={data.events} onOpenEvent={onOpenEvent} /> : <div className="p-4 text-sm text-ck-ink-3">加载中…</div>}
            </div>
          </SectionCard>
        </div>
        <div className="flex w-full flex-col gap-5 xl:w-80 xl:shrink-0">
          {data && <OperatingSummaryCard data={data} />}
          {data && <EventDonutCard title="事件类型分布" items={data.eventTypeDistribution} total={data.events.length} />}
          {data && <EventDonutCard title="事件生命周期分布" items={data.lifecycleDistribution} total={data.events.length} palette={["#2563eb", "#10b981"]} />}
        </div>
      </div>
      {err && data && <div className="text-xs text-ck-danger">{err}</div>}
    </AppShell>
  );
}

/** 近30天经营摘要（P1-4，裁定4/5）：30日窗口指标与当前时点指标显式分标；
 *  平均解除周期沿用既有 persist_days 口径（不重造 resolved_at−first_seen 差值，裁定4）。 */
function OperatingSummaryCard({ data }: { data: EventCenterPayload }) {
  const activeN = data.lifecycleDistribution.find((d) => d.key === "active")?.count ?? 0;
  // 解除样本窗口 [asOf−29, asOf]：纯日期算术（锚定 asOf，不用 Date.now()）
  const start = new Date(Date.parse(data.asOf) - 29 * 86400e3).toISOString().slice(0, 10);
  const samples = data.events.filter((e) => e.resolved_at != null && e.resolved_at >= start && e.resolved_at <= data.asOf);
  const mean = samples.length ? samples.reduce((s, e) => s + e.persist_days, 0) / samples.length : null;
  return (
    <SectionCard title="近30天经营摘要">
      <div className="grid grid-cols-2 gap-3">
        <MiniStat label="新增（近30天）" value={`${data.summary.total.count} 条`} sub={<DeltaTag d={data.summary.total.delta} positiveIsGood={false} />} />
        <MiniStat label="已解除（近30天）" value={`${data.summary.resolved.count} 条`} sub={<DeltaTag d={data.summary.resolved.delta} positiveIsGood />} />
        <MiniStat label="平均解除周期（近30天）" value={mean == null ? "—" : `${mean.toFixed(1)} 天`} sub={data.truncated ? "基于最近500条" : null} />
        {/* 裁定5：时点指标，与前三格近30天窗口口径显式区分 */}
        <MiniStat label="当前持续（时点）" value={`${activeN} 件`} sub="时点值，区别于近30天窗口指标" />
      </div>
    </SectionCard>
  );
}

function MiniStat({ label, value, sub }: { label: string; value: string; sub?: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-ck-ink-3">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-ck-ink">{value}</div>
      {sub != null && <div className="text-[10px] text-ck-ink-3">{sub}</div>}
    </div>
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
 * 按时间倒序取 15 条（P1-4）；服务端未部署新字段时条目自然缺失，不炸。 */
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
    return out.sort((a, b) => b.t - a.t).slice(0, 15);
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
