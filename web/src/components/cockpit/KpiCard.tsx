// KPI 指标卡：label xs 弱字 + value xl semibold；value/sub 可注入类名做红绿差异化。
import type { ReactNode } from "react";

interface KpiCardProps {
  label: string;
  value: ReactNode;
  valueClassName?: string;
  sub?: ReactNode;
  subClassName?: string;
}

export default function KpiCard({ label, value, valueClassName, sub, subClassName }: KpiCardProps) {
  return (
    <div className="rounded-xl border border-ck-line bg-ck-card p-4 shadow-ck">
      <div className="text-xs text-ck-ink-3">{label}</div>
      <div className={`mt-1 text-xl font-semibold text-ck-ink${valueClassName ? ` ${valueClassName}` : ""}`}>{value}</div>
      {sub != null && (
        <div className={`mt-0.5 text-xs text-ck-ink-3${subClassName ? ` ${subClassName}` : ""}`}>{sub}</div>
      )}
    </div>
  );
}
