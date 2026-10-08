// ED-1 L3 关键经营事实：按 event_type 显式映射（修正1：禁用"通用首尾锚点"——
// 每个指标须名称可确认含义/单位/日期/口径才收录；waterfall 名称自带语义与日期（如
// "上期90+余额(2026-08)"），不匹配即弃；无法确认时仅展示原始 facts，不补造）。
// 数量随真实数据 1~4 张动态排布（auto-fit），缺字段少展示，不为凑格造指标。
import { fmtWanSmart } from "./fmt";
import type { InsightEventDetail } from "../../types";

export interface KpiItem {
  label: string;
  value: string;
  note?: string;
}

/** 原始 facts 原样（label 自带单位语义；值是字符串——单位/口径不确认不做万格式化）。 */
const factKpis = (d: InsightEventDetail, note?: string): KpiItem[] =>
  d.facts.slice(0, 4).map((f) => ({ label: f.label, value: f.value, note }));

function buildKpis(d: InsightEventDetail): KpiItem[] {
  const w = d.attribution.waterfall;
  const out: KpiItem[] = [];
  switch (d.event.event_type) {
    case "ar_overdue": {
      out.push(...factKpis(d, "检测口径（检测时点增量）"));
      const prev = w.find((x) => /上期.*余额/.test(x.name));
      const cur = w.length ? w[w.length - 1] : undefined;
      if (prev && cur && /本期.*余额/.test(cur.name)) {
        out.push({ label: cur.name, value: fmtWanSmart(cur.value) });
        out.push({ label: prev.name, value: fmtWanSmart(prev.value) });
        out.push({
          label: "净变化（现行快照同口径复算）",
          value: fmtWanSmart(cur.value - prev.value),
          note: "与检测口径增量时点不同，两者不互相纠错",
        });
      }
      break;
    }
    case "sales_decline": {
      out.push(...factKpis(d, "检测口径"));
      const first = w[0];
      const last = w.length ? w[w.length - 1] : undefined;
      if (first && last && /业绩/.test(first.name) && /业绩/.test(last.name) && w.length >= 2) {
        out.push({ label: last.name, value: fmtWanSmart(last.value) });
        out.push({ label: first.name, value: fmtWanSmart(first.value) });
      }
      break;
    }
    case "target_gap": {
      out.push(...factKpis(d, "检测口径"));
      const pick = (re: RegExp) => w.find((x) => re.test(x.name));
      const target = pick(/月目标/);
      const actual = pick(/MTD实际|实际达成/);
      const gap = pick(/进度缺口合计/);
      if (target) out.push({ label: target.name, value: fmtWanSmart(target.value) });
      if (actual) out.push({ label: actual.name, value: fmtWanSmart(actual.value) });
      if (gap) out.push({ label: gap.name, value: fmtWanSmart(gap.value), note: "按时间进度应达口径" });
      break;
    }
    default:
      out.push(...factKpis(d));
  }
  const seen = new Set<string>();
  return out.filter((k) => (seen.has(k.label) ? false : (seen.add(k.label), true))).slice(0, 4);
}

export default function KpiStrip({ d }: { d: InsightEventDetail }) {
  const kpis = buildKpis(d);
  if (kpis.length === 0) return null;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
      {kpis.map((k) => (
        <div key={k.label} className="rounded-xl border border-ck-line bg-ck-card px-4 py-3 shadow-ck">
          <div className="text-xs text-ck-ink-3" title={k.note}>{k.label}</div>
          <div className="mt-1 text-lg font-semibold text-ck-ink">{k.value}</div>
          {k.note && <div className="mt-0.5 text-[11px] text-ck-ink-3">{k.note}</div>}
        </div>
      ))}
    </div>
  );
}
