// M-i5 事件状态流（D-c5 诚实映射）：发现→归因(三态)→持续→已解除。
import type { InsightEventDetail } from "../../types";

export default function StatusFlowCard({ d }: { d: InsightEventDetail }) {
  const attrState = d.attribution.status === "done" ? "归因完成"
    : d.attribution.status === "degraded" ? "归因降级"
    : d.attribution.status === "failed" ? "归因失败"
    : d.attribution.status === "running" ? "归因中" : "待归因";
  const nodes = [
    { label: "发现", sub: d.event.first_seen_date, on: true },
    { label: attrState, sub: d.attribution.generatedAt
        ? new Date(d.attribution.generatedAt * 1000).toLocaleDateString() : "", on: d.attribution.status !== "pending" },
    { label: `持续 ${d.event.persist_days} 天`, sub: "", on: d.event.lifecycle === "active" },
    { label: "已解除", sub: d.event.resolved_at ?? "", on: d.event.lifecycle === "resolved" },
  ];
  return (
    <div className="rounded-xl bg-white p-5 ring-1 ring-slate-100">
      <h3 className="text-sm font-semibold text-slate-900">事件状态</h3>
      <div className="mt-4 flex items-start">
        {nodes.map((n, i) => (
          <div key={n.label} className="flex flex-1 items-start last:flex-none">
            <div className="flex flex-col items-center">
              <span className={`h-3 w-3 rounded-full ${n.on ? "bg-blue-600" : "bg-slate-200"}`} />
              <span className={`mt-1 whitespace-nowrap text-[11px] ${n.on ? "text-slate-700" : "text-slate-300"}`}>{n.label}</span>
              {n.sub && <span className="text-[10px] text-slate-400">{n.sub}</span>}
            </div>
            {i < nodes.length - 1 && (
              <div className={`mx-1 mt-1.5 h-0.5 flex-1 ${n.on ? "bg-blue-200" : "bg-slate-100"}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
