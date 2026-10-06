// M-i8 中国地图 SVG 渲染器（spec 2026-10-06 §5）：省份 path 按所属大区 level 着色
// （D-r1 产品色彩纪律：下滑红/关注橙/增长绿——浅底+深描），大区气泡锚该区省份
// centroid 均值（白底圆角标签：区名/销售额亿/同比%）；未分区/海外不入图；
// 台湾/香港有边界无数据（unknown 灰）属正常。交互只做点击选区（无缩放/拖拽）。
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

// 三档着色（浅底+深描）+无数据灰；图例与之一一对应
const LEVEL_STYLE: Record<RegionLevel, { fill: string; stroke: string }> = {
  decline: { fill: "#fecaca", stroke: "#ef4444" },
  watch: { fill: "#fed7aa", stroke: "#f97316" },
  growth: { fill: "#a7f3d0", stroke: "#10b981" },
  unknown: { fill: "#cbd5e1", stroke: "#94a3b8" },
};

interface ChinaMapProps {
  regions: Array<{ region: string; level: RegionLevel; ytdWan: number; yoyPct: number | null }>;
  selected: string | null; // null=全国（无高亮）
  onSelect: (region: string) => void;
}

export default function ChinaMap({ regions, selected, onSelect }: ChinaMapProps) {
  const rowByRegion = new Map(regions.map((r) => [r.region, r]));
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

  return (
    <div className="relative h-full w-full">
      <svg viewBox={VIEWBOX.join(" ")} className="h-full w-full select-none">
        {CHINA_PROVINCES.map((p) => {
          const region = ADCODE_REGION[p.adcode]; // undefined=台湾/香港（无数据，灰）
          const level: RegionLevel = (region ? rowByRegion.get(region)?.level : undefined) ?? "unknown";
          const st = LEVEL_STYLE[level] ?? LEVEL_STYLE.unknown;
          const sel = region != null && region === selected;
          return (
            <path
              key={p.adcode} d={p.path} fill={st.fill}
              stroke={sel ? "#1d4ed8" : st.stroke} strokeWidth={sel ? 1.5 : 0.6}
              className={region ? "cursor-pointer transition-[filter] hover:brightness-90" : ""}
              onClick={region ? () => onSelect(region) : undefined}
            >
              <title>{p.name}</title>
            </path>
          );
        })}
        <path d={NINE_DASH} fill="none" stroke="#cbd5e1" strokeWidth={1} />
        {bubbles.map(({ region, row, x, y }) => (
          <g key={region} className="cursor-pointer" onClick={() => onSelect(region)}>
            <rect x={x - 34} y={y - 16} width={68} height={32} rx={6} fill="#ffffff" opacity={0.92}
              stroke={region === selected ? "#1d4ed8" : "#cbd5e1"} strokeWidth={region === selected ? 1.4 : 0.8} />
            <text x={x} y={y - 3} textAnchor="middle" fontSize={11} fontWeight={600} fill="#1e293b">{region}</text>
            <text x={x} y={y + 10} textAnchor="middle" fontSize={9.5} fill="#64748b">
              {(row.ytdWan / 10000).toFixed(1)}亿{" "}
              <tspan fill={row.yoyPct == null ? "#94a3b8" : row.yoyPct < 0 ? "#ef4444" : "#10b981"}>
                {row.yoyPct == null ? "—" : `${row.yoyPct > 0 ? "+" : ""}${row.yoyPct}%`}
              </tspan>
            </text>
          </g>
        ))}
      </svg>
      {/* 图例右下三档（D-r1） */}
      <div className="pointer-events-none absolute bottom-2 right-2 flex items-center gap-2.5 rounded-lg bg-white/90 px-2.5 py-1.5 text-[10px] text-slate-500 ring-1 ring-slate-100">
        {([["decline", "下滑 ≤-8%"], ["watch", "关注 <0"], ["growth", "增长 ≥0"]] as const).map(([lv, label]) => (
          <span key={lv} className="flex items-center gap-1">
            <i className="h-2.5 w-2.5 rounded-sm" style={{ background: LEVEL_STYLE[lv].fill, border: `1px solid ${LEVEL_STYLE[lv].stroke}` }} />
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
