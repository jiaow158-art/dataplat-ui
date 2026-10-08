// ED-1 L7 当前状态（修正5 重写）：生命周期事实与旧归因时效分离——
// resolved ≠ 业务风险消失（固定语义说明）；无解除依据字段则明示"未记录"，
// 绝不从旧归因推断解除原因；归因块标明数据日与生成时间，早于解除时如实标注时序。
import SectionCard from "../cockpit/SectionCard";
import StatusTag from "../cockpit/StatusTag";
import type { InsightEventDetail } from "../../types";

const fmtTs = (sec: number) => new Date(sec * 1000).toLocaleDateString("zh-CN");

const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-baseline justify-between gap-3 text-sm">
    <span className="shrink-0 text-ck-ink-3">{label}</span>
    <span className="text-right text-ck-ink">{value}</span>
  </div>
);

export default function CurrentStatusCard({ d }: { d: InsightEventDetail }) {
  const e = d.event;
  const resolved = e.lifecycle === "resolved";
  const gen = d.attribution.generatedAt;
  const genDate = gen ? fmtTs(gen) : null;
  // 时序：归因生成日期 ≤ 解除日期 → 分析基于解除前数据（常见：归因快照旧于生命周期）
  const olderThanResolve = resolved && genDate != null && e.resolved_at != null && genDate <= e.resolved_at;
  return (
    <SectionCard
      title="当前状态"
      extra={<StatusTag tone={resolved ? "success" : "info"} dot>{resolved ? "已解除" : "进行中"}</StatusTag>}
    >
      <div className="flex flex-col gap-2">
        <Row label="首次发现" value={e.first_seen_date} />
        <Row label={resolved ? "最后异常数据日" : "最新异常数据日"} value={e.data_date} />
        {resolved ? (
          <>
            <Row label="解除日期" value={e.resolved_at ?? "—"} />
            <div className="rounded-lg bg-ck-card-soft px-3 py-2 text-xs leading-5 text-ck-ink-2">
              解除依据：未记录（系统未提供该字段，不以旧归因推断）。「已解除」表示后续检测周期未再确认该异常，
              相关余额或经营风险不一定随之消失。
            </div>
          </>
        ) : (
          <Row label="已持续" value={`${e.persist_days} 天`} />
        )}
        {genDate && (
          <div className={`rounded-lg px-3 py-2 text-xs leading-5 ${olderThanResolve ? "bg-ck-warning-soft text-ck-ink-2" : "bg-ck-card-soft text-ck-ink-3"}`}>
            归因时效：分析基于数据日 {e.data_date}，生成于 {genDate}
            {olderThanResolve ? `——早于解除（${e.resolved_at}），不代表解除后的最新状态` : ""}
          </div>
        )}
      </div>
    </SectionCard>
  );
}
