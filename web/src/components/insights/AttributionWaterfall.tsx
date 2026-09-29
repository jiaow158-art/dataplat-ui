export default function AttributionWaterfall({ waterfall }: { waterfall: Array<{ name: string; value: number }> }) {
  if (waterfall.length < 2) return <div className="p-4 text-sm text-slate-400">瀑布图待归因生成</div>;
  const max = Math.max(...waterfall.map((w) => Math.abs(w.value)));
  return (
    <div className="space-y-1.5">
      {waterfall.map((w, i) => {
        const pct = Math.round((Math.abs(w.value) / max) * 100);
        const negative = w.value < 0;
        const isEnd = i === waterfall.length - 1;
        return (
          <div key={`${w.name}-${i}`} className="flex items-center gap-3 text-xs">
            <span className="w-24 shrink-0 truncate text-slate-600" title={w.name}>{w.name}</span>
            <div className="h-4 flex-1 rounded bg-slate-100">
              <div
                className={`h-4 rounded ${isEnd ? "bg-blue-500" : negative ? "bg-red-400" : "bg-emerald-400"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`w-20 shrink-0 text-right ${negative ? "text-red-500" : "text-slate-700"}`}>
              {w.value.toLocaleString("zh-CN")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
