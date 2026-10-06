// M-i8 区域作战地图页（spec 2026-10-06 §6；P0-T5 ck 化；P1-2 产品化）：5 窄统计卡 /
// 指标切换（销售额/同比增速/毛利率，METRICS 单源）驱动地图色阶/气泡/排名 /
// 选中态区域画像（真实指标事实 + 关联真实事件 active 联表 + 让AI分析入口）/ 关联经营事件卡 /
// 底部三块——近 12 月区域趋势多线、省区表现分布 Top10 条形、重点作战区域三卡。口径全在
// 服务端（同窗同比/level 三档/事件关联 D-r1~D-r6），本页只过滤与展示；D-r3：未分区/海外
// 入排名灰尾行，不入地图/趋势/省分布默认池。金额万元→亿元 1 位小数；null→"—"；
// 红=同比下滑/绿=增长（销售额/毛利率色阶无红绿，裁定1.3/1.4）。
import { useEffect, useState } from "react";
import { apiInsightActiveEvents, apiInsightRegionMap } from "../../api";
import type {
  InsightActiveEvent, RegionMapDegraded, RegionMapEvent, RegionMapPayload, RegionMapProvinceRow,
  RegionMapRegionRow, RegionMapTrend,
} from "../../types";
import ChinaMap, { type MapMetric } from "./ChinaMap";
import AppShell from "../cockpit/AppShell";
import PageHeader from "../cockpit/PageHeader";
import SectionCard from "../cockpit/SectionCard";
import KpiCard from "../cockpit/KpiCard";
import StatusTag, { type Tone } from "../cockpit/StatusTag";
import PrimaryButton from "../cockpit/PrimaryButton";
import SecondaryButton from "../cockpit/SecondaryButton";
import DegradedLine from "../cockpit/DegradedLine";

const DOMESTIC_REGIONS = ["华南", "华东", "华中", "华北", "西北", "西南", "东北"];
const SPECIAL_REGIONS = ["未分区", "海外"];

const isDegraded = (x: unknown): x is RegionMapDegraded =>
  typeof x === "object" && x !== null && (x as RegionMapDegraded).available === false;

const fmtYi = (wan: number) => `${(wan / 10000).toFixed(1)} 亿`;
const fmtPct = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}%`);
const pctCls = (n: number | null) => (n == null ? "text-ck-ink-3" : n < 0 ? "text-ck-danger" : "text-ck-success");

// ── 指标单源配置（P1-2 §三.1）：切换器/排名列与排序/气泡/tooltip 全走这里；地图色阶在 ChinaMap.metricScale ──
type Metric = MapMetric; // "amt" | "yoy" | "gm"
interface MetricDef {
  label: string; // 切换器文案
  col: string;   // 排名值列头（含单位）
  auxCol: string; // 辅助列头（amt/gm 辅=同比；yoy 辅=销售额——数值列不超过两个）
  value: (r: RegionMapRegionRow) => string;
  valueCls: (r: RegionMapRegionRow) => string;
  aux: (r: RegionMapRegionRow) => string;
  auxCls: (r: RegionMapRegionRow) => string;
  sort: (a: RegionMapRegionRow, b: RegionMapRegionRow) => number;
}
const METRICS: Record<Metric, MetricDef> = {
  amt: {
    label: "销售额", col: "销售额(亿)", auxCol: "同比",
    value: (r) => (r.ytdWan / 10000).toFixed(1), valueCls: () => "text-ck-ink-2",
    aux: (r) => fmtPct(r.yoyPct), auxCls: (r) => `font-medium ${pctCls(r.yoyPct)}`,
    sort: (a, b) => b.ytdWan - a.ytdWan,
  },
  yoy: {
    label: "同比增速", col: "同比", auxCol: "销售额(亿)",
    value: (r) => fmtPct(r.yoyPct), valueCls: (r) => `font-medium ${pctCls(r.yoyPct)}`,
    aux: (r) => (r.ytdWan / 10000).toFixed(1), auxCls: () => "text-ck-ink-2",
    sort: (a, b) => (b.yoyPct ?? -Infinity) - (a.yoyPct ?? -Infinity),
  },
  gm: {
    label: "毛利率", col: "毛利率", auxCol: "同比",
    value: (r) => (r.grossMarginPct == null ? "—" : `${r.grossMarginPct}%`), valueCls: () => "font-medium text-ck-ink",
    aux: (r) => fmtPct(r.yoyPct), auxCls: (r) => `font-medium ${pctCls(r.yoyPct)}`,
    sort: (a, b) => (b.grossMarginPct ?? -Infinity) - (a.grossMarginPct ?? -Infinity),
  },
};
const METRIC_KEYS: Metric[] = ["amt", "yoy", "gm"];

// 事件状态文案/tone（与 EventCenterPage 同映射；纯展示层小拷贝，避免跨页 import 耦合）
const LIFE_LABEL: Record<string, string> = { active: "进行中", resolved: "已解除" };
const ATTR_LABEL: Record<string, string> = { pending: "待分析", running: "分析中", done: "分析完成", degraded: "降级完成", failed: "分析失败" };
const ATTR_TONE: Record<string, Tone> = { pending: "neutral", running: "info", done: "success", degraded: "warning", failed: "danger" };

/** 「让AI分析该区域」问句（裁定1.5：首问不强制全量下钻，由六步法识别贡献最大方向再深入）。 */
const buildQuestion = (region: string, row?: RegionMapRegionRow, events: Array<{ event_id: string; title: string }> = [], asOf?: string) => {
  const facts = row
    ? `年初至今销售额 ${fmtYi(row.ytdWan)}、同比 ${fmtPct(row.yoyPct)}、毛利率 ${row.grossMarginPct == null ? "未提供" : `${row.grossMarginPct}%`}`
    : "";
  const ev = events.length ? `可参考关联经营事件：${events.slice(0, 3).map((e) => `${e.title}（event_id ${e.event_id}）`).join("；")}。` : "";
  return `请分析${region}区域当前经营表现（数据截至 ${asOf ?? "最新"}）：${facts}。请先识别同比与毛利变化中贡献最大的下钻方向，再沿该方向深入分析原因。${ev}`;
};

/** 区域排名：排序/值列随页面指标（METRICS 单源）；国内七区行（点击=选区，选中蓝底）+ 未分区/海外灰行尾（只展示不可选）。 */
function RankCard({ block, metric, selected, onSelect }: {
  block: RegionMapRegionRow[] | RegionMapDegraded;
  metric: Metric; selected: string | null; onSelect: (r: string) => void;
}) {
  if (isDegraded(block)) return <SectionCard title="区域排名"><DegradedLine reason={block.reason} /></SectionCard>;
  const m = METRICS[metric];
  const domestic = block.filter((r) => !SPECIAL_REGIONS.includes(r.region));
  const special = block.filter((r) => SPECIAL_REGIONS.includes(r.region));
  const sorted = [...domestic].sort(m.sort);
  return (
    <SectionCard title="区域排名">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-ck-line text-left text-ck-ink-3">
            {["#", "区域", m.col, m.auxCol].map((h) => <th key={h} className="px-1.5 py-1.5 font-normal">{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r, i) => (
            <tr key={r.region}
              className={`cursor-pointer border-b border-ck-line/60 last:border-0 ${r.region === selected ? "bg-ck-primary-soft" : "hover:bg-ck-card-soft"}`}
              onClick={() => onSelect(r.region)}>
              <td className="px-1.5 py-1.5 text-ck-ink-3">{i + 1}</td>
              <td className="px-1.5 py-1.5 font-medium text-ck-ink">{r.region}</td>
              <td className={`px-1.5 py-1.5 ${m.valueCls(r)}`}>{m.value(r)}</td>
              <td className={`px-1.5 py-1.5 ${m.auxCls(r)}`}>{m.aux(r)}</td>
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

/** 关联经营事件（P1-2 更名去「分数」）：选中区→该区关联事件；未选→七区并集按分数去重排序（BU 级事件会出现在多区）。 */
function AlertCard({ block, selected, onOpenEvent }: {
  block: Record<string, RegionMapEvent[]> | RegionMapDegraded;
  selected: string | null; onOpenEvent: (id: string) => void;
}) {
  if (isDegraded(block)) return <SectionCard title="关联经营事件"><DegradedLine reason={block.reason} /></SectionCard>;
  const lists = selected ? [block[selected] ?? []] : DOMESTIC_REGIONS.map((r) => block[r] ?? []);
  const seen = new Set<string>();
  const events: RegionMapEvent[] = [];
  for (const e of lists.flat()) {
    if (!seen.has(e.event_id)) { seen.add(e.event_id); events.push(e); }
  }
  events.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)); // score 仅内部排序，不再对外展示
  return (
    <SectionCard
      title={`关联经营事件${selected ? ` · ${selected}` : " · 全部大区"}`}
      extra={<span className="text-[10px]">{events.length} 条</span>}
    >
      {events.length === 0 ? (
        <div className="py-8 text-center text-xs text-ck-ink-3">当前区域暂无关联经营事件</div>
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
                <div className="mt-0.5 text-[11px] text-ck-ink-3">{e.org ?? "—"}</div>
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

/** 区域画像（P1-2 §三.3，裁定1.1/1.2/1.6）：选中态右栏顶部——经营表现事实（真实指标）+
 *  关联经营事件（≤3 条，active 联表补状态/关键事实，miss 只显标题）+ AI 分析入口。 */
function RegionProfileCard({ region, row, events, activeJoin, onOpenEvent, onOpenEventCenter, onBack, onShowDetail, onAsk }: {
  region: string;
  row: RegionMapRegionRow | undefined;
  events: RegionMapEvent[];
  activeJoin: Map<string, InsightActiveEvent> | null;
  onOpenEvent: (id: string) => void;
  onOpenEventCenter: () => void; // 跳事件中心不带区域筛选（裁定1.1：文案不暗示筛选已生效）
  onBack: () => void;
  onShowDetail: () => void; // 平滑滚动到底部已联动三卡
  onAsk: () => void;
}) {
  return (
    <SectionCard>
      <div className="flex items-center justify-between">
        <span className="text-base font-semibold text-ck-ink">{region}区域</span>
        <button type="button" className="text-xs text-ck-primary transition-colors hover:underline" onClick={onBack}>
          返回全国
        </button>
      </div>

      {/* 区块一：经营表现事实（真实指标；达成率缺口只作轻量说明行，不与真实 KPI 同级——裁定1.2） */}
      <div className="mt-3 text-xs text-ck-ink-3">经营表现事实</div>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        <div>
          <div className="text-[10px] text-ck-ink-3">销售额</div>
          <div className="mt-0.5 text-sm font-medium text-ck-ink">{row ? fmtYi(row.ytdWan) : "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-ck-ink-3">同比</div>
          <div className={`mt-0.5 text-sm font-medium ${row ? pctCls(row.yoyPct) : "text-ck-ink-3"}`}>{row ? fmtPct(row.yoyPct) : "—"}</div>
        </div>
        <div>
          <div className="text-[10px] text-ck-ink-3">毛利率</div>
          <div className="mt-0.5 text-sm font-medium text-ck-ink">{row && row.grossMarginPct != null ? `${row.grossMarginPct}%` : "—"}</div>
        </div>
      </div>
      <div className="mt-1.5 text-[11px] text-ck-ink-3">区域目标达成率暂未接入</div>

      {/* 区块二：关联经营事件（服务端关联 top5 池，取前 3 展示；0 条如实显空） */}
      <div className="mt-3 text-xs text-ck-ink-3">关联经营事件 {events.length} 条</div>
      {events.length === 0 ? (
        <div className="py-3 text-center text-xs text-ck-ink-3">当前区域暂无关联经营事件</div>
      ) : (
        <div className="mt-1 flex flex-col">
          {events.slice(0, 3).map((e) => {
            const info = activeJoin?.get(e.event_id); // 联表 miss → 只显标题（诚实）
            const life = info ? LIFE_LABEL[info.lifecycle] : undefined;
            const attr = info ? ATTR_LABEL[info.attribution_status] : undefined;
            const brief = info?.summary ? info.summary.split("\n")[0] : null; // 关键事实取首行
            return (
              <div key={e.event_id} className="border-b border-ck-line/60 py-2 last:border-0">
                <div className="flex items-center gap-1.5">
                  <StatusTag tone={e.severity === "major" ? "danger" : "warning"} size="sm">
                    {e.severity === "major" ? "重大" : "一般"}
                  </StatusTag>
                  <button type="button" className="truncate text-left text-xs font-medium text-ck-ink transition-colors hover:text-ck-primary"
                    title={e.title} onClick={() => onOpenEvent(e.event_id)}>
                    {e.title}
                  </button>
                </div>
                {info && (life != null || attr != null || brief != null) && (
                  <div className="mt-1 flex min-w-0 items-center gap-1.5">
                    {life != null && (
                      <StatusTag tone={info.lifecycle === "resolved" ? "success" : "info"} dot size="sm">{life}</StatusTag>
                    )}
                    {attr != null && (
                      <StatusTag tone={ATTR_TONE[info.attribution_status] ?? "neutral"} size="sm">{attr}</StatusTag>
                    )}
                    {brief != null && (
                      <span className="min-w-0 flex-1 truncate text-[11px] text-ck-ink-3" title={info.summary}>{brief}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {events.length > 3 && (
            <button type="button" className="mt-1 self-end text-[11px] text-ck-primary hover:underline" onClick={onOpenEventCenter}>
              进入经营事件中心 →
            </button>
          )}
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <PrimaryButton size="sm" className="flex-1" onClick={onShowDetail}>查看区域详情</PrimaryButton>
        <SecondaryButton size="sm" className="flex-1" onClick={onAsk}>让AI分析该区域</SecondaryButton>
      </div>
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

export default function RegionBattleMapPage({ onOpenEvent, onOpenEventCenter, onAsk }: {
  onOpenEvent: (id: string) => void;
  onOpenEventCenter: () => void;
  onAsk: (question: string) => void;
}) {
  const [data, setData] = useState<RegionMapPayload | null>(null);
  const [activeJoin, setActiveJoin] = useState<Map<string, InsightActiveEvent> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selectedRegion, setSelectedRegion] = useState<string | null>(null); // null=全国
  const [metric, setMetric] = useState<Metric>("amt"); // 指标切换独立于选区（切换保持 selectedRegion）

  useEffect(() => {
    apiInsightRegionMap().then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    // active 事件联表（P1-2 §二.2）：补 summary/lifecycle/归因状态；失败=空表 → 全部只显标题（诚实降级）
    apiInsightActiveEvents()
      .then((r) => setActiveJoin(new Map(r.events.map((e) => [e.event_id, e]))))
      .catch(() => setActiveJoin(new Map()));
  }, []);

  const nat = data && !isDegraded(data.national) ? data.national : null;
  const regionsDegraded = !data || isDegraded(data.regions);
  const domestic = !regionsDegraded
    ? (data!.regions as RegionMapRegionRow[]).filter((r) => !SPECIAL_REGIONS.includes(r.region))
    : [];
  // regions 降级时显"—"不显 0（空数组计数会伪装"无风险区"）
  const focusCount = regionsDegraded ? null
    : domestic.filter((r) => r.level === "decline" || r.level === "watch").length;

  const regionEventsBlock = data && !isDegraded(data.regionEvents) ? data.regionEvents : null;
  const selectedRow = selectedRegion ? domestic.find((r) => r.region === selectedRegion) : undefined;
  const selectedEvents = selectedRegion && regionEventsBlock ? regionEventsBlock[selectedRegion] ?? [] : [];

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
        subtitle={<>查看全国区域经营表现与风险热点{data ? ` · 数据日 ${data.asOf}` : ""}</>}
      />
      {!data ? (
        <div className="py-6 text-sm text-ck-ink-3">加载中…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <KpiCard label="全国销售额" value={nat ? fmtYi(nat.ytdWan) : "—"}
              sub={nat ? `同比 ${fmtPct(nat.yoyPct)}` : "—"} subClassName={nat ? pctCls(nat.yoyPct) : undefined} />
            <KpiCard label="同比增速" value={nat ? fmtPct(nat.yoyPct) : "—"}
              valueClassName={nat ? pctCls(nat.yoyPct) : undefined}
              sub={<span title={data.window}>vs 上年同期</span>} />
            <KpiCard label="毛利率" value={nat && nat.grossMarginPct != null ? `${nat.grossMarginPct}%` : "—"}
              sub="窗内毛利 ÷ 净销售" />
            <KpiCard label="全国达成率" value={nat && nat.achievePct != null ? `${nat.achievePct}%` : "—"}
              sub="目标口径" />
            <KpiCard label="同比下滑区域"
              value={focusCount === null ? "—" : `${focusCount} / ${domestic.length}`}
              valueClassName={focusCount != null && focusCount > 0 ? "text-ck-danger" : undefined}
              sub={focusCount === null ? "区域数据未就绪" : "同比增速为负"} />
          </div>
          {isDegraded(data.national) && (
            <div className="text-[11px] text-ck-warning">全国概览降级：{data.national.reason}</div>
          )}

          <div className="flex flex-col gap-5 xl:flex-row">
            <SectionCard
              className="min-w-0 flex-1" title="全国区域分布"
              extra={
                <div className="flex items-center gap-2">
                  {/* 指标切换（P1-2 §三.1）：驱动地图色阶/气泡/排名，样式同排名 tab 胶囊 */}
                  <div className="flex gap-1">
                    {METRIC_KEYS.map((k) => (
                      <button key={k} type="button"
                        className={`rounded px-2 py-0.5 text-[11px] transition-colors ${metric === k ? "bg-ck-primary-soft font-medium text-ck-primary" : "text-ck-ink-3 hover:text-ck-ink-2"}`}
                        onClick={() => setMetric(k)}>
                        {METRICS[k].label}
                      </button>
                    ))}
                  </div>
                  <span className="text-[11px]">{selectedRegion ?? "点击大区联动右栏"}</span>
                </div>
              }
            >
              {isDegraded(data.regions) && (
                <div className="mb-2 rounded bg-ck-card-soft px-2 py-1 text-[10px] text-ck-ink-3">{data.regions.reason}</div>
              )}
              <div className="h-[430px]">
                <ChinaMap metric={metric} regions={domestic} selected={selectedRegion}
                  onSelect={(r) => (r == null ? setSelectedRegion(null) : toggleSelect(r))} />
              </div>
            </SectionCard>
            <div className="flex w-full flex-col gap-5 xl:w-80 xl:shrink-0">
              {selectedRegion && (
                <RegionProfileCard
                  region={selectedRegion}
                  row={selectedRow}
                  events={selectedEvents}
                  activeJoin={activeJoin}
                  onOpenEvent={onOpenEvent}
                  onOpenEventCenter={onOpenEventCenter}
                  onBack={() => setSelectedRegion(null)}
                  onShowDetail={() => document.getElementById("region-drilldown")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                  onAsk={() => onAsk(buildQuestion(selectedRegion, selectedRow, selectedEvents, data.asOf))}
                />
              )}
              <RankCard block={data.regions} metric={metric} selected={selectedRegion} onSelect={toggleSelect} />
              <AlertCard block={data.regionEvents} selected={selectedRegion} onOpenEvent={onOpenEvent} />
            </div>
          </div>

          <div id="region-drilldown" className="grid grid-cols-1 gap-5 xl:grid-cols-3">
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
