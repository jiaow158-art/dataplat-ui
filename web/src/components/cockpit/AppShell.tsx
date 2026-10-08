// P0 驾驶舱统一壳层：App 根 div 里 aside 的兄弟 main（不裹侧栏）。
// 唯一页面级纵向滚动容器；页面不得再包 h-full overflow-y-auto（组件内固定高度小滚动区不受限）。
// min-h-0（2026-10-08 修复）：详情 overlay 的父容器是列 flex（fixed inset-0 flex flex-col）——
// 列向 flex 子项默认 min-height:auto=内容高会撑破视口且无滚动条；行 flex 页面该属性为无害冗余。
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <main className="ck-scroll flex min-h-0 min-w-0 flex-1 flex-col bg-ck-bg">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-5 px-6 pb-10 pt-8 lg:px-8">{children}</div>
      </div>
    </main>
  );
}
