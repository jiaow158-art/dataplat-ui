// 数据时效：meta 态 xs 弱字行（数据日/简报日，缺哪段省哪段）；notice 态 amber 降级横幅。
interface DataFreshnessProps {
  asOf?: string | null;
  briefDate?: string | null;
  notice?: string | null;
}

export default function DataFreshness({ asOf, briefDate, notice }: DataFreshnessProps) {
  if (notice != null) {
    return (
      <div className="rounded-lg border border-ck-warning-soft bg-ck-warning-soft px-3 py-2 text-xs text-ck-warning">
        {notice}
      </div>
    );
  }
  const parts: string[] = [];
  if (asOf != null) parts.push(`数据日 ${asOf}`);
  if (briefDate != null) parts.push(`简报 ${briefDate}`);
  if (parts.length === 0) return null;
  return <div className="text-xs text-ck-ink-3">{parts.join(" · ")}</div>;
}
