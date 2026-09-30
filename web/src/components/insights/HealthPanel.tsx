// M-i5 经营健康度卡（spec §5/§6）：确定性映射分数，点击看算式（D-c1"分数谁定的"）。
// 库存环=灰态未接入（诚实红线）；某环 available:false 显示原因行——不造分。
import { useEffect, useState } from "react";
import { apiInsightHealthScore } from "../../api";
import type { InsightHealthRing, InsightHealthScore } from "../../types";

function Ring({ value, color }: { value: number; color: string }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${(c * Math.min(Math.max(value, 0), 100)) / 100} ${c}`}
        strokeLinecap="round" transform="rotate(-90 32 32)" />
    </svg>
  );
}

const ringColor = (s: number) => (s < 60 ? "#ef4444" : s < 80 ? "#f97316" : "#2563eb");

function RingCell({ r }: { r: InsightHealthRing }) {
  const [open, setOpen] = useState(false);
  if (!r.available || r.score == null) {
    return (
      <div className="flex flex-col items-center rounded-lg p-2">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-50 text-slate-300">
          <span className="text-[10px]">未接入</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400" title={r.reason}>{r.label}</div>
      </div>
    );
  }
  return (
    <div className="relative flex flex-col items-center">
      <button type="button" className="relative" onClick={() => setOpen(!open)}>
        <Ring value={r.score} color={ringColor(r.score)} />
        <div className="absolute inset-0 flex items-center justify-center text-sm font-semibold text-slate-800">
          {r.score}
        </div>
      </button>
      <div className="text-[11px] text-slate-500">{r.label}</div>
      {r.mom_delta != null && (
        <div className={`text-[10px] ${r.mom_delta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
          {r.mom_delta >= 0 ? "▲" : "▼"} 较上期 {Math.abs(r.mom_delta)}
        </div>
      )}
      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-lg bg-slate-900 p-3 text-left text-[11px] leading-relaxed text-slate-100 shadow-lg">
          <div className="font-medium text-white">{r.label}</div>
          <div className="mt-1">{r.formula}</div>
          {r.inputs && (
            <div className="mt-1 text-slate-400">
              输入：{Object.entries(r.inputs).map(([k, v]) => `${k}=${String(v)}`).join("，")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function HealthPanel() {
  const [data, setData] = useState<InsightHealthScore | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    apiInsightHealthScore().then((d) => alive && setData(d)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  if (failed) {
    return (
      <div className="rounded-xl bg-white p-5 text-sm text-slate-400 ring-1 ring-slate-100">
        经营健康度暂不可用（趋势服务未接入或数据未就绪）
      </div>
    );
  }
  if (!data) {
    return (
      <div className="rounded-xl bg-white p-5 text-sm text-slate-400 ring-1 ring-slate-100">
        经营健康度加载中…
      </div>
    );
  }
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-slate-100">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-slate-900">经营健康度</h3>
        <span className="text-[11px] text-slate-400">截至 {data.as_of}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {data.rings.map((r) => <RingCell key={r.key} r={r} />)}
      </div>
      {data.target && (
        <div className="mt-4 rounded-lg bg-slate-50 p-3">
          <div className="text-xs text-slate-500">{data.target.year} 年目标进度</div>
          <div className="mt-1 flex items-center gap-3">
            <div className="relative">
              <Ring value={data.target.achieve_pct} color="#2563eb" />
              <div className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold text-slate-800">
                {data.target.achieve_pct}%
              </div>
            </div>
            <div className="text-[11px] leading-relaxed text-slate-500">
              <div>实际 {data.target.actual_wan.toLocaleString()} 万</div>
              <div>年度目标 {data.target.annual_target_wan.toLocaleString()} 万</div>
              <div>时间进度 {data.target.time_pct}%</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
