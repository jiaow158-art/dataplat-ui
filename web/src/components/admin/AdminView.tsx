// M4 管理后台壳：三子页 Tab（用户管理/审计查询/使用统计）+ 返回对话。
// 入口仅管理员可见（App.tsx 按 /api/me.is_admin 渲染）；简单 state 路由与现有风格一致。
import { useCallback, useState } from "react";
import UsersPage from "./UsersPage";
import AuditPage from "./AuditPage";
import StatsPage from "./StatsPage";

type Tab = "users" | "audit" | "stats";

const TABS: { key: Tab; label: string }[] = [
  { key: "users", label: "用户管理" },
  { key: "audit", label: "审计查询" },
  { key: "stats", label: "使用统计" },
];

export default function AdminView({ username, onBack }: { username: string; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("users");
  // 统计页失败清单 → 审计 run 详情的跨页跳转（AuditPage 消费后置空）
  const [focusRun, setFocusRun] = useState<string | null>(null);
  const openRun = useCallback((runId: string) => {
    setFocusRun(runId);
    setTab("audit");
  }, []);
  const clearFocusRun = useCallback(() => setFocusRun(null), []);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-base">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-5 py-3">
        <span className="text-sm font-semibold text-ink">管理后台</span>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`rounded px-3 py-1.5 text-xs transition-colors ${
                tab === t.key ? "bg-accent-soft text-ink" : "text-ink-3 hover:text-ink"
              }`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <span className="ml-auto text-xs text-ink-3">{username}</span>
        <button
          type="button"
          className="rounded border border-line px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink"
          onClick={onBack}
        >
          返回对话
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "users" && <UsersPage me={username} />}
        {tab === "audit" && <AuditPage focusRun={focusRun} onFocusConsumed={clearFocusRun} />}
        {tab === "stats" && <StatsPage onOpenRun={openRun} />}
      </div>
    </div>
  );
}
