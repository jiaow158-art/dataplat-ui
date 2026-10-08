// ED-1 L5 贡献结构（修正2 重写）：0 中心正负双向条形——锚点（总量/目标/合计类）不进图
//（旧图 |总余额| 尺度把贡献压成 1% 宽的根因修复，总量归 KPI）；跨维度分组展示、
// 组间绝不互加（同一笔金额在不同维度被重复观察）；组内仅当合计能被已知锚点差值
// 精确校验（±1 容差）才显示合计行，否则明示"部分明细，不作合计"。
// 颜色只表示变化方向（增加/减少），不隐喻经营好坏。
import { fmtWanSmart } from "./fmt";
import type { InsightEventDetail } from "../../types";

interface Item {
  name: string;
  value: number;
}
interface Group {
  title: string;
  items: Item[];
  /** 组内可校验的期望合计（锚点差值）；null=不可校验（部分明细）。 */
  expectTotal: number | null;
  totalNote?: string;
}

/** 解析单组（ar/sales：中间项同维度一组，期望合计=首尾锚点差）。 */
function splitSingle(w: Item[], headOk: boolean): { contributions: Item[]; expect: number | null } | null {
  if (!headOk || w.length < 3) return null;
  const contributions = w.slice(1, -1);
  const expect = w[w.length - 1]!.value - w[0]!.value;
  return { contributions, expect: Number.isFinite(expect) ? expect : null };
}

function buildGroups(d: InsightEventDetail): Group[] {
  const w = d.attribution.waterfall;
  if (w.length < 2) return [];
  switch (d.event.event_type) {
    case "ar_overdue": {
      const ok = /上期.*余额/.test(w[0]!.name) && /本期.*余额/.test(w[w.length - 1]!.name);
      const s = splitSingle(w, ok);
      return s && s.contributions.length
        ? [{ title: "按账龄段的结构贡献（同一维度，互斥可加总）", items: s.contributions, expectTotal: s.expect }]
        : [];
    }
    case "sales_decline": {
      const ok = /业绩/.test(w[0]!.name) && /业绩/.test(w[w.length - 1]!.name);
      const s = splitSingle(w, ok);
      return s && s.contributions.length
        ? [{ title: "量价分解贡献（同一维度，互斥可加总）", items: s.contributions, expectTotal: s.expect }]
        : [];
    }
    case "target_gap": {
      // 锚点链：月目标 → 时间进度应达 → MTD实际达成 → 进度缺口合计；其后为贡献项。
      // 贡献项混两个维度（渠道缺口 / 运营中心缺口）——同一笔缺口被两个维度重复观察，
      // 必须分组且组间不相加（修正2）；组内合计仅当等于"进度缺口合计"（完整互斥分解）才显示。
      const gapIdx = w.findIndex((x) => /进度缺口合计/.test(x.name));
      if (gapIdx < 0) return [];
      const total = w[gapIdx]!.value;
      const rest = w.slice(gapIdx + 1);
      if (!rest.length) return [];
      const groups: Group[] = [];
      const by = (re: RegExp, title: string) => {
        const items = rest.filter((x) => re.test(x.name));
        if (items.length) groups.push({ title, items, expectTotal: total });
      };
      by(/渠道缺口$/, "按渠道的缺口贡献（同一维度）");
      by(/运营中心缺口$/, "按运营中心的缺口贡献（同一维度）");
      const matched = groups.reduce((n, g) => n + g.items.length, 0);
      if (matched < rest.length) {
        // 有无法归入已知维度的条目：整体退化为明细表（不猜维度归属）
        return [{ title: "贡献明细（存在未识别维度，按原始顺序）", items: rest, expectTotal: null }];
      }
      return groups;
    }
    default:
      return w.length >= 3
        ? [{ title: "贡献明细（按原始顺序）", items: w.slice(1, -1), expectTotal: null }]
        : [];
  }
}

function GroupBlock({ g }: { g: Group }) {
  const maxAbs = Math.max(...g.items.map((x) => Math.abs(x.value))) || 1;
  const sum = g.items.reduce((a, x) => a + x.value, 0);
  // 可加总性校验：组内合计须精确复现已知锚点差（±1 容差）——不匹配=部分明细，绝不硬造合计
  const verified = g.expectTotal != null && Math.abs(sum - g.expectTotal) <= 1;
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ck-ink-2">{g.title}</div>
      <div className="flex flex-col gap-1.5">
        {g.items.map((x, i) => {
          const pos = x.value >= 0;
          const pct = (Math.abs(x.value) / maxAbs) * 50;
          return (
            <div key={`${x.name}-${i}`} className="flex items-center gap-3 text-xs">
              <span className="w-32 shrink-0 truncate text-ck-ink-2" title={x.name}>{x.name}</span>
              <div className="relative h-5 flex-1 rounded bg-ck-card-soft">
                <div className="absolute inset-y-0 left-1/2 w-px bg-ck-line-strong" />
                {x.value !== 0 && (
                  <div
                    className={`absolute inset-y-1 rounded ${pos ? "left-1/2 bg-ck-primary" : "right-1/2 bg-ck-danger"}`}
                    style={{ width: `${Math.max(pct, 0.5)}%` }}
                  />
                )}
              </div>
              <span className={`w-24 shrink-0 text-right ${pos ? "text-ck-ink" : "text-ck-danger"}`}>
                {fmtWanSmart(x.value)}
              </span>
            </div>
          );
        })}
      </div>
      {verified ? (
        <div className="mt-1.5 text-[11px] text-ck-ink-3">
          组内合计 {fmtWanSmart(sum)}，与首尾锚点差精确一致（完整互斥分解，可加总）
        </div>
      ) : (
        <div className="mt-1.5 text-[11px] text-ck-ink-3">
          部分明细（未构成完整互斥分解），不作合计；与其他维度存在对同一金额的重复观察，不可跨组相加
        </div>
      )}
    </div>
  );
}

export default function ContributionChart({ d }: { d: InsightEventDetail }) {
  const groups = buildGroups(d);
  if (!groups.length) {
    return <div className="text-sm text-ck-ink-3">贡献结构待归因生成</div>;
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-4 text-[11px] text-ck-ink-3">
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ck-primary" />增加</span>
        <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-ck-danger" />减少</span>
        <span>颜色表示变化方向，不代表经营好坏</span>
      </div>
      {groups.map((g) => (
        <GroupBlock key={g.title} g={g} />
      ))}
      <div className="text-[11px] text-ck-ink-3">总量与锚点（期初/期末余额、目标等）见上方关键经营事实。</div>
    </div>
  );
}
