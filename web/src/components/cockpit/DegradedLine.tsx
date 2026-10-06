// 局部降级行（TargetManagementPage/RegionBattleMapPage 两份合并）：坏块 {available:false, reason}
// 灰底一行 reason 原样透传，不造数。
export default function DegradedLine({ reason }: { reason: string }) {
  return <div className="rounded-lg bg-ck-card-soft px-3 py-5 text-center text-xs text-ck-ink-3">{reason}</div>;
}
