// UI-T5 左栏：会话列表（新建/切换/重命名 inline 编辑/删除）+ 当前用户 + 登出。
// 会话 CRUD 全部走 BFF /api/sessions（记账表；删除不动网关，spec §8）。
import { useState, type KeyboardEvent } from "react";
import { ApiError, apiDeleteSession, apiRenameSession } from "../api";
import type { UiSession } from "../types";

interface SidebarProps {
  username: string;
  sessions: UiSession[];
  activeId: string | null;
  isAdmin: boolean; // M4：仅管理员渲染"管理后台"入口
  onAdmin: () => void;
  onSelect: (id: string) => void;
  onNew: () => Promise<void>; // 父级建会话并刷新列表后进入空对话态
  onChanged: () => Promise<void>; // 重命名/删除后刷新列表
  onActiveDeleted: () => void; // 删掉的是当前会话 → 回到新会话态
  onLogout: () => void;
}

export default function Sidebar(props: SidebarProps) {
  const { username, sessions, activeId } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const startRename = (s: UiSession) => {
    setEditingId(s.id);
    setEditTitle(s.title);
  };

  const commitRename = (id: string) =>
    guard(async () => {
      const t = editTitle.trim();
      setEditingId(null);
      if (t) await apiRenameSession(id, t);
      await props.onChanged();
    });

  const onEditKey = (e: KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === "Enter") commitRename(id);
    if (e.key === "Escape") setEditingId(null);
  };

  const remove = (s: UiSession) =>
    guard(async () => {
      await apiDeleteSession(s.id);
      setConfirmDeleteId(null);
      if (s.id === activeId) props.onActiveDeleted();
      await props.onChanged();
    });

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded bg-accent-soft text-xs font-bold text-accent-2">
          数
        </span>
        <span className="text-sm font-semibold text-ink">东鹏问数</span>
      </div>

      <div className="px-3 pt-3">
        <button
          type="button"
          className="w-full rounded border border-line-strong bg-card py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink"
          disabled={busy}
          onClick={() => guard(props.onNew)}
        >
          ＋ 新建会话
        </button>
      </div>

      <nav className="mt-2 flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 && (
          <div className="px-2 py-6 text-center text-xs text-ink-3">暂无会话，新建一个开始提问</div>
        )}
        {sessions.map((s) => {
          const active = s.id === activeId;
          return (
            <div
              key={s.id}
              className={`group mb-0.5 flex items-center gap-1 rounded px-2 py-1.5 ${
                active ? "bg-accent-soft" : "hover:bg-lift"
              }`}
            >
              {editingId === s.id ? (
                <input
                  autoFocus
                  className="min-w-0 flex-1 rounded border border-accent bg-card px-1.5 py-0.5 text-xs text-ink outline-none"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  onBlur={() => commitRename(s.id)}
                  onKeyDown={(e) => onEditKey(e, s.id)}
                />
              ) : (
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-xs text-ink"
                  title={s.title}
                  onClick={() => props.onSelect(s.id)}
                  onDoubleClick={() => startRename(s)}
                >
                  {s.title}
                </button>
              )}
              {editingId !== s.id &&
                (confirmDeleteId === s.id ? (
                  <span className="flex shrink-0 items-center gap-1 text-[10px]">
                    <button
                      type="button"
                      className="rounded bg-bad/20 px-1.5 py-0.5 text-bad hover:bg-bad/30"
                      disabled={busy}
                      onClick={() => remove(s)}
                    >
                      删除
                    </button>
                    <button
                      type="button"
                      className="rounded px-1.5 py-0.5 text-ink-3 hover:text-ink"
                      onClick={() => setConfirmDeleteId(null)}
                    >
                      取消
                    </button>
                  </span>
                ) : (
                  <span className="hidden shrink-0 gap-0.5 group-hover:flex">
                    <button
                      type="button"
                      title="重命名"
                      className="rounded p-0.5 text-ink-3 hover:text-ink"
                      onClick={() => startRename(s)}
                    >
                      <IconPencil />
                    </button>
                    <button
                      type="button"
                      title="删除会话"
                      className="rounded p-0.5 text-ink-3 hover:text-bad"
                      onClick={() => setConfirmDeleteId(s.id)}
                    >
                      <IconTrash />
                    </button>
                  </span>
                ))}
            </div>
          );
        })}
      </nav>

      {error && <div className="mx-3 mb-2 text-xs text-bad">{error}</div>}

      {props.isAdmin && (
        <div className="border-t border-line px-3 py-2">
          <button
            type="button"
            className="w-full rounded border border-line-strong bg-card py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink"
            onClick={props.onAdmin}
          >
            管理后台
          </button>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-line px-4 py-3">
        <span className="truncate text-xs text-ink-2" title={username}>
          {username}
        </span>
        <button
          type="button"
          className="rounded px-2 py-1 text-xs text-ink-3 transition-colors hover:text-ink"
          onClick={props.onLogout}
        >
          登出
        </button>
      </div>
    </aside>
  );
}

// 12px 线性小图标（内联 SVG，无外部依赖）
const IconPencil = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M11.3 1.7a1 1 0 0 1 1.4 0l1.6 1.6a1 1 0 0 1 0 1.4l-8 8-3.6.6.6-3.6 8-8Z"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
    />
  </svg>
);

const IconTrash = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.6 9h6.8l.6-9M6.7 7v4M9.3 7v4"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
