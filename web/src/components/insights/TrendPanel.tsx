// v1 占位禁用态：趋势序列 API 未建（M-i2 未含 detector 时间序列），下版本接入——显式裁剪非隐藏 TBD。
export default function TrendPanel() {
  return (
    <div className="rounded-xl bg-white p-6 ring-1 ring-slate-100">
      <h3 className="text-sm font-semibold text-slate-900">趋势变化</h3>
      <div className="mt-3 rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-400">
        趋势序列下版本接入（当前版本提供归因瀑布与影响对象）
      </div>
    </div>
  );
}
