import type { InsightDaily } from "../../types";

export default function TodayAttentionHeader({ daily }: { daily: InsightDaily | null }) {
  const major = daily?.events.filter((e) => e.severity === "major").length ?? 0;
  const minor = daily?.events.filter((e) => e.severity === "minor").length ?? 0;
  const gap = daily?.events.filter((e) => e.eventType === "target_gap").length ?? 0;
  return (
    <div className="px-8 pt-8 pb-4">
      <h1 className="text-xl font-semibold text-slate-900">今日经营关注</h1>
      <p className="mt-1 text-sm text-slate-500">
        {daily
          ? daily.dataFreshness.overall === "not_ready"
            ? "数据未就绪——今日简报未定稿，不代表无异常"
            : `截至 ${daily.briefDate}，发现 ${daily.eventCount} 件值得关注的经营事项${daily.stale ? "（当前为最近一期已发布简报）" : ""}`
          : "加载中…"}
      </p>
      <div className="mt-3 flex gap-2 text-xs">
        <span className="rounded-full bg-red-50 px-3 py-1 text-red-600">重大异常 {major}</span>
        <span className="rounded-full bg-orange-50 px-3 py-1 text-orange-500">一般异常 {minor}</span>
        <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-600">目标偏差 {gap}</span>
      </div>
    </div>
  );
}
