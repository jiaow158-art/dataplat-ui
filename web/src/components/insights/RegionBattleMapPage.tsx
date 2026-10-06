// M-i8 区域作战地图页（spec 2026-10-06 §6；P0-T5 改版上 ck 体系）：5 窄统计卡 /
// 大区着色地图+气泡（左 ~60%）/ 区域排名（tab 销售额/同比增速）+ 重点预警（大区关联事件）/
// 底部三块——近 12 月区域趋势多线、省区表现分布 Top10 条形、重点作战区域三卡。口径全在
// 服务端（同窗同比/level 三档/事件关联 D-r1~D-r6），本页只过滤与展示；D-r3：未分区/海外
// 入排名灰尾行，不入地图/趋势/省分布默认池。金额万元→亿元 1 位小数；null→"—"；
// 红=同比下滑/绿=增长（产品色彩纪律）。
import { useEffect, useState } from "react";
import { apiInsightRegionMap } from "../../api";
import type {
  RegionMapDegraded, RegionMapEvent, RegionMapPayload, RegionMapProvinceRow,
  RegionMapRegionRow, RegionMapTrend,
} from "../../types";
import ChinaMap from "./ChinaMap";
import AppShell from "../cockpit/AppShell";
import PageHeader from "../cockpit/PageHeader";
import SectionCard from "../cockpit/SectionCard";
import KpiCard from "../cockpit/KpiCard";
import StatusTag from "../cockpit/StatusTag";
import PrimaryButton from "../cockpit/PrimaryButton";
import DegradedLine from "../cockpit/DegradedLine";

const DOMESTIC_REGIONS = ["华南", "华东", "华中", "华北", "西北", "西南", "东北"];
const SPECIAL_REGIONS = ["未分区", "海外"];

const isDegraded = (x: unknown): x is RegionMapDegraded =>
  typeof x === "object" && x !== null && (x as RegionMapDegraded).available === false;

const fmtYi = (wan: number) => `${(wan / 10000).toFixed(1)} 亿`;
const fmtPct = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}%`);
const pctCls = (n: number | null) => (n == null ? "text-ck-ink-3" : n < 0 ? "text-ck-danger" : "text-ck-success");

/** 区域排名：国内七区行（点击=选区，选中蓝底）+ 未分区/海外灰行尾（只展示不可选）。 */
function RankCard({ block, tab, setTab, selected, onSelect }: {
  block: RegionMapRegionRow[] | RegionMapDegraded;
  tab: "amt" | "yoy"; setTab: (t: "amt" | "yoy") => void;
  selected: string | null; onSelect: (r: string) => void;
}) {
  if (isDegraded(block)) return <SectionCard title="区域排名"><DegradedLine reason={block.reason} /></SectionCard>;
  const domestic = block.filter((r) => !SPECIAL_REGIONS.includes(r.region));
  const special = block.filter((r) => SPECIAL_REGIONS.includes(r.region));
  const sorted = [...domestic].sort((a, b) =>
    tab === "amt" ? b.ytdWan - a.ytdWan : (b.yoyPct ?? -Infinity) - (a.yoyPct ?? -Infinity));
  return (
    <SectionCard
      title="区域排名"
      extra={
        <div className="flex gap-1">
          {(["amt", "yoy"] as const).map((t) => (
            <button key={t} type="button"
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${tab === t ? "bg-ck-primary-soft font-medium text-ck-primary" : "text-ck-ink-3 hover:text-ck-ink"}`}
              onClick={() => setTab(t)}>
              {t === "amt" ? "销售额" : "同比增速"}
            </button>
          ))}
        </div>
      }
    >
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-ck-line text-left text-ck-ink-3">
            {["#", "区域", "销售额(亿)", "同比"].map((h) => <th key={h} className="px-1.5 py-1.5 font-normal">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.region}
              className={`cursor-pointer border-b border-ck-line/60 last:border-0 ${r.region === selected ? "bg-ck-primary-soft" : "hover:bg-ck-card-soft"}`}
              onClick={() => onSelect(r.region)}>
              <td className="px-1.5 py-1.5 text-ck-ink-3">{i + 1}</td>
              <td className="px-1.5 py-1.5 font-medium text-ck-ink">{r.region}</td>
              <td className="px-1.5 py-1.5 text-ck-ink-2">{(r.ytdWan / 10000).toFixed(1)}</td>
              <td className={`px-1.5 py-1.5 font-medium ${pctCls(r.yoyPct)}`}>{fmtPct(r.yoyPct)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {special.length > 0 && (
        <p className="mt-1.5 px-1.5 text-[10px] text-ck-ink-3">
          {special.map((r) => `${r.region} ${(r.ytdWan / 10000).toFixed(1)} 亿`).join(" · ")}
          （计入全国，不入排名——D-r3）
        </p>
      )}
    </SectionCard>
  );
}

/** 重点预警：选中区→该区关联事件；未选→七区并集按分数去重排序（BU 级事件会出现在多区）。 */
function AlertCard({ block, selected, onOpenEvent }: {
  block: Record<string, RegionMapEvent[]> | RegionMapDegraded;
  selected: string | null; onOpenEvent: (id: string) => void;
}) {
  if (isDegraded(block)) return <SectionCard title="重点预警"><DegradedLine reason={block.reason} /></SectionCard>;
  const lists = selected ? [block[selected] ?? []] : DOMESTIC_REGIONS.map((r) => block[r] ?? []);
  const seen = new Set<string>();
  const events: RegionMapEvent[] = [];
  for (const e of lists.flat()) {
    if (!seen.has(e.event_id)) { seen.add(e.event_id); events.push(e); }
  }
  events.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return (
    <SectionCard
      title={`重点预警${selected ? ` · ${selected}` : " · 全部大区"}`}
      extra={<span className="text-[10px]">{events.length} 条关联事件</span>}
    >
      {events.length === 0 ? (
        <div className="py-8 text-center text-xs text-ck-ink-3">暂无关联事件</div>
      ) : (
        <div className="max-h-80 overflow-y-auto">
          {events.map((e) => (
            <div key={e.event_id} className="flex items-start justify-between gap-2 border-b border-ck-line/60 py-2 last:border-0">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <StatusTag tone={e.severity === "major" ? "danger" : "warning"} size="sm">
                    {e.severity === "major" ? "重大" : "一般"}
                  </StatusTag>
                  <button type="button" className="truncate text-left text-xs font-medium text-ck-ink transition-colors hover:text-ck-primary"
                    title={e.title} onClick={() => onOpenEvent(e.event_id)}>
                    {e.title}
                  </button>
                </div>
                <div className="mt-0.5 text-[11px] text-ck-ink-3">
                  {e.org ?? "—"} · 分数 {e.score == null ? "—" : e.score}
                </div>
              </div>
              <button type="button" className="shrink-0 text-[11px] text-ck-primary hover:underline" onClick={() => onOpenEvent(e.event_id)}>
                查看详情
              </button>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** 区域趋势：近 12 月多线 SVG；选中区加粗高亮、其余淡化；图例=区名；万元转亿显示。 */
const LINE_COLORS: Record<string, string> = {
  华南: "#2563eb", 华东: "#0891b2", 华中: "#7c3aed", 华北: "#db2777",
  西北: "#d97706", 西南: "#0f766e", 东北: "#64748b",
};

function RegionTrendCard({ block, selected }: { block: RegionMapTrend | RegionMapDegraded; selected: string | null }) {
  if (isDegraded(block)) return <SectionCard title="区域趋势"><DegradedLine reason={block.reason} /></SectionCard>;
  const names = Object.keys(block.series);
  const months = block.months;
  const W = 560, H = 190, PL = 36, PR = 10, PT = 8, PB = 20;
  const maxWan = Math.max(1, ...names.flatMap((r) => block.series[r].map((p) => p.wan)));
  const x = (i: number) => PL + (i * (W - PL - PR)) / Math.max(1, months.length - 1);
  const y = (wan: number) => PT + (1 - wan / maxWan) * (H - PT - PB);
  return (
    <SectionCard title="区域趋势" extra={<span className="text-[10px]">近 12 月实绩（亿）</span>}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, maxWan / 2, maxWan].map((v, i) => (
          <g key={i}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#f1f5f9" strokeWidth={1} />
            <text x={PL - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{(v / 10000).toFixed(1)}</text>
          </g>
        ))}
        {months.map((m, i) =>
          i % 2 ? null : (
            <text key={m} x={x(i)} y={H - 6} textAnchor="middle" fontSize={8} fill="#94a3b8">{m.slice(2)}</text>
          )
        )}
        {names.map((r) => {
          const pts = block.series[r];
          const sel = r === selected;
          return (
            <path key={r}
              d={pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.wan).toFixed(1)}`).join("")}
              fill="none" stroke={LINE_COLORS[r] ?? "#94a3b8"}
              strokeWidth={sel ? 2.4 : 1.2} opacity={selected && !sel ? 0.25 : 0.9} />
          );
        })}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-ck-ink-2">
        {names.map((r) => (
          <span key={r} className={`flex items-center gap-1 ${r === selected ? "font-semibold text-ck-ink" : ""}`}>
            <i className="h-1.5 w-3 rounded-full" style={{ background: LINE_COLORS[r] ?? "#94a3b8" }} />
            {r}
          </span>
        ))}
      </div>
    </SectionCard>
  );
}

/** 省区表现分布：selectedRegion 过滤（null=国内七区池）Top10 条形——条宽=ytdWan 占比、右侧同比%红绿。 */
function ProvinceDistCard({ block, selected }: { block: RegionMapProvinceRow[] | RegionMapDegraded; selected: string | null }) {
  if (isDegraded(block)) return <SectionCard title="省区表现分布"><DegradedLine reason={block.reason} /></SectionCard>;
  const rows = block
    .filter((p) => (selected ? p.region === selected : DOMESTIC_REGIONS.includes(p.region)))
    .sort((a, b) => b.ytdWan - a.ytdWan)
    .slice(0, 10);
  const max = rows.length ? Math.max(...rows.map((r) => r.ytdWan)) : 0;
  return (
    <SectionCard
      title={`省区表现分布${selected ? ` · ${selected}` : ""}`}
      extra={<span className="text-[10px]">销售额(亿) · 同比</span>}
    >
      {rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-ck-ink-3">该区暂无省份数据</div>
      ) : (
        rows.map((p) => (
          <div key={`${p.region}-${p.prov}`} className="flex items-center gap-2 py-1">
            <span className="w-14 shrink-0 truncate text-[11px] text-ck-ink-2" title={p.prov}>{p.prov}</span>
            <div className="h-3 min-w-0 flex-1 rounded-sm bg-ck-card-soft">
              <div className="h-3 rounded-sm bg-blue-300" style={{ width: `${max ? Math.max((p.ytdWan / max) * 100, 0.5) : 0}%` }} />
            </div>
            <span className="w-14 shrink-0 text-right text-[11px] text-ck-ink">{(p.ytdWan / 10000).toFixed(1)}</span>
            <span className={`w-14 shrink-0 text-right text-[11px] ${pctCls(p.yoyPct)}`}>{fmtPct(p.yoyPct)}</span>
          </div>
        ))
      )}
    </SectionCard>
  );
}

/** 重点作战区域：国内区按 yoyPct 升序（下滑最深在前；null 不参与）取三，不足三张如实少显。 */
function BattleCard({ block, onSelect }: { block: RegionMapRegionRow[] | RegionMapDegraded; onSelect: (r: string) => void }) {
  if (isDegraded(block)) return <SectionCard title="重点作战区域"><DegradedLine reason={block.reason} /></SectionCard>;
  const rows = block
    .filter((r) => !SPECIAL_REGIONS.includes(r.region) && r.yoyPct != null)
    .sort((a, b) => (a.yoyPct ?? 0) - (b.yoyPct ?? 0))
    .slice(0, 3);
  return (
    <SectionCard title="重点作战区域" extra={<span className="text-[10px]">同比下滑最深三区</span>}>
      {rows.length === 0 ? (
        <div className="py-8 text-center text-xs text-ck-ink-3">暂无可比区域</div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.region} className="rounded-lg border border-ck-line p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-ck-ink">{r.region}</span>
                <span className={`text-xs font-semibold ${pctCls(r.yoyPct)}`}>{fmtPct(r.yoyPct)}</span>
              </div>
              <div className="mt-1 text-[11px] text-ck-ink-2">
                销售 {fmtYi(r.ytdWan)} · 毛利率 {r.grossMarginPct == null ? "—" : `${r.grossMarginPct}%`}
              </div>
              <PrimaryButton size="sm" className="mt-2 w-full" onClick={() => onSelect(r.region)}>
                查看
              </PrimaryButton>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

export default function RegionBattleMapPage({ onOpenEvent }: { onOpenEvent: (id: string) => void }) {
  const [data, setData] = useState<RegionMapPayload | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null); // null=全国
  const [rankTab, setRankTab] = useState<"amt" | "yoy">("amt");

  useEffect(() => {
    apiInsightRegionMap().then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);

  const nat = data && !isDegraded(data.national) ? data.national : null;
  const regionsDegraded = !data || isDegraded(data.regions);
  const domestic = !regionsDegraded
    ? (data!.regions as RegionMapRegionRow[]).filter((r) => !SPECIAL_REGIONS.includes(r.region))
    : [];
  // regions 降级时显"—"不显 0（空数组计数会伪装"无风险区"）
  const focusCount = regionsDegraded ? null
    : domestic.filter((r) => r.level === "decline" || r.level === "watch").length;

  // 再点同一区=回到全国（排名行/地图省份/气泡共用；作战卡"查看"是定向选中不切换）
  const toggleSelect = (r: string) => setSelectedRegion((cur) => (cur === r ? null : r));

  if (err && !data)
    return (
      <AppShell>
        <div className="text-sm text-ck-ink-2">
          区域作战地图暂不可用。
          <br />
          <span className="text-xs text-ck-ink-3">{err}</span>
        </div>
      </AppShell>
    );

  return (
    <AppShell>
      <PageHeader
        title="区域作战地图"
        subtitle={
          <>
            查看全国区域经营表现与风险热点{data ? ` · 数据日 ${data.asOf}` : ""}
            {data && <span className="ml-2 text-[11px] text-ck-ink-3">{data.window}</span>}
          </>
        }
      />
      {!data ? (
        <div className="py-6 text-sm text-ck-ink-3">加载中…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="全国销售额" value={nat ? fmtYi(nat.ytdWan) : "—"}
              sub={nat ? `同比 ${fmtPct(nat.yoyPct)}` : "—"} subClassName={nat ? pctCls(nat.yoyPct) : undefined} />
            <KpiCard label="同比增速" value={nat ? fmtPct(nat.yoyPct) : "—"}
              valueClassName={nat ? pctCls(nat.yoyPct) : undefined} sub="双年同窗" />
            <KpiCard label="毛利率" value={nat && nat.grossMarginPct != null ? `${nat.grossMarginPct}%` : "—"}
              sub="窗内毛利 ÷ 净销售" />
            <KpiCard label="全国达成率" value={nat && nat.achievePct != null ? `${nat.achievePct}%` : "—"}
              sub="目标口径" />
            <KpiCard label="重点关注区域数"
              value={focusCount === null ? "—" : String(focusCount)}
              valueClassName={focusCount != null && focusCount > 0 ? "text-ck-danger" : undefined}
              sub={focusCount === null ? "区域数据未就绪" : "同比下滑或需关注"} />
          </div>
          {isDegraded(data.national) && (
            <div className="text-[11px] text-ck-warning">全国概览降级：{data.national.reason}</div>
          )}

          <div className="flex flex-col gap-5 xl:flex-row">
            <SectionCard className="min-w-0 flex-1" title="全国区域分布" extra={selectedRegion ?? "点击大区联动右栏"}>
              {isDegraded(data.regions) && (
                <div className="mb-2 rounded bg-ck-card-soft px-2 py-1 text-[10px] text-ck-ink-3">{data.regions.reason}</div>
              )}
              <div className="h-[430px]">
                <ChinaMap regions={domestic} selected={selectedRegion} onSelect={toggleSelect} />
              </div>
            </SectionCard>
            <div className="flex w-full flex-col gap-5 xl:w-80 xl:shrink-0">
              <RankCard block={data.regions} tab={rankTab} setTab={setRankTab} selected={selectedRegion} onSelect={toggleSelect} />
              <AlertCard block={data.regionEvents} selected={selectedRegion} onOpenEvent={onOpenEvent} />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            <RegionTrendCard block={data.regionTrend} selected={selectedRegion} />
            <ProvinceDistCard block={data.provinces} selected={selectedRegion} />
            <BattleCard block={data.regions} onSelect={(r) => setSelectedRegion(r)} />
          </div>

          {data.unmappedProvinces.length > 0 && (
            <div className="text-[11px] text-ck-ink-3">
              未映射省份：{data.unmappedProvinces.join("、")}（已计入未分区）
            </div>
          )}
        </>
      )}
    </AppShell>
  );
}
