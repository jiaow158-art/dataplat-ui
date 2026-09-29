// v1：API suggestedActions 恒空数组 → 占位说明；决策辅助区与事实区视觉区隔=浅灰底+「决策辅助」标注。
export default function SuggestedActionsPanel({ actions }: { actions: string[] }) {
  return (
    <div className="rounded-xl bg-slate-100 p-5 ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-slate-700">AI 建议动作</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-400">决策辅助 · 仅供参考</span>
      </div>
      {actions.length ? (
        <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-slate-600">
          {actions.map((a, i) => <li key={i}>{a}</li>)}
        </ol>
      ) : (
        <p className="mt-3 text-sm text-slate-400">归因完成后可生成建议（当前版本仅呈现事实与归因，不自动派发任务）</p>
      )}
    </div>
  );
}
