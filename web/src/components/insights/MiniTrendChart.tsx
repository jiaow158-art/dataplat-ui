// M-i5 迷你趋势图（spec §4.1 kind 四型）。纯 SVG——卡片内嵌 120px 高、详情页趋势卡共用。
// 空序列/全 null → 空态文案（诚实，不画假线）。
import type { InsightTrend } from "../../types";

const W = 240, H = 120, PAD = 6;

export default function MiniTrendChart({
  trend, height, showLegend = false,
}: { trend: InsightTrend | null; height?: number; showLegend?: boolean }) {
  if (!trend || trend.series.length === 0 ||
      trend.series.every((p) => p.cur == null && p.prev == null)) {
    return <div className="flex h-[80px] items-center justify-center text-xs text-slate-300">暂无趋势序列</div>;
  }
  const n = trend.series.length;
  const vals = trend.series.flatMap((p) => [p.cur, p.prev]).filter((v): v is number => v != null);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || 1;
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(n - 1, 1);
  const y = (v: number) => PAD + (1 - (v - lo) / span) * (H - 2 * PAD);
  // null 断点简化：直接跳过 null 点连一条线（月度聚合序列断点极罕见）；空态分支已保住诚实性
  const pts = (key: "cur" | "prev") =>
    trend!.series
      .map((p, i) => (p[key] == null ? null : `${x(i)},${y(p[key]!)}`))
      .filter((s): s is string => s != null)
      .join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: height ?? 120 }} role="img"
           aria-label={`${trend.anchor_id} 趋势`}>
        {trend.kind === "month_compare" && trend.series.map((p, i) => {
          const bw = (W - 2 * PAD) / n / 2.6;
          return p.cur == null && p.prev == null ? null : (
            <g key={p.month}>
              {p.prev != null && <rect x={x(i) - bw - 1} width={bw} fill="#bfdbfe"
                 y={y(p.prev)} height={Math.max(H - PAD - y(p.prev), 1)} />}
              {p.cur != null && <rect x={x(i) + 1} width={bw} fill="#2563eb"
                 y={y(p.cur)} height={Math.max(H - PAD - y(p.cur), 1)} />}
            </g>
          );
        })}
        {trend.kind === "month_single" && (
          <>
            {trend.detector === "ar_risk" && (
              <polygon fill="rgba(239,68,68,0.12)"
                points={pts("cur").split(" ").length > 1
                  ? `${PAD},${H - PAD} ${pts("cur")} ${x(n - 1)},${H - PAD}` : undefined} />
            )}
            <polyline fill="none" stroke={trend.detector === "ar_risk" ? "#ef4444" : "#2563eb"}
              strokeWidth="2" points={pts("cur")} />
          </>
        )}
        {trend.kind === "cumulative_dual" && (
          <>
            <polyline fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="4 3" points={pts("prev")} />
            <polyline fill="none" stroke="#2563eb" strokeWidth="2" points={pts("cur")} />
          </>
        )}
      </svg>
      {showLegend && (
        <div className="mt-1 flex gap-3 text-[11px] text-slate-400">
          {trend.kind === "month_compare" && (<><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-200" />上年同期</span><span><i className="mr-1 inline-block h-2 w-2 rounded-sm bg-blue-600" />本期</span></>)}
          {trend.kind === "month_single" && <span>单位：{trend.unit}（{trend.series[0].month} ~ {trend.series[trend.series.length - 1].month}）</span>}
          {trend.kind === "cumulative_dual" && (<><span><i className="mr-1 inline-block h-0.5 w-3 bg-slate-400" />时间进度</span><span><i className="mr-1 inline-block h-0.5 w-3 bg-blue-600" />累计达成</span></>)}
        </div>
      )}
    </div>
  );
}
