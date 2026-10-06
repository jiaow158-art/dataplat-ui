// 通用卡：rounded-xl + ck 线框/白底/ck 阴影；padding=none 给表格通铺（标题行自带 px-5 pt-4）。
import type { ReactNode } from "react";

interface SectionCardProps {
  title?: string;
  extra?: ReactNode;
  padding?: "md" | "none";
  className?: string;
  children: ReactNode;
}

export default function SectionCard({ title, extra, padding = "md", className, children }: SectionCardProps) {
  const hasHeader = title != null || extra != null;
  const bodyCls = !hasHeader
    ? padding === "none"
      ? ""
      : "p-5"
    : padding === "none"
      ? "mt-3"
      : "mt-3 p-5 pt-0";
  return (
    <div className={`rounded-xl border border-ck-line bg-ck-card shadow-ck${className ? ` ${className}` : ""}`}>
      {hasHeader && (
        <div className="flex items-baseline justify-between px-5 pt-4">
          {title != null && <h3 className="text-lg font-semibold text-ck-ink">{title}</h3>}
          {extra != null && <div className="text-xs text-ck-ink-3">{extra}</div>}
        </div>
      )}
      <div className={bodyCls}>{children}</div>
    </div>
  );
}
