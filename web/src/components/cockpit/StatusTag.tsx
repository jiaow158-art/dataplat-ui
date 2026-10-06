// 状态标签：软底强字胶囊。severity 无独立 token——major→danger、minor→warning 经 tone 映射。
import type { ReactNode } from "react";

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const toneClass: Record<Tone, string> = {
  success: "bg-ck-success-soft text-ck-success",
  warning: "bg-ck-warning-soft text-ck-warning",
  danger: "bg-ck-danger-soft text-ck-danger",
  info: "bg-ck-primary-soft text-ck-primary",
  neutral: "bg-ck-card-soft text-ck-ink-3",
};

interface StatusTagProps {
  tone: Tone;
  children: ReactNode;
  dot?: boolean;
  size?: "sm" | "md";
  title?: string;
}

export default function StatusTag({ tone, children, dot = false, size = "md", title }: StatusTagProps) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 font-medium ${size === "sm" ? "text-[10px]" : "text-xs"} ${toneClass[tone]}`}
    >
      {dot && (
        <span aria-hidden className="text-[0.7em] leading-none">
          ●
        </span>
      )}
      {children}
    </span>
  );
}
