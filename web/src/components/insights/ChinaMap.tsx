// M-i8 中国地图 SVG 渲染器（spec 2026-10-06 §5；P1-2 指标化）：省份 path 按当前指标色阶
// 着色——同比=服务端 level 红橙绿（唯一业务校准，阈值不前端重算，D-r1）；销售额=规模三分位
// 蓝阶、毛利率=相对三分位中性靛阶（裁定1.3/1.4：无红绿——规模≠好坏、无风险阈值不染色）。
// 大区气泡锚该区省份 centroid 均值（白底圆角标签：区名/当前指标值）；hover=该大区整组省份
// 描边高亮 + 浮动 tooltip（区名/指标值/同比，字段封顶）；点击九段线外空白=取消选中；
// 台湾/香港有边界无数据（unknown 灰）属正常。交互只做点击/hover（无缩放拖拽）。
import { useState } from "react";
import { CHINA_PROVINCES, NAME_LOOKUP, NINE_DASH, VIEWBOX } from "../../assets/china-map";
import type { RegionLevel } from "../../types";

// 大区→省份静态映射：harness insight/config/region-map.json 的 UI 侧副本（config 权威）
const REGION_PROVINCES: Record<string, string[]> = {
  华南: ["广东", "广西", "海南"],
  华东: ["上海", "江苏", "浙江", "安徽", "福建", "江西", "山东"],
  华中: ["湖南", "湖北", "河南"],
  华北: ["北京", "天津", "河北", "山西", "内蒙古"],
  西北: ["陕西", "甘肃", "宁夏", "新疆", "青海"],
  西南: ["四川", "重庆", "云南", "贵州", "西藏"],
  东北: ["辽宁", "吉林", "黑龙江"],
};

const PATH_BY_ADCODE = new Map(CHINA_PROVINCES.map((p) => [p.adcode, p]));
const ADCODE_REGION: Record<number, string> = {};
for (const [region, provs] of Object.entries(REGION_PROVINCES))
  for (const prov of provs) ADCODE_REGION[NAME_LOOKUP[prov]] = region;

// 同比三档（服务端 level 浅底+深描）+无数据灰
const LEVEL_STYLE: Record<RegionLevel, { fill: string; stroke: string }> = {
  decline: { fill: "#fecaca", stroke: "#ef4444" },
  watch: { fill: "#fed7aa", stroke: "#f97316" },
  growth: { fill: "#a7f3d0", stroke: "#10b981" },
  unknown: { fill: "#cbd5e1", stroke: "#94a3b8" },
};

export type MapMetric = "amt" | "yoy" | "gm";
export interface MapRegionRow {
  region: string; level: RegionLevel; ytdWan: number;
  yoyPct: number | null; grossMarginPct: number | null;
}

// ── 指标色阶单源：地图填充与图例同出 metricScale，永不分歧 ──
type Tier = "high" | "mid" | "low";
const AMT_STYLE: Record<Tier, { fill: string; stroke: string }> = {
  high: { fill: "#93c5fd", stroke: "#60a5fa" }, mid: { fill: "#bfdbfe", stroke: "#60a5fa" }, low: { fill: "#dbeafe", stroke: "#60a5fa" },
};
const GM_STYLE: Record<Tier, { fill: string; stroke: string }> = {
  high: { fill: "#c7d2fe", stroke: "#818cf8" }, mid: { fill: "#dde4f7", stroke: "#818cf8" }, low: { fill: "#eef2fb", stroke: "#818cf8" },
};

// 确定性三分位：按值降序，前 ceil(n/3)=高、后 floor(n/3)=低、其余中（n=7 → 高3/中2/低2）；
// 并列保序（Array.sort 稳定）；值为 null 不参与分位（→ unknown 灰）
function tercile(rows: MapRegionRow[], val: (r: MapRegionRow) => number | null): Map<string, Tier> {
  const sorted = rows.filter((r) => val(r) != null).sort((a, b) => (val(b) as number) - (val(a) as number));
  const n = sorted.length, hi = Math.ceil(n / 3), lo = Math.floor(n / 3);
  const m = new Map<string, Tier>();
  sorted.forEach((r, i) => m.set(r.region, i < hi ? "high" : i >= n - lo ? "low" : "mid"));
  return m;
}

export interface MetricScale {
  styleByRegion: Map<string, { fill: string; stroke: string }>;
  legend: Array<{ fill: string; stroke: string; label: string }>;
  note: string | null; // 裁定1.3/1.4 免责脚注（同比模式无）
}

/** 指标→色阶/图例唯一权威：同比沿用服务端 level；amt/gm 客户端三分位（无红绿）。 */
export function metricScale(metric: MapMetric, rows: MapRegionRow[]): MetricScale {
  if (metric === "yoy") {
    return {
      styleByRegion: new Map(rows.map((r) => [r.region, LEVEL_STYLE[r.level] ?? LEVEL_STYLE.unknown])),
      legend: [
        { ...LEVEL_STYLE.decline, label: "下滑 ≤-8%" },
        { ...LEVEL_STYLE.watch, label: "关注 <0" },
        { ...LEVEL_STYLE.growth, label: "增长 ≥0" },
      ],
      note: null,
    };
  }
  const style = metric === "amt" ? AMT_STYLE : GM_STYLE;
  const tiers = tercile(rows, metric === "amt" ? (r) => r.ytdWan : (r) => r.grossMarginPct);
  const label = metric === "amt"
    ? { high: "规模较高", mid: "规模中等", low: "规模较低" }
    : { high: "相对较高", mid: "中间水平", low: "相对较低" };
  return {
    styleByRegion: new Map(rows.map((r) => {
      const t = tiers.get(r.region);
      return [r.region, t ? style[t] : LEVEL_STYLE.unknown]; // gm 为 null → unknown 灰
    })),
    legend: (["high", "mid", "low"] as const).map((t) => ({ ...style[t], label: label[t] })),
    note: metric === "amt" ? "仅代表规模，不代表经营好坏" : "当前仅为区域相对分布，不代表风险评级",
  };
}

const METRIC_LABEL: Record<MapMetric, string> = { amt: "销售额", yoy: "同比", gm: "毛利率" };
const fmtPctSigned = (n: number | null) => (n == null ? "—" : `${n > 0 ? "+" : ""}${n}%`);
const metricValue = (metric: MapMetric, r: MapRegionRow) =>
  metric === "amt" ? `${(r.ytdWan / 10000).toFixed(1)}亿`
  : metric === "yoy" ? fmtPctSigned(r.yoyPct)
  : r.grossMarginPct == null ? "—" : `${r.grossMarginPct}%`;

export default function ChinaMap({ metric, regions, selected, onSelect }: {
  metric: MapMetric;
  regions: MapRegionRow[];
  selected: string | null; // null=全国（无高亮）
  onSelect: (region: string | null) => void; // null=点击空白取消选中
}) {
  const [hover, setHover] = useState<{ region: string; x: number; y: number } | null>(null);
  const rowByRegion = new Map(regions.map((r) => [r.region, r]));
  const scale = metricScale(metric, regions);
  // 大区气泡：锚点=该区省份 centroid 均值；无数据区（rows 缺该区）不造气泡
  const bubbles = Object.entries(REGION_PROVINCES).flatMap(([region, provs]) => {
    const row = rowByRegion.get(region);
    if (!row) return [];
    let sx = 0, sy = 0, n = 0;
    for (const prov of provs) {
      const p = PATH_BY_ADCODE.get(NAME_LOOKUP[prov]);
      if (p) { sx += p.centroid[0]; sy += p.centroid[1]; n++; }
    }
    return n ? [{ region, row, x: sx / n, y: sy / n }] : [];
  });
  const hoverRow = hover ? rowByRegion.get(hover.region) : undefined;

  return (
    <div className="relative h-full w-full">
      <svg viewBox={VIEWBOX.join(" ")} className="h-full w-full select-none">
        {/* 空白底板（首子元素=置于所有 path 之下）：点击九段线外背景 → 取消选中 */}
        <rect x={VIEWBOX[0]} y={VIEWBOX[1]} width={VIEWBOX[2]} height={VIEWBOX[3]} fill="transparent"
          className="cursor-default" onClick={() => onSelect(null)} />
        {CHINA_PROVINCES.map((p) => {
          const region = ADCODE_REGION[p.adcode]; // undefined=台湾/香港（无数据，灰）
          const st = (region ? scale.styleByRegion.get(region) : undefined) ?? LEVEL_STYLE.unknown;
          const sel = region != null && region === selected;
          const hov = region != null && hover?.region === region; // 大区整组 hover 描边高亮
          return (
            <path
              key={p.adcode} d={p.path} fill={st.fill}
              stroke={sel || hov ? "#1d4ed8" : st.stroke} strokeWidth={sel ? 1.5 : hov ? 1.2 : 0.6}
              className={region ? "cursor-pointer transition-[filter] hover:brightness-90" : ""}
              onClick={region ? () => onSelect(region) : undefined}
              onMouseEnter={region ? (e) => setHover({ region, x: e.clientX, y: e.clientY }) : undefined}
              onMouseMove={region ? (e) => setHover({ region, x: e.clientX, y: e.clientY }) : undefined}
              onMouseLeave={region ? () => setHover(null) : undefined}
            >
              <title>{p.name}</title>
            </path>
          );
        })}
        <path d={NINE_DASH} fill="none" stroke="#cbd5e1" strokeWidth={1} />
        {bubbles.map(({ region, row, x, y }) => (
          <g key={region} className="cursor-pointer"
            onClick={() => onSelect(region)}
            onMouseEnter={(e) => setHover({ region, x: e.clientX, y: e.clientY })}
            onMouseMove={(e) => setHover({ region, x: e.clientX, y: e.clientY })}
            onMouseLeave={() => setHover(null)}>
            <rect x={x - 34} y={y - 16} width={68} height={32} rx={6} fill="#ffffff" opacity={0.92}
              stroke={region === selected ? "#1d4ed8" : "#cbd5e1"} strokeWidth={region === selected ? 1.4 : 0.8} />
            <text x={x} y={y - 3} textAnchor="middle" fontSize={11} fontWeight={600} fill="#1e293b">{region}</text>
            {/* 第二行随指标：同比带符号红/绿；销售额/毛利率中性墨 */}
            <text x={x} y={y + 10} textAnchor="middle" fontSize={9.5}>
              <tspan fill={metric === "yoy"
                ? (row.yoyPct == null ? "#94a3b8" : row.yoyPct < 0 ? "#ef4444" : "#10b981")
                : "#64748b"}>
                {metricValue(metric, row)}
              </tspan>
            </text>
          </g>
        ))}
      </svg>
      {/* 图例右下三档，随指标切换（同比=服务端阈值；amt/gm=相对三分位 + 免责脚注，裁定1.3/1.4） */}
      <div className="pointer-events-none absolute bottom-2 right-2 flex max-w-[85%] flex-wrap items-center justify-end gap-x-2.5 gap-y-1 rounded-lg bg-white/90 px-2.5 py-1.5 text-[10px] text-slate-500 ring-1 ring-slate-100">
        {scale.legend.map((it) => (
          <span key={it.label} className="flex items-center gap-1">
            <i className="h-2.5 w-2.5 rounded-sm" style={{ background: it.fill, border: `1px solid ${it.stroke}` }} />
            {it.label}
          </span>
        ))}
        {scale.note && <span className="text-slate-400">{scale.note}</span>}
      </div>
      {/* 浮动 tooltip：区名 + 当前指标值 + 同比（≤3 行；同比模式指标即同比不重复显示）。
          svg 在可滚动页内，fixed + clientX/Y 定位最稳；pointer-events-none 防遮挡抖动。 */}
      {hover && hoverRow && (
        <div className="pointer-events-none fixed z-50 rounded-lg border border-ck-line bg-ck-card px-3 py-2 shadow-ck"
          style={{ left: hover.x + 12, top: hover.y + 12 }}>
          <div className="text-xs font-medium text-ck-ink">{hover.region}区域</div>
          <div className="mt-0.5 text-[11px] text-ck-ink-2">{METRIC_LABEL[metric]} {metricValue(metric, hoverRow)}</div>
          {metric !== "yoy" && (
            <div className="text-[11px] text-ck-ink-2">同比 {fmtPctSigned(hoverRow.yoyPct)}</div>
          )}
        </div>
      )}
    </div>
  );
}
