// 次按钮：白底线框，hover 描边/文字转 ck-primary；尺寸档同 PrimaryButton。
import type { ButtonHTMLAttributes } from "react";

interface SecondaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md";
}

export default function SecondaryButton({ size = "md", className, ...rest }: SecondaryButtonProps) {
  return (
    <button
      {...rest}
      className={`rounded-lg border border-ck-line-strong bg-ck-card text-ck-ink-2 transition-colors hover:border-ck-primary hover:text-ck-primary disabled:pointer-events-none disabled:opacity-50 ${size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm"}${className ? ` ${className}` : ""}`}
    />
  );
}
