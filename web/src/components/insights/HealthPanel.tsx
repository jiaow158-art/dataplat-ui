// M-i5 经营健康度卡（spec §5/§6，P5 改版）：状态 chip 替代 0-100 分环，点击格子看算式（D-c1"分数谁定的"）。
// 判定只读 available + inputs、不读 score；库存环=永久未接入（诚实红线）——不造数。
import { useEffect, useState } from "react";
import { apiInsightHealthScore } from "../../api";
import type { InsightHealthRing, InsightHealthScore } from "../../types";
import DegradedLine from "../cockpit/DegradedLine";
import Ring from "../cockpit/Ring";
import SectionCard from "../cockpit/SectionCard";
import StatusTag from "../cockpit/StatusTag";
import type { Tone } from "../cockpit/StatusTag";

type RingStatus = { tone: Tone; tag: string; value: string | null };

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const fmt1 = (n: number) => n.toFixed(1);
const off = (reason: string | null): RingStatus => ({ tone: "neutral", tag: "未接入", value: reason });
// 域名简称：销售健康度→销售
const domainLabel = (label: string) => label.replace(/健康度$/, "");

// P5 状态映射：组件内局部函数（展示层专用，禁止导出/回流业务判定）。
// 阈值=旧 60/80 色带的等价原始阈值；所需原始输入缺失→未接入，不猜。
function ringStatus(r: InsightHealthRing): RingStatus {
  if (!r.available) return off(r.reason ?? null);
  const inputs = r.inputs ?? {};
  switch (r.key) {
    case "sales": {
      const yoy = inputs.yoy_pct;
      if (!isNum(yoy)) return off(r.reason ?? "原始输入缺失");
      return {
        tone: yoy < -20 ? "danger" : yoy < -10 ? "warning" : "success",
        tag: yoy < -20 ? "异常" : yoy < -10 ? "关注" : "正常",
        value: `同比 ${fmt1(yoy)}%`,
      };
    }
    case "margin": {
      const delta = inputs.delta_pct;
      if (!isNum(delta)) return off(r.reason ?? "原始输入缺失");
      return {
        tone: delta < -4 ? "danger" : delta < -2 ? "warning" : "success",
        tag: delta < -4 ? "异常" : delta < -2 ? "关注" : "正常",
        value: `毛利环比 ${fmt1(delta)}pt`,
      };
    }
    case "ar": {
      const nat90 = inputs.nat90_share_pct;
      if (!isNum(nat90)) return off(r.reason ?? "原始输入缺失");
      return {
        tone: nat90 > 40 ? "danger" : nat90 > 20 ? "warning" : "success",
        tag: nat90 > 40 ? "异常" : nat90 > 20 ? "关注" : "正常",
        value: `90天+占比 ${fmt1(nat90)}%`,
      };
    }
    default:
      // 未知环键：无阈值可判 → 未接入，不猜（review nit 1）
      return off(r.reason ?? "未知健康域，无判定阈值");
  }
}

function StatusCell({ r }: { r: InsightHealthRing }) {
  const [open, setOpen] = useState(false);
  const s = ringStatus(r);
  const cellCls = "rounded-lg border border-ck-line bg-ck-card-soft p-3";
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-ck-ink-2">{domainLabel(r.label)}</span>
        <StatusTag tone={s.tone} size="sm">{s.tag}</StatusTag>
      </div>
      {s.value != null && <div className="mt-1 text-xs text-ck-ink-3">{s.value}</div>}
      {r.mom_delta != null && (
        <div className={`text-[10px] ${r.mom_delta >= 0 ? "text-emerald-600" : "text-red-500"}`}>
          {r.mom_delta >= 0 ? "▲" : "▼"} 较上期 {Math.abs(r.mom_delta)}
        </div>
      )}
    </>
  );
  if (!r.available) return <div className={cellCls}>{body}</div>; // 未接入：无 popover（沿用原行为）
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={`${r.label}状态 ${s.tag}，查看计算依据`}
        className={`${cellCls} w-full cursor-pointer text-left transition-colors hover:border-ck-line-strong`}
        onClick={() => setOpen(!open)}
      >
        {body}
      </button>
      {open && (
        <div className="absolute left-1/2 top-full z-20 mt-1 w-56 -translate-x-1/2 rounded-lg bg-slate-900 p-3 text-left text-[11px] leading-relaxed text-slate-100 shadow-lg">
          <div className="font-medium text-white">{r.label}</div>
          <div className="mt-1">{r.formula}</div>
          {r.inputs && (
            <div className="mt-1 text-slate-400">
              输入：{Object.entries(r.inputs).map(([k, v]) => `${k}=${String(v)}`).join("，")}
            </div>
          )}
          {r.score != null && <div className="mt-1 text-slate-400">健康分（参考）：{r.score}</div>}
        </div>
      )}
    </div>
  );
}

export default function HealthPanel() {
  const [data, setData] = useState<InsightHealthScore | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    apiInsightHealthScore().then((d) => alive && setData(d)).catch(() => alive && setFailed(true));
    return () => { alive = false; };
  }, []);
  if (failed) {
    return (
      <SectionCard title="经营健康度">
        <DegradedLine reason="趋势服务未接入或数据未就绪" />
      </SectionCard>
    );
  }
  if (!data) {
    return (
      <SectionCard title="经营健康度">
        <div className="py-6 text-center text-sm text-ck-ink-3">经营健康度加载中…</div>
      </SectionCard>
    );
  }
  return (
    <SectionCard title="经营健康度" extra={`截至 ${data.as_of}`}>
      <div className="grid grid-cols-2 gap-3">
        {data.rings.map((r) => <StatusCell key={r.key} r={r} />)}
      </div>
      {data.target && (
        <div className="mt-4 rounded-lg bg-ck-card-soft p-3">
          <div className="text-xs text-ck-ink-2">{data.target.year} 年目标进度</div>
          <div className="mt-1 flex items-center gap-3">
            <Ring value={data.target.achieve_pct}>
              <div className="text-[11px] font-semibold text-ck-ink">{data.target.achieve_pct}%</div>
            </Ring>
            <div className="text-[11px] leading-relaxed text-ck-ink-3">
              <div>实际 {data.target.actual_wan.toLocaleString()} 万</div>
              <div>年度目标 {data.target.annual_target_wan.toLocaleString()} 万</div>
              <div>时间进度 {data.target.time_pct}%</div>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
