// P0 驾驶舱统一壳层：App 根 div 里 aside 的兄弟 main（不裹侧栏）。
// 唯一页面级纵向滚动容器；页面不得再包 h-full overflow-y-auto（组件内固定高度小滚动区不受限）。
import type { ReactNode } from "react";

interface AppShellProps {
  children: ReactNode;
}

export default function AppShell({ children }: AppShellProps) {
  return (
    <main className="ck-scroll flex min-w-0 flex-1 flex-col bg-ck-bg">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex w-full flex-col gap-5 px-6 pb-10 pt-8 lg:px-8">{children}</div>
      </div>
    </main>
  );
}
