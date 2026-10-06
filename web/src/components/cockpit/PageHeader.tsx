// 页头：H1 28px + 副题 + 右侧 meta 槽（DataFreshness 等）+ children 芯片行，直接坐页面底。
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  meta?: ReactNode;
  children?: ReactNode;
}

export default function PageHeader({ title, subtitle, meta, children }: PageHeaderProps) {
  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.01em] text-ck-ink">{title}</h1>
          {subtitle != null && <div className="mt-1 text-sm text-ck-ink-3">{subtitle}</div>}
        </div>
        {meta != null && <div className="self-start">{meta}</div>}
      </div>
      {children != null && <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
