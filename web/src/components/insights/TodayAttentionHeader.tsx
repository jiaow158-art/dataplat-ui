import type { InsightDaily } from "../../types";

export default function TodayAttentionHeader({
  daily, watching,
}: { daily: InsightDaily | null; watching: number }) {
  const major = daily?.events.filter((e) => e.severity === "major").length ?? 0;
  const minor = daily?.events.filter((e) => e.severity === "minor").length ?? 0;
  return (
    <div className="dashboard-enter px-4 pb-5 pt-6 sm:px-6 lg:px-8 lg:pt-8">
      <div className="dashboard-glass rounded-2xl px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-[#10294b]">今日经营关注</h1>
        {daily?.dataDate && (
          <span className="text-xs text-slate-400">
            数据更新：{daily.briefDate} 简报 · 数据日 {daily.dataDate}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-slate-500">
        {daily
          ? daily.dataFreshness.overall === "not_ready"
            ? "数据未就绪——今日简报未定稿，不代表无异常"
            : `截至 ${daily.briefDate}，发现 ${daily.eventCount} 件值得关注的经营事项${daily.stale ? "（当前为最近一期已发布简报）" : ""}`
          : "加载中…"}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-[#fff0ef] px-3 py-1.5 font-medium text-[#d64b4b]">重大异常 {major}</span>
        <span className="rounded-full bg-[#fff5e8] px-3 py-1.5 font-medium text-[#b87316]">一般异常 {minor}</span>
        <span className="rounded-full bg-[#eaf2fb] px-3 py-1.5 font-medium text-[#55708f]">观察中 {watching}</span>
      </div>
      </div>
    </div>
  );
}
