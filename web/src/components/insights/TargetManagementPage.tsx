// M-i7 目标管理页（spec 2026-10-02 §4；P0-T5 改版）：年度目标环 / 进度与缺口（P4 事实卡，
// 未验证预测值全禁，types.ts 载荷字段留而未读）/ 月度达成表 / 组织缺口拆解（外推列已删，
// API payload 不动仅 UI 停渲染）。口径全在服务端（公式随响应下发，本页零计算——P4 两指标
// 为载荷值的确定性算术，非预测）；纯只读页——followup 是事件编排（/events/:id/followup 需
// 宿主事件 id），本页无宿主事件故不设追问入口（计划 Task 4 修正：追问在经营事件中心对
// 目标类事件点「继续分析」）。
import { useEffect, useState } from "react";
import { apiInsightTargetOverview } from "../../api";
import type { TargetAnnual, TargetDegraded, TargetOverview } from "../../types";
import AppShell from "../cockpit/AppShell";
import PageHeader from "../cockpit/PageHeader";
import SectionCard from "../cockpit/SectionCard";
import Ring from "../cockpit/Ring";
import DegradedLine from "../cockpit/DegradedLine";

const isDegraded = (x: TargetOverview["annual"] | TargetOverview["months"] | TargetOverview["centers"]): x is TargetDegraded =>
  !Array.isArray(x) && typeof x === "object" && x !== null && (x as TargetDegraded).available === false;

const fmtWan = (n: number | null) => (n == null ? "—" : n.toLocaleString());
const fmtPct = (n: number | null) => (n == null ? "—" : `${n}%`);

/** P4 事实卡（占原预测卡槽位）：只做载荷值的确定性算术——进度偏差=达成率−时间进度、
 *  当前目标缺口=年度目标−实际完成；缺口≤0（实绩已超目标）显示"超额完成 |缺口|"，不渲染负数缺口。 */
function GapFacts({ annual }: { annual: TargetAnnual }) {
  const devPct = annual.achievePct - annual.timePct;
  const gapWan = annual.targetWan - annual.actualWan;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-xs text-ck-ink-3">进度偏差</div>
        <div className={`mt-1 text-2xl font-semibold ${devPct >= 0 ? "text-ck-success" : "text-ck-danger"}`}>
          {devPct >= 0 ? "+" : ""}{devPct.toFixed(1)}pt
        </div>
        <div className="mt-1 text-[10px] text-ck-ink-3">达成率 − 时间进度</div>
      </div>
      <div>
        <div className="text-xs text-ck-ink-3">当前目标缺口</div>
        <div className={`mt-1 text-2xl font-semibold ${gapWan > 0 ? "text-ck-danger" : "text-ck-success"}`}>
          {gapWan > 0 ? `缺口 ${gapWan.toLocaleString()} 万` : `超额完成 ${Math.abs(gapWan).toLocaleString()} 万`}
        </div>
      </div>
    </div>
  );
}

export default function TargetManagementPage() {
  const [data, setData] = useState<TargetOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    apiInsightTargetOverview().then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  if (err && !data)
    return (
      <AppShell>
        <div className="text-sm text-ck-ink-2">
          目标管理暂不可用。
          <br />
          <span className="text-xs text-ck-ink-3">{err}</span>
        </div>
      </AppShell>
    );
  return (
    <AppShell>
      <PageHeader title="目标管理" subtitle={data ? `${data.year} 年 · 数据日 ${data.asOf}` : "加载中…"} />
      {!data ? (
        <div className="py-6 text-sm text-ck-ink-3">加载中…</div>
      ) : (
        <>
          <div className="grid gap-5 md:grid-cols-2">
            <SectionCard title="年度目标进度">
              {isDegraded(data.annual) ? (
                <DegradedLine reason={data.annual.reason} />
              ) : (
                <div className="flex items-center gap-6">
                  <Ring value={data.annual.achievePct} className="h-28 w-28 shrink-0">
                    <div className="flex flex-col items-center justify-center">
                      <span className="text-2xl font-semibold text-ck-ink">{data.annual.achievePct}%</span>
                      <span className="text-[10px] text-ck-ink-3">达成率</span>
                    </div>
                  </Ring>
                  <div className="text-xs leading-relaxed text-ck-ink-2">
                    <div>
                      实际 <span className="font-medium text-ck-ink">{data.annual.actualWan.toLocaleString()} 万</span>
                    </div>
                    <div>
                      年度目标 <span className="font-medium text-ck-ink">{data.annual.targetWan.toLocaleString()} 万</span>
                    </div>
                    <div>
                      时间进度 <span className="font-medium text-ck-ink">{data.annual.timePct}%</span>
                    </div>
                    <div className="mt-1.5 text-[10px] text-ck-ink-3">{data.annual.timeBasis}</div>
                  </div>
                </div>
              )}
            </SectionCard>
            <SectionCard title="进度与缺口">
              {isDegraded(data.annual) ? <DegradedLine reason={data.annual.reason} /> : <GapFacts annual={data.annual} />}
            </SectionCard>
          </div>

          <SectionCard padding="none" title="月度达成">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-ck-line text-left text-ck-ink-3">
                  {["月份", "实际（万）", "目标（万）", "达成率", "同比", "状态"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isDegraded(data.months) ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-xs text-ck-ink-3">{data.months.reason}</td>
                  </tr>
                ) : data.months.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-ck-ink-3">暂无目标数据</td>
                  </tr>
                ) : (
                  data.months.map((m) => (
                    <tr key={m.month} className={`border-b border-ck-line/60 last:border-0 ${m.isCurrent ? "bg-ck-primary-soft/40" : ""}`}>
                      <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">{Number(m.month.slice(5))} 月</td>
                      <td className="whitespace-nowrap px-4 py-2 text-ck-ink">{fmtWan(m.actualWan)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">{fmtWan(m.targetWan)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">{fmtPct(m.achievePct)}</td>
                      <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">
                        {m.yoyPct == null ? "—" : `${m.yoyPct > 0 ? "+" : ""}${m.yoyPct}%`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        {m.isCurrent ? (
                          <span className="text-ck-primary">
                            进行中
                            {m.timePct != null && <span className="ml-1.5 text-[10px] text-ck-ink-3">时间进度 {m.timePct}%</span>}
                          </span>
                        ) : (
                          <span className="text-ck-ink-3">完成</span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </SectionCard>

          <SectionCard padding="none" title="组织缺口拆解">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-ck-line text-left text-ck-ink-3">
                  {["中心", "实际（万）", "目标（万）", "达成率", "时间进度", "欠进度额（万）"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {isDegraded(data.centers) ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-6 text-xs text-ck-ink-3">{data.centers.reason}</td>
                  </tr>
                ) : data.centers.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-ck-ink-3">暂无目标数据</td>
                  </tr>
                ) : (
                  <>
                    <tr className="border-b border-ck-line bg-ck-card-soft text-ck-ink-2">
                      <td colSpan={5} className="px-4 py-1.5 text-right">欠进度合计</td>
                      <td className="whitespace-nowrap px-4 py-1.5 font-medium">
                        {data.centersTotalBehindWan == null ? (
                          "—"
                        ) : (
                          <span className="text-ck-danger">{data.centersTotalBehindWan.toLocaleString()} 万</span>
                        )}
                      </td>
                    </tr>
                    {data.centers.map((c) => (
                      <tr key={c.centerCode} className="border-b border-ck-line/60 last:border-0 hover:bg-ck-card-soft">
                        <td className="max-w-44 truncate px-4 py-2.5 font-medium text-ck-ink" title={c.centerName ?? c.centerCode}>
                          {c.centerName ?? c.centerCode}
                        </td>
                        <td className="whitespace-nowrap px-4 py-2 text-ck-ink">{c.actualWan.toLocaleString()}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">{c.targetWan.toLocaleString()}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">{fmtPct(c.achievePct)}</td>
                        <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">{c.timePct}%</td>
                        <td className="whitespace-nowrap px-4 py-2">
                          {c.behindWan > 0 ? (
                            <span className="text-ck-danger">+{c.behindWan.toLocaleString()}</span>
                          ) : c.behindWan < 0 ? (
                            <span className="text-ck-success">超前 {Math.abs(c.behindWan).toLocaleString()}</span>
                          ) : (
                            <span className="text-ck-ink-3">0</span>
                          )}
                          {/* 行内水平条：宽=behindSharePct%（占比分母只计落后者，服务端口径） */}
                          <div className="mt-1 h-1.5 w-24 rounded bg-ck-card-soft">
                            <div
                              className="h-1.5 rounded bg-red-500"
                              style={{ width: `${Math.min(Math.max(c.behindSharePct, 0), 100)}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </SectionCard>
        </>
      )}
    </AppShell>
  );
}
