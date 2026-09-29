import { useState } from "react";

export default function ImpactEntityTable({ entities }: { entities: Array<{ name: string; type: string; delta: string }> }) {
  const [showAll, setShowAll] = useState(false);
  if (!entities.length) return <div className="p-4 text-sm text-slate-400">重点影响对象待归因生成</div>;
  const rows = showAll ? entities : entities.slice(0, 5);
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-400">
            <th className="pb-2">名称</th><th className="pb-2">类型</th><th className="pb-2 text-right">变动</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((e) => (
            <tr key={e.name}>
              <td className="py-2 text-slate-800">{e.name}</td>
              <td className="py-2 text-slate-500">{e.type}</td>
              <td className={`py-2 text-right ${e.delta.trim().startsWith("-") ? "text-red-500" : "text-slate-700"}`}>{e.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {entities.length > 5 && (
        <button className="mt-2 text-xs text-blue-600 hover:underline" onClick={() => setShowAll(!showAll)}>
          {showAll ? "收起" : `查看更多（共 ${entities.length}）`}
        </button>
      )}
    </div>
  );
}
