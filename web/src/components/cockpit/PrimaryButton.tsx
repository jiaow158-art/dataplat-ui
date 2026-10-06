// 主按钮：ck-primary 实底白字；sm/md 两档（md=h-9 基线）。
import type { ButtonHTMLAttributes } from "react";

interface PrimaryButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "md";
}

export default function PrimaryButton({ size = "md", className, ...rest }: PrimaryButtonProps) {
  return (
    <button
      {...rest}
      className={`rounded-lg bg-ck-primary font-medium text-white transition-colors hover:bg-ck-primary-hover disabled:pointer-events-none disabled:opacity-50 ${size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm"}${className ? ` ${className}` : ""}`}
    />
  );
}
