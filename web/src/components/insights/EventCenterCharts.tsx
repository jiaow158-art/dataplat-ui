// M-i6 事件中心右栏图表：30 天新发三线 + 通用环图（类型 4 段 / 生命周期 2 段）。
// 纯 SVG（MiniTrendChart/HealthPanel 同路线）。数据口径全在服务端，这里只画。
import type { EventCenterDist, EventCenterTrendPoint } from "../../types";

// 默认色板=蓝系深浅+中性灰：类型分布是分类不是严重度，不带红/橙/绿语义色；
// 生命周期环由调用方传 palette（进行中蓝/已解除绿，对齐表格列色，绿=已解除）。
const DONUT_COLORS = ["#2563eb", "#3b82f6", "#60a5fa", "#93c5fd", "#94a3b8"];

export function EventTrendCard({ points }: { points: EventCenterTrendPoint[] }) {
  const W = 260, H = 130, PAD = 8;
  const n = points.length;
  const hi = Math.max(2, ...points.map((p) => p.total));
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / Math.max(n - 1, 1);
  const y = (v: number) => PAD + (1 - v / hi) * (H - 2 * PAD - 10);
  const line = (key: "total" | "major" | "minor") =>
    points.map((p, i) => `${x(i)},${y(p[key])}`).join(" ");
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-slate-100">
      <h3 className="text-sm font-semibold text-slate-900">事件趋势（近 30 天）</h3>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full" role="img" aria-label="事件趋势">
        <polyline fill="none" stroke="#93c5fd" strokeWidth="2" points={line("minor")} />
        <polyline fill="none" stroke="#f97316" strokeWidth="1.5" points={line("major")} />
        <polyline fill="none" stroke="#2563eb" strokeWidth="2" points={line("total")} />
      </svg>
      <div className="mt-1 flex gap-3 text-[11px] text-slate-400">
        <span><i className="mr-1 inline-block h-0.5 w-3 bg-blue-600" />全部</span>
        <span><i className="mr-1 inline-block h-0.5 w-3 bg-orange-500" />重大</span>
        <span><i className="mr-1 inline-block h-0.5 w-3 bg-blue-300" />一般</span>
      </div>
    </div>
  );
}

export function EventDonutCard({ title, items, total, palette }: { title: string; items: EventCenterDist[]; total: number; palette?: string[] }) {
  const colors = palette ?? DONUT_COLORS;
  const sum = items.reduce((s, i) => s + i.count, 0) || 1;
  let acc = 0;
  const R = 40, C = 2 * Math.PI * R;
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-slate-100">
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 flex items-center gap-4">
        <svg viewBox="0 0 100 100" className="h-28 w-28 shrink-0">
          {items.map((it, i) => {
            const frac = it.count / sum;
            const el = (
              <circle key={it.key} cx="50" cy="50" r={R} fill="none"
                stroke={colors[i % colors.length]} strokeWidth="14"
                strokeDasharray={`${C * frac} ${C}`} strokeDashoffset={-C * acc}
                transform="rotate(-90 50 50)" />
            );
            acc += frac;
            return el;
          })}
          <text x="50" y="48" textAnchor="middle" className="fill-slate-900" style={{ fontSize: 18, fontWeight: 600 }}>{total}</text>
          <text x="50" y="62" textAnchor="middle" className="fill-slate-400" style={{ fontSize: 8 }}>总事件数</text>
        </svg>
        <div className="flex min-w-0 flex-1 flex-col gap-1 text-[11px]">
          {items.map((it, i) => (
            <div key={it.key} className="flex items-center gap-1.5">
              <i className="h-2 w-2 shrink-0 rounded-sm" style={{ background: colors[i % colors.length] }} />
              <span className="truncate text-slate-600">{it.label}</span>
              <span className="ml-auto shrink-0 text-slate-400">{it.count}（{Math.round(it.count / sum * 100)}%）</span>
            </div>
          ))}
          {items.length === 0 && <span className="text-slate-300">暂无事件</span>}
        </div>
      </div>
    </div>
  );
}
