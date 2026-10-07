// P1-3 目标管理产品化：目标经营入口五层——L1 KPI Strip（距年度目标，裁定1）/ L2 目标累计进度
// 同口径双线（当月目标点=月目标×月工作日进度，裁定2）/ L3 进度缺口贡献 Top5·组织维度（裁定3）/
// L4 相关经营事件（target_gap 真实事件，0 条如实显空，绝不前端造）/ L5 月度明细（当月差额=
// MTD 同口径进度差额，裁定4）。「让AI分析目标差距」只注真实值、annual 降级即禁用（裁定5）；
// 删 Ring/GapFacts/组织缺口拆解表；载荷中的预测类字段与同比列留而未读（零预测
// 红线：所有线止于当月，不延伸不补值）。
import { useEffect, useState } from "react";
import { apiInsightActiveEvents, apiInsightTargetOverview } from "../../api";
import type {
  InsightActiveEvent, TargetAnnual, TargetCenterRow, TargetDegraded, TargetMonthRow, TargetOverview,
} from "../../types";
import AppShell from "../cockpit/AppShell";
import PageHeader from "../cockpit/PageHeader";
import SectionCard from "../cockpit/SectionCard";
import KpiCard from "../cockpit/KpiCard";
import StatusTag, { type Tone } from "../cockpit/StatusTag";
import PrimaryButton from "../cockpit/PrimaryButton";
import DegradedLine from "../cockpit/DegradedLine";
import EmptyState from "../cockpit/EmptyState";
import { fmtWanSmart } from "./fmt";

const isDegraded = (x: TargetOverview["annual"] | TargetOverview["months"] | TargetOverview["centers"]): x is TargetDegraded =>
  !Array.isArray(x) && typeof x === "object" && x !== null && (x as TargetDegraded).available === false;

const fmtPct = (n: number | null) => (n == null ? "—" : `${n}%`);

// 事件状态文案/tone（小拷贝自 RegionBattleMapPage 同映射，避免跨页 import 耦合）
const LIFE_LABEL: Record<string, string> = { active: "进行中", resolved: "已解除" };
const ATTR_LABEL: Record<string, string> = { pending: "待分析", running: "分析中", done: "分析完成", degraded: "降级完成", failed: "分析失败" };
const ATTR_TONE: Record<string, Tone> = { pending: "neutral", running: "info", done: "success", degraded: "warning", failed: "danger" };

/** 「让AI分析目标差距」问句（裁定5：只注真实载荷值；不规定下钻维度——六步法自选）。 */
const buildQuestion = (annual: TargetAnnual, events: InsightActiveEvent[]) => {
  const gapWan = annual.targetWan - annual.actualWan;
  const ev = events.length ? ` 关联经营事件 event_id：${events.map((e) => e.event_id).join("、")}。` : "";
  return `请分析当前年度目标完成情况。当前实际完成 ${fmtWanSmart(annual.actualWan)}，年度目标 ${fmtWanSmart(annual.targetWan)}，达成率 ${annual.achievePct}%，时间进度 ${annual.timePct}%，距年度目标 ${fmtWanSmart(gapWan)}。请按照现有六步分析法，优先识别对目标缺口贡献最大的维度，再继续下钻分析主要影响因素。${ev}`;
};

/** L1 KPI Strip（裁定1）：第 5 卡进度偏差=达成率−时间进度（确定性算术，正绿负红）；
 *  第 6 卡距年度目标=targetWan−actualWan（>0 缺口/≤0 超额完成，P0 规则）——与 L2 终点
 *  「当前进度缺口」是两个口径的数，各自成立不互核对。 */
function KpiStrip({ annual }: { annual: TargetAnnual }) {
  const dev = annual.achievePct - annual.timePct;
  const gapWan = annual.targetWan - annual.actualWan;
  return (
    <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
      <KpiCard label="年度目标" value={fmtWanSmart(annual.targetWan)} />
      <KpiCard label="实际完成" value={fmtWanSmart(annual.actualWan)} />
      <KpiCard label="达成率" value={`${annual.achievePct}%`} />
      <KpiCard label="时间进度" value={`${annual.timePct}%`} sub={<span title={annual.timeBasis}>{annual.timeBasis}</span>} />
      <KpiCard
        label="进度偏差"
        value={`${dev >= 0 ? "+" : ""}${dev.toFixed(1)}pt`}
        valueClassName={dev >= 0 ? "text-ck-success" : "text-ck-danger"}
        sub="达成率 − 时间进度"
      />
      <KpiCard
        label="距年度目标"
        value={gapWan > 0 ? `缺口 ${fmtWanSmart(gapWan)}` : `超额完成 ${fmtWanSmart(Math.abs(gapWan))}`}
        valueClassName={gapWan > 0 ? "text-ck-danger" : "text-ck-success"}
        sub="年度目标 − 实际完成"
      />
    </div>
  );
}

/** L2 目标累计进度（裁定2 同口径）：累计目标=灰虚线（完整月整月目标 running Σ，当月点=
 *  月目标×月工作日进度%——MTD 同口径应完成额，不拿整月目标对 MTD 实际）；累计实际=蓝实线
 *  （当月=MTD）。终点标注「当前进度缺口」=双线共同末点差（与 KPI 距年度目标严格区分）。
 *  双线止于当月，零预测；null 目标/实际月各自断线（线止于前一月，null 不按 0 画）。 */
function CumulativeProgressCard({ months }: { months: TargetMonthRow[] | TargetDegraded }) {
  if (isDegraded(months)) return <SectionCard title="目标累计进度"><DegradedLine reason={months.reason} /></SectionCard>;

  const currentIdx = months.findIndex((m) => m.isCurrent);
  const currentRow = currentIdx >= 0 ? months[currentIdx] : undefined;
  // 目标序列断点：首个月目标为 null 的月（null 不按 0 画，目标线止于该月前一月）
  const targetBreakIdx = months.findIndex((m) => m.targetWan == null);
  // 当月纳入双线的条件：月工作日进度与月目标齐备，且目标序列未在当月之前断；
  // 缺任一 → 双线止于最近完整月 + 当月另起说明行（不补值）
  const currentIncluded =
    currentRow != null && currentRow.timePct != null && currentRow.targetWan != null &&
    (targetBreakIdx < 0 || targetBreakIdx >= currentIdx);

  let cumTarget = 0;
  let cumActual = 0;
  let targetLive = true; // null 目标月即断线：目标线止于该月前一月（同 actualLive 规则，null 不按 0 画）
  let actualLive = true; // null 实际月即断线：实际线止于该月前一月（后续月不续画）
  const pts: Array<{ label: string; target: number | null; actual: number | null }> = [];
  months.forEach((m, i) => {
    if (i === currentIdx && !currentIncluded) return;
    if (m.targetWan == null) targetLive = false;
    else if (targetLive) cumTarget += i === currentIdx ? m.targetWan * ((m.timePct ?? 0) / 100) : m.targetWan;
    if (m.actualWan == null) actualLive = false;
    else if (actualLive) cumActual += m.actualWan;
    pts.push({ label: `${Number(m.month.slice(5))}月`, target: targetLive ? cumTarget : null, actual: actualLive ? cumActual : null });
  });

  if (pts.length < 2) return <SectionCard title="目标累计进度"><EmptyState text="暂无历史目标序列" /></SectionCard>;

  const lastActualIdx = pts.reduce((acc, p, i) => (p.actual != null ? i : acc), -1);
  const lastTargetIdx = pts.reduce((acc, p, i) => (p.target != null ? i : acc), -1);
  // 末点差在两线共同末点取（同口径对比点）
  const endIdx = Math.min(lastTargetIdx, lastActualIdx);
  const gapEnd = endIdx >= 0 ? (pts[endIdx].target ?? 0) - (pts[endIdx].actual ?? 0) : null;
  const W = 640, H = 230, PL = 50, PR = 14, PT = 16, PB = 26;
  const maxV = Math.max(1, ...pts.map((p) => Math.max(p.target ?? 0, p.actual ?? 0)));
  const x = (i: number) => PL + (i * (W - PL - PR)) / (pts.length - 1);
  const y = (v: number) => PT + (1 - v / maxV) * (H - PT - PB);
  const annotateStart = lastActualIdx >= 0 && x(lastActualIdx) < W / 2; // 末点偏左 → 标注放右侧防溢出
  // 色带按段染色：段=相邻点区间，段色取区间右端点（累计目标−累计实际）的符号——实际低于目标
  // 红染 / 反超绿染；符号变化处分段，同号相邻段合一个 polygon（相邻段在交叉点相接）。
  const bandSegs: Array<{ from: number; to: number; fill: string }> = [];
  for (let i = 1; i <= endIdx; i++) {
    const d = (pts[i].target ?? 0) - (pts[i].actual ?? 0); // 段右端点差（段内两端必非 null，?? 0 仅为类型收窄）
    const fill = d > 0 ? "rgba(214,75,75,0.08)" : "rgba(14,159,110,0.08)";
    const prev = bandSegs[bandSegs.length - 1];
    if (prev != null && prev.fill === fill && prev.to === i - 1) prev.to = i;
    else bandSegs.push({ from: i - 1, to: i, fill });
  }

  return (
    <SectionCard title="目标累计进度">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="目标累计进度双线图">
        {[0, maxV / 2, maxV].map((v) => (
          <g key={v}>
            <line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} stroke="#f1f5f9" strokeWidth={1} />
            {/* 基线 0 只显「0」（fmtWanSmart(0)="0 万"会带单位）——仅轴标签特例，不改公共 fmt */}
            <text x={PL - 4} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#94a3b8">{v === 0 ? "0" : fmtWanSmart(v)}</text>
          </g>
        ))}
        {pts.map((p, i) => (
          <text key={p.label} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="#94a3b8">{p.label}</text>
        ))}
        {bandSegs.map((s, k) => (
          <polygon
            key={k}
            points={[
              ...pts.slice(s.from, s.to + 1).map((p, i) => `${x(i + s.from).toFixed(1)},${y(p.target ?? 0).toFixed(1)}`),
              ...pts.slice(s.from, s.to + 1).map((p, i) => `${x(i + s.from).toFixed(1)},${y(p.actual ?? 0).toFixed(1)}`).reverse(),
            ].join(" ")}
            fill={s.fill}
          />
        ))}
        {lastTargetIdx >= 1 && (
          <polyline
            points={pts.slice(0, lastTargetIdx + 1).map((p, i) => `${x(i).toFixed(1)},${y(p.target ?? 0).toFixed(1)}`).join(" ")}
            fill="none" stroke="#94a3b8" strokeWidth={1.6} strokeDasharray="4 3"
          />
        )}
        {lastActualIdx >= 1 && (
          <polyline
            points={pts.slice(0, lastActualIdx + 1).map((p, i) => `${x(i).toFixed(1)},${y(p.actual ?? 0).toFixed(1)}`).join(" ")}
            fill="none" stroke="#1667d9" strokeWidth={2}
          />
        )}
        {lastActualIdx >= 0 && gapEnd != null && (
          <>
            <circle cx={x(lastActualIdx)} cy={y(pts[lastActualIdx].actual ?? 0)} r={3} fill="#1667d9" />
            <text
              x={annotateStart ? x(lastActualIdx) + 7 : x(lastActualIdx) - 7}
              y={Math.max(y(pts[lastActualIdx].actual ?? 0) - 10, PT + 10)}
              textAnchor={annotateStart ? "start" : "end"} fontSize={11} fontWeight={600}
              fill={gapEnd > 0 ? "#d64b4b" : "#0e9f6e"} stroke="#fff" strokeWidth={3} paintOrder="stroke"
            >
              {gapEnd > 0 ? `当前进度缺口 ${fmtWanSmart(gapEnd)}` : `当前进度超前 ${fmtWanSmart(Math.abs(gapEnd))}`}
            </text>
          </>
        )}
      </svg>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ck-ink-2">
        <span className="flex items-center gap-1.5">
          <i className="h-0 w-4 border-t-2 border-dashed" style={{ borderColor: "#94a3b8" }} />
          累计目标（完整月整月 · 当月按月工作日进度）
        </span>
        <span className="flex items-center gap-1.5">
          <i className="h-0.5 w-4 rounded-full" style={{ background: "#1667d9" }} />
          累计实际（当月 MTD）
        </span>
      </div>
      {currentRow && !currentIncluded && (
        <div className="mt-1 text-[11px] text-ck-ink-3">
          {currentRow.timePct == null
            ? `当月（MTD 实际 ${fmtWanSmart(currentRow.actualWan)}）未接入月度时间进度，未纳入双线`
            : `月度目标序列自 ${targetBreakIdx + 1} 月起缺失，当月（MTD 实际 ${fmtWanSmart(currentRow.actualWan)}）未纳入双线`}
        </div>
      )}
    </SectionCard>
  );
}

/** L3 进度缺口贡献 Top 5（裁定3）：直接用服务端 behindWan（目标×年日进度% − 实绩，载荷已按
 *  behindWan 降序）取前五横条；不做 target−actual 客户端排序——那是 KPI「距年度目标」口径，
 *  两口径不混。behindWan≤0 为超前中心，不入榜只计数。 */
function BehindTopCard({ centers, totalBehindWan }: { centers: TargetCenterRow[] | TargetDegraded; totalBehindWan: number | null }) {
  if (isDegraded(centers)) return <SectionCard title="进度缺口贡献 Top 5"><DegradedLine reason={centers.reason} /></SectionCard>;
  const behind = centers.filter((c) => c.behindWan > 0);
  // 严格 <0 才计超前（=0 是持平：既不入榜也不算超前）
  const aheadCount = centers.filter((c) => c.behindWan < 0).length;
  return (
    <SectionCard
      title="进度缺口贡献 Top 5"
      extra={<span>合计 {totalBehindWan == null ? "—" : fmtWanSmart(totalBehindWan)}</span>}
    >
      {behind.length === 0 ? (
        <EmptyState text="暂无进度落后中心" />
      ) : (
        behind.slice(0, 5).map((c) => (
          <div key={c.centerCode} className="flex items-center gap-3 py-1.5">
            <span className="w-28 shrink-0 truncate text-xs font-medium text-ck-ink" title={c.centerName ?? c.centerCode}>
              {c.centerName ?? c.centerCode}
            </span>
            <div className="h-3.5 min-w-0 flex-1 rounded-sm bg-ck-card-soft">
              {/* 条宽=behindSharePct%（落后者占比分母，服务端口径），上限 100 */}
              <div className="h-3.5 rounded-sm bg-ck-danger" style={{ width: `${Math.min(Math.max(c.behindSharePct, 0), 100)}%` }} />
            </div>
            <span className="w-20 shrink-0 text-right text-xs font-medium text-ck-danger">{fmtWanSmart(c.behindWan)}</span>
          </div>
        ))
      )}
      {aheadCount > 0 && <div className="mt-1 text-xs text-ck-ink-3">另有 {aheadCount} 个中心进度超前</div>}
      <p
        className="mt-1.5 text-xs text-ck-ink-3"
        title="behindWan = 目标 × 年日进度% − 实绩（服务端计算，年日自然日口径）；目标主数据暂只有组织（运营中心）维度"
      >
        口径：目标 × 年日进度 − 实绩 · 组织维度（区域/渠道/产品维度目标未接入）
      </p>
    </SectionCard>
  );
}

/** L4 相关经营事件：active 事件客户端过滤 event_type==="target_gap"（真实事件），≤3 条；
 *  0 条如实显空——绝不前端造事件；拉取失败 ≠ 无事件 → err 标记单独显「暂不可用」（events=null 拉取中）。 */
function TargetEventsCard({ events, err, onOpenEvent }: {
  events: InsightActiveEvent[] | null;
  err: boolean;
  onOpenEvent: (id: string) => void;
}) {
  return (
    <SectionCard title="相关经营事件" extra={events != null ? `${events.length} 条` : null}>
      {err ? (
        <div className="py-6 text-center text-xs text-ck-ink-3">事件数据暂不可用</div>
      ) : events == null ? (
        <div className="py-6 text-center text-xs text-ck-ink-3">加载中…</div>
      ) : events.length === 0 ? (
        <div className="py-6 text-center text-xs text-ck-ink-3">当前暂无目标偏差经营事件</div>
      ) : (
        events.slice(0, 3).map((e) => (
          <div key={e.event_id} className="border-b border-ck-line/60 py-2 first:pt-0 last:border-0 last:pb-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <StatusTag tone={e.severity === "major" ? "danger" : "warning"} size="sm">
                {e.severity === "major" ? "重大" : "一般"}
              </StatusTag>
              <button
                type="button"
                className="min-w-0 flex-1 truncate text-left text-xs font-medium text-ck-primary hover:underline"
                title={e.title}
                onClick={() => onOpenEvent(e.event_id)}
              >
                {e.title}
              </button>
              <span className="shrink-0 text-[10px] text-ck-ink-3">持续第 {e.persist_days} 天</span>
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-1.5">
              {LIFE_LABEL[e.lifecycle] != null && (
                <StatusTag tone={e.lifecycle === "resolved" ? "success" : "info"} dot size="sm">{LIFE_LABEL[e.lifecycle]}</StatusTag>
              )}
              {ATTR_LABEL[e.attribution_status] != null && (
                <StatusTag tone={ATTR_TONE[e.attribution_status] ?? "neutral"} size="sm">{ATTR_LABEL[e.attribution_status]}</StatusTag>
              )}
              {e.summary && (
                <span className="min-w-0 flex-1 truncate text-[11px] text-ck-ink-3" title={e.summary}>{e.summary.split("\n")[0]}</span>
              )}
            </div>
          </div>
        ))
      )}
    </SectionCard>
  );
}

/** L5 月度达成明细（裁定4）：差额两口径——完整月=实际−整月目标；当月=MTD 实际−月目标×
 *  月工作日进度（同口径，绝不拿 MTD 对整月目标冒充落后），带「进度」角标+title 注口径；
 *  当月 timePct 缺失 → 差额「—」。状态：完整月 领先/落后/—；当月 进行中+MTD 时间进度。 */
function MonthTable({ months }: { months: TargetMonthRow[] | TargetDegraded }) {
  if (isDegraded(months))
    return (
      <SectionCard padding="none" title="月度达成（明细）">
        <DegradedLine reason={months.reason} />
      </SectionCard>
    );
  return (
    <SectionCard padding="none" title="月度达成（明细）">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-ck-line text-left text-ck-ink-3">
            {["月份", "月度目标", "月度实际", "达成率", "差额", "状态"].map((h) => (
              <th key={h} className="whitespace-nowrap px-4 py-2 font-normal">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-10 text-center text-ck-ink-3">暂无目标数据</td>
            </tr>
          ) : (
            months.map((m) => {
              const diff = m.isCurrent
                ? m.timePct != null && m.targetWan != null && m.actualWan != null
                  ? m.actualWan - m.targetWan * (m.timePct / 100)
                  : null
                : m.actualWan != null && m.targetWan != null
                  ? m.actualWan - m.targetWan
                  : null;
              const diffCls = diff == null ? "text-ck-ink-3" : diff >= 0 ? "text-ck-success" : "text-ck-danger";
              return (
                <tr key={m.month} className={`border-b border-ck-line/60 last:border-0 ${m.isCurrent ? "bg-ck-primary-soft/40" : ""}`}>
                  <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">{Number(m.month.slice(5))} 月</td>
                  <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">{fmtWanSmart(m.targetWan)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-ck-ink">{fmtWanSmart(m.actualWan)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-ck-ink-2">{fmtPct(m.achievePct)}</td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {m.isCurrent && diff != null ? (
                      <span className={diffCls} title="当月差额=MTD实际−月目标×月工作日进度（同口径）">
                        {fmtWanSmart(diff)}
                        <sup className="ml-0.5 text-[9px] font-normal text-ck-ink-3">进度</sup>
                      </span>
                    ) : (
                      <span className={diffCls}>{fmtWanSmart(diff)}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2">
                    {m.isCurrent ? (
                      <span className="text-ck-primary">
                        进行中
                        {m.timePct != null && <span className="ml-1.5 text-[10px] text-ck-ink-3">MTD 时间进度 {m.timePct}%</span>}
                      </span>
                    ) : m.actualWan == null || m.targetWan == null ? (
                      <span className="text-ck-ink-3">—</span>
                    ) : m.actualWan >= m.targetWan ? (
                      <span className="text-ck-success">领先</span>
                    ) : (
                      <span className="text-ck-danger">落后</span>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </SectionCard>
  );
}

export default function TargetManagementPage({ onOpenEvent, onAsk }: {
  onOpenEvent: (id: string) => void;
  onAsk: (question: string) => void;
}) {
  const [data, setData] = useState<TargetOverview | null>(null);
  const [events, setEvents] = useState<InsightActiveEvent[] | null>(null);
  const [eventsErr, setEventsErr] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    apiInsightTargetOverview().then(setData).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
    // L4：target_gap 真实事件（active 池客户端过滤）；拉取失败 ≠ 无事件 → err 标记（渲染「暂不可用」）
    apiInsightActiveEvents()
      .then((r) => setEvents(r.events.filter((e) => e.event_type === "target_gap")))
      .catch(() => setEventsErr(true));
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

  const annual = data != null && !isDegraded(data.annual) ? data.annual : null;

  return (
    <AppShell>
      <PageHeader
        title="目标管理"
        subtitle={data ? `${data.year} 年 · 数据日 ${data.asOf}` : "加载中…"}
        meta={
          <PrimaryButton
            size="sm"
            disabled={annual == null}
            title={annual == null ? "数据未就绪" : undefined}
            onClick={annual != null ? () => onAsk(buildQuestion(annual, events ?? [])) : undefined}
          >
            让AI分析目标差距
          </PrimaryButton>
        }
      />
      {!data ? (
        <div className="py-6 text-sm text-ck-ink-3">加载中…</div>
      ) : (
        <>
          {/* L1：annual 降级 → 整排降级行 */}
          {isDegraded(data.annual) ? <DegradedLine reason={data.annual.reason} /> : annual != null && <KpiStrip annual={annual} />}
          {/* L2 */}
          <CumulativeProgressCard months={data.months} />
          {/* L3 */}
          <BehindTopCard centers={data.centers} totalBehindWan={data.centersTotalBehindWan} />
          {/* L4 */}
          <TargetEventsCard events={events} err={eventsErr} onOpenEvent={onOpenEvent} />
          {/* L5 */}
          <MonthTable months={data.months} />
        </>
      )}
    </AppShell>
  );
}
