// M-i5 趋势卡（spec §4.1）：按事件锚点取月度序列。月份/区域选择器 v1.1 不做——单锚点。
import { useEffect, useState } from "react";
import { apiInsightTrend } from "../../api";
import type { InsightTrend } from "../../types";
import MiniTrendChart from "./MiniTrendChart";

export default function TrendPanel({ eventId }: { eventId: string }) {
  const [trend, setTrend] = useState<InsightTrend | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    apiInsightTrend(eventId).then((t) => alive && setTrend(t)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, [eventId]);
  // 同比角标仅 month_compare 有意义：cumulative_dual 的 cur/prev 是达成率/时间进度（非同比），
  // month_single 的 prev 恒 null——两者都不算不显示。
  const last = trend?.kind === "month_compare"
    ? trend.series.filter((p) => p.cur != null && p.prev != null).at(-1) : undefined;
  const yoy = last && last.prev ? Math.round((last.cur! / last.prev - 1) * 1000) / 10 : null;
  return (
    <div className="rounded-xl bg-white p-6 ring-1 ring-slate-100">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">趋势变化</h3>
        {yoy != null && (
          <span className={`text-xs font-medium ${yoy < 0 ? "text-red-500" : "text-emerald-600"}`}>
            最新完整期 {yoy > 0 ? "+" : ""}{yoy}%
          </span>
        )}
      </div>
      <div className="mt-3">
        {failed
          ? <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">趋势序列暂不可用（不影响归因与事实）</div>
          : <MiniTrendChart trend={trend} height={200} showLegend />}
      </div>
    </div>
  );
}
