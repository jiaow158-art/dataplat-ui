// 筛选条：筛选控件行容器（count 右缘弱字）；filterControlClass 给 input/select 统一形态。
import type { ReactNode } from "react";

export const filterControlClass =
  "rounded border border-ck-line-strong bg-ck-card px-2 py-1.5 text-ck-ink-2 outline-none transition-colors focus:border-ck-primary";

interface FilterBarProps {
  children: ReactNode;
  count?: ReactNode;
}

export default function FilterBar({ children, count }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-ck-line bg-ck-card p-3 text-xs text-ck-ink-2">
      {children}
      {count != null && <div className="ml-auto text-ck-ink-3">{count}</div>}
    </div>
  );
}
