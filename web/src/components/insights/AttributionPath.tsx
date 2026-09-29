export default function AttributionPath({ path }: { path: Array<{ level: string; contribution: string }> }) {
  if (!path.length) return <div className="p-4 text-sm text-slate-400">归因路径待生成</div>;
  return (
    <ol className="space-y-2">
      {path.map((p, i) => (
        <li key={`${p.level}-${i}`} className="flex items-center gap-3 text-sm">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-xs text-blue-600">{i + 1}</span>
          <span className="font-medium text-slate-800">{p.level}</span>
          <span className="text-slate-500">贡献 {p.contribution}</span>
        </li>
      ))}
    </ol>
  );
}
