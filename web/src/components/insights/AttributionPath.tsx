// ED-1 L8（原样保留、收进默认折叠的完整分析路径）：L0-L4 下钻路径原文本改写零——仅 ck 化配色。
export default function AttributionPath({ path }: { path: Array<{ level: string; contribution: string }> }) {
  if (!path.length) return <div className="text-sm text-ck-ink-3">归因路径待生成</div>;
  return (
    <ol className="space-y-2">
      {path.map((p, i) => (
        <li key={`${p.level}-${i}`} className="flex items-baseline gap-3 text-sm">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ck-primary-soft text-xs text-ck-primary">{i + 1}</span>
          <div className="min-w-0">
            <span className="font-medium text-ck-ink">{p.level}</span>
            <span className="text-ck-ink-2"> —— {p.contribution}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
