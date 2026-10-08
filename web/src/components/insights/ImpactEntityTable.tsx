// ED-1 L6 相关影响对象（修正3：entities.delta 为富文本、无独立数值列——不可靠计算贡献排名，
// 故不得冒充「Top5」：按归因报告原始顺序展示前五并可展开，标题与脚注如实说明排序依据）。
import { useState } from "react";

export default function ImpactEntityTable({ entities }: { entities: Array<{ name: string; type: string; delta: string }> }) {
  const [showAll, setShowAll] = useState(false);
  if (!entities.length) return <div className="text-sm text-ck-ink-3">归因报告未提供结构化影响对象——可通过下方「让 AI 继续分析」获取明细。</div>;
  const rows = showAll ? entities : entities.slice(0, 5);
  return (
    <div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-ck-ink-3">
            <th className="pb-2">名称</th><th className="pb-2">类型</th><th className="pb-2 text-right">变动（归因原文）</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-ck-line">
          {rows.map((e) => (
            <tr key={e.name}>
              <td className="py-2 text-ck-ink">{e.name}</td>
              <td className="py-2 text-ck-ink-3">{e.type}</td>
              <td className={`py-2 text-right ${e.delta.trim().startsWith("-") ? "text-ck-danger" : "text-ck-ink"}`}>{e.delta}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-[11px] text-ck-ink-3">按归因报告原始顺序排列（非贡献排名）</span>
        {entities.length > 5 && (
          <button type="button" className="shrink-0 text-xs text-ck-primary hover:underline" onClick={() => setShowAll(!showAll)}>
            {showAll ? "收起" : `展开全部（共 ${entities.length}）`}
          </button>
        )}
      </div>
    </div>
  );
}
