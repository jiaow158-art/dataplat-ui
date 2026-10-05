// M-i7 目标管理页（spec 2026-10-02 §4）：年度目标环 / 线性年化外推 / 月度达成表 / 组织欠进度拆解。
// 口径全在服务端（公式随响应下发，本页零计算）；纯只读页——followup 是事件编排
// （/events/:id/followup 需宿主事件 id），本页无宿主事件故不设追问入口（计划 Task 4 修正：
// 追问在经营事件中心对目标类事件点「继续分析」）。
import { useEffect, useState } from "react";
import { apiInsightTargetOverview } from "../../api";
import type { TargetDegraded, TargetOverview } from "../../types";

/** 进度环（HealthPanel Ring 同款纯 SVG——未导出私有组件，此处同形态复制一份）。 */
function Ring({ value, color, className = "h-16 w-16" }: { value: number; color: string; className?: string }) {
  const r = 26, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 64 64" className={className}>
      <circle cx="32" cy="32" r={r} fill="none" stroke="#e2e8f0" strokeWidth="6" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="6"
        strokeDasharray={`${(c * Math.min(Math.max(value, 0), 100)) / 100} ${c}`}
        strokeLinecap="round" transform="rotate(-90 32 32)" />
    </svg>
  );
}

/** 局部降级块（spec §3：坏块 {available:false, reason} 灰底一行，不造数）。 */
function DegradedLine({ d }: { d: TargetDegraded }) {
  return <div className="rounded-lg bg-slate-50 px-3 py-5 text-xs text-slate-400">{d.reason}</div>;
}

const isDegraded = (x: TargetOverview["annual"] | TargetOverview["months"] | TargetOverview["centers"]): x is TargetDegraded =>
  !Array.isArray(x) && typeof x === "object" && x !== null && (x as TargetDegraded).available === false;

const fmtWan = (n: number | null) => (n == null ? "—" : n.toLocaleString());
const fmtPct = (n: number | null) => (n == null ? "—" : `${n}%`);

export default function TargetManagementPage() {
  const [data, setData] = useState<TargetOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiInsightTargetOverview().then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  if (err && !data)
    return (
      <div className="p-8 text-sm text-slate-500">
        目标管理暂不可用。<br />
        <span className="text-xs text-slate-400">{err}</span>
      </div>
    );
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="flex items-baseline justify-between px-8 pb-4 pt-8">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">目标管理</h1>
          <p className="mt-1 text-sm text-slate-500">{data ? `${data.year} 年 · 数据日 ${data.asOf}` : "加载中…"}</p>
        </div>
      </div>
      {!data ? (
        <div className="px-8 py-6 text-sm text-slate-400">加载中…</div>
      ) : (
        <>
          <div className="grid gap-3 px-8 md:grid-cols-2">
            <div className="rounded-xl bg-white p-5 ring-1 ring-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">年度目标进度</h3>
              <div className="mt-3">
                {isDegraded(data.annual) ? (
                  <DegradedLine d={data.annual} />
                ) : (
                  <div className="flex items-center gap-6">
                    <div className="relative shrink-0">
                      <Ring value={data.annual.achievePct} color="#2563eb" className="h-28 w-28" />
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-2xl font-semibold text-slate-900">{data.annual.achievePct}%</span>
                        <span className="text-[10px] text-slate-400">达成率</span>
                      </div>
                    </div>
                    <div className="text-xs leading-relaxed text-slate-500">
                      <div>
                        实际 <span className="font-medium text-slate-800">{data.annual.actualWan.toLocaleString()} 万</span>
                      </div>
                      <div>
                        年度目标 <span className="font-medium text-slate-800">{data.annual.targetWan.toLocaleString()} 万</span>
                      </div>
                      <div>
                        时间进度 <span className="font-medium text-slate-800">{data.annual.timePct}%</span>
                      </div>
                      <div className="mt-1.5 text-[10px] text-slate-400">{data.annual.timeBasis}</div>
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="rounded-xl bg-white p-5 ring-1 ring-slate-100">
              <h3 className="text-sm font-semibold text-slate-900">趋势外推</h3>
              <div className="mt-3">
                {data.projection == null ? (
                  <div className="rounded-lg bg-slate-50 px-3 py-5 text-xs text-slate-400">外推不可用（年度目标数据未就绪）</div>
                ) : (
                  <div>
                    <div className="text-2xl font-semibold text-slate-900">
                      预计完成 {data.projection.projectedWan.toLocaleString()} 万
                    </div>
                    {data.projection.projectedGapWan < 0 ? (
                      <div className="mt-1 text-sm text-emerald-600">
                        预计超额 {Math.abs(data.projection.projectedGapWan).toLocaleString()} 万
                      </div>
                    ) : (
                      <div className="mt-1 text-sm text-red-500">
                        预计缺口 {data.projection.projectedGapWan.toLocaleString()} 万
                      </div>
                    )}
                    <div className="mt-2 text-[11px] text-slate-400">{data.projection.basis}</div>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="mx-8 mt-4 rounded-xl bg-white ring-1 ring-slate-100">
            <h3 className="px-4 pt-4 text-sm font-semibold text-slate-900">月度达成</h3>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  {["月份", "实际（万）", "目标（万）", "达成率", "同比", "状态"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isDegraded(data.months) ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-xs text-slate-400">{data.months.reason}</td>
                  </tr>
                ) : data.months.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-300">暂无目标数据</td>
                  </tr>
                ) : (
                  data.months.map((m) => (
                    <tr key={m.month} className={`border-b border-slate-50 last:border-0 ${m.isCurrent ? "bg-blue-50/40" : ""}`}>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-500">{Number(m.month.slice(5))} 月</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-800">{fmtWan(m.actualWan)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmtWan(m.targetWan)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmtPct(m.achievePct)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {m.yoyPct == null ? "—" : `${m.yoyPct > 0 ? "+" : ""}${m.yoyPct}%`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {m.isCurrent ? (
                          <span className="text-blue-600">
                            进行中
                            {m.timePct != null && <span className="ml-1.5 text-[10px] text-slate-400">时间进度 {m.timePct}%</span>}
                          </span>
                        ) : (
                          <span className="text-slate-400">完成</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="mx-8 mt-4 rounded-xl bg-white ring-1 ring-slate-100">
            <h3 className="px-4 pt-4 text-sm font-semibold text-slate-900">组织缺口拆解</h3>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  {["中心", "实际（万）", "目标（万）", "达成率", "时间进度", "欠进度额（万）", "恢复潜力（万）"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isDegraded(data.centers) ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-6 text-xs text-slate-400">{data.centers.reason}</td>
                  </tr>
                ) : data.centers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-10 text-center text-slate-300">暂无目标数据</td>
                  </tr>
                ) : (
                  <>
                    <tr className="border-b border-slate-100 bg-slate-50/60 text-slate-500">
                      <td colSpan={5} className="px-4 py-1.5 text-right">欠进度合计</td>
                      <td className="whitespace-nowrap px-4 py-1.5 font-medium">
                        {data.centersTotalBehindWan == null ? (
                          "—"
                        ) : (
                          <span className="text-red-500">{data.centersTotalBehindWan.toLocaleString()} 万</span>
                        )}
                      </td>
                      <td />
                    </tr>
                    {data.centers.map((c) => (
                      <tr key={c.centerCode} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/60">
                        <td className="max-w-44 truncate px-4 py-2.5 font-medium text-slate-800" title={c.centerName ?? c.centerCode}>
                          {c.centerName ?? c.centerCode}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-800">{c.actualWan.toLocaleString()}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{c.targetWan.toLocaleString()}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{fmtPct(c.achievePct)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-slate-600">{c.timePct}%</td>
                        <td className="whitespace-nowrap px-4 py-2">
                          {c.behindWan > 0 ? (
                            <span className="text-red-500">+{c.behindWan.toLocaleString()}</span>
                          ) : c.behindWan < 0 ? (
                            <span className="text-emerald-600">超前 {Math.abs(c.behindWan).toLocaleString()}</span>
                          ) : (
                            <span className="text-slate-400">0</span>
                          )}
                          {/* 行内水平条：宽=behindSharePct%（占比分母只计落后者，服务端口径） */}
                          <div className="mt-1 h-1.5 w-24 rounded bg-slate-100">
                            <div
                              className="h-1.5 rounded bg-red-500"
                              style={{ width: `${Math.min(Math.max(c.behindSharePct, 0), 100)}%` }}
                            />
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-4 py-2">
                          {c.recoveryWan > 0 ? (
                            <span className="text-emerald-600">{c.recoveryWan.toLocaleString()}</span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="pb-8" />
    </div>
  );
}
