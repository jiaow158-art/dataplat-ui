// 进度环（HealthPanel 专用；TargetManagementPage 在 P1-3 移除 Ring 用法）：64 视口 r=26 粗 6、rotate(-90)。
// children 绝对居中叠放（分数/百分比由调用方塞进来）。
import type { ReactNode } from "react";

interface RingProps {
  value: number;
  color?: string;
  className?: string;
  children?: ReactNode;
}

export default function Ring({ value, color = "#1667d9", className = "h-16 w-16", children }: RingProps) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <div className={`relative ${className}`}>
      <svg viewBox="0 0 64 64" className="h-full w-full">
        <circle cx="32" cy="32" r={r} fill="none" stroke="#e3eaf3" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeDasharray={`${(c * pct) / 100} ${c}`}
          strokeLinecap="round"
          transform="rotate(-90 32 32)"
        />
      </svg>
      {children != null && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}
