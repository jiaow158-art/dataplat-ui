// UI-T5 左栏：会话列表（新建/切换/重命名 inline 编辑/删除）+ 当前用户 + 登出。
// 会话 CRUD 全部走 BFF /api/sessions（记账表；删除不动网关，spec §8）。
// 知识健康治理 §四C：底部「申请新域」→ 弹层表单 → POST /api/domain-requests。
// P0 双壳：flag 关 = legacy（渲染字节级原样）；flag 开 = cockpit 三组导航壳，chat 视图回落会话壳（顶部返回驾驶舱）。
import { useState, type KeyboardEvent } from "react";
import { ApiError, apiDeleteSession, apiRenameSession, apiSubmitDomainRequest } from "../api";
import type { UiSession, UrgencyLevel } from "../types";

interface SidebarProps {
  username: string;
  sessions: UiSession[];
  activeId: string | null;
  activeView: "chat" | "admin" | "insights" | "events" | "subscriptions" | "targets" | "regions";
  isAdmin: boolean; // M4：仅管理员渲染"管理后台"入口
  onAdmin: () => void;
  insightsEnabled: boolean; // M-i3：驾驶舱 flag 开才渲染"AI经营驾驶舱"入口
  onInsights: () => void;
  onEventCenter: () => void; // M-i6：经营事件中心入口（同一 insightsEnabled 门禁）
  onSubscriptions: () => void;
  onTargets: () => void; // M-i7：目标管理入口（同一 insightsEnabled 门禁）
  onRegionMap: () => void; // M-i8：区域作战地图入口（同一 insightsEnabled 门禁）
  onChat: () => void; // P1 双壳——进入 AI问数 模式
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
  const [domainOpen, setDomainOpen] = useState(false);

  // P0 双壳：flag 关 = legacy；flag 开 = cockpit 壳，chat 视图 = 会话壳
  const mode = !props.insightsEnabled ? "legacy" : props.activeView === "chat" ? "chat" : "cockpit";

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
    <aside className="flex w-64 shrink-0 flex-col border-r border-[#dbe5f1] bg-[#f7faff]">
      <div className="flex items-center gap-2 border-b border-[#e3ebf4] px-4 py-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-[#dcecff] text-xs font-bold text-[#1667d9] shadow-sm">
          数
        </span>
        <span className="text-sm font-semibold tracking-[-0.02em] text-[#10294b]">东鹏问数</span>
      </div>

      {mode === "cockpit" ? (
        <>
          {/* P0 驾驶舱壳：三组导航 + flex-1 占位。移动端约束（index.css <768px 隐藏 aside 内
              nav / nav+div / div:nth-last-child(2)，媒体查询块字节不动）：本分支不得渲染 <nav> 元素，
              且 aside 子序必须以 [flex-1 空占位 div, 用户 footer] 收尾——占位 div 吃掉 nth-last-child(2) 隐藏规则。 */}
          <div className="px-2 pt-3 text-[11px] text-ck-ink-3">经营模块</div>
          <div className="px-2">
            <NavItemCk active={props.activeView === "insights"} label="今日经营关注" onClick={props.onInsights} />
            <NavItemCk active={props.activeView === "events"} label="经营事件中心" onClick={props.onEventCenter} />
            <NavItemCk active={props.activeView === "targets"} label="目标管理" onClick={props.onTargets} />
            <NavItemCk active={props.activeView === "regions"} label="区域作战地图" onClick={props.onRegionMap} />
            <NavItemCk active={props.activeView === "subscriptions"} label="我的关注" onClick={props.onSubscriptions} />
          </div>
          <div className="px-2 pt-3 text-[11px] text-ck-ink-3">AI问数</div>
          <div className="px-2">
            <NavItemCk active={false} label="AI问数" onClick={props.onChat} />
          </div>
          {props.isAdmin && (
            <>
              <div className="px-2 pt-3 text-[11px] text-ck-ink-3">管理设置</div>
              <div className="px-2">
                <NavItemCk active={props.activeView === "admin"} label="系统设置" onClick={props.onAdmin} />
              </div>
            </>
          )}
          <div className="flex-1" />
        </>
      ) : (
        <>
          {mode === "chat" && (
            // P1 双壳：AI问数 模式顶部返回驾驶舱（替换原 U1 经营导航块）
            <div className="px-2 pt-3">
              <NavItemCk active={false} label="← 返回驾驶舱" onClick={props.onInsights} />
            </div>
          )}
          <div className={`px-3 ${props.insightsEnabled ? "mt-1.5" : "pt-3"}`}>
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

          <div className="border-t border-line px-3 py-2">
            <button
              type="button"
              className="w-full rounded py-1 text-[11px] text-ink-3 transition-colors hover:text-accent-2"
              onClick={() => setDomainOpen(true)}
            >
              ＋ 申请新域
            </button>
          </div>
        </>
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

      {domainOpen && <DomainRequestModal onClose={() => setDomainOpen(false)} />}
    </aside>
  );
}

/** P0 驾驶舱壳导航项（亮色 ck 系）：4px 左侧色条；高亮 bg-ck-primary-soft，非高亮 hover:bg-ck-card-soft。 */
function NavItemCk({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
        active ? "bg-ck-primary-soft font-medium text-ck-ink" : "text-ck-ink-2 hover:bg-ck-card-soft"
      }`}
      onClick={onClick}
    >
      <span className={`h-4 w-1 shrink-0 rounded-full ${active ? "bg-ck-primary" : "bg-ck-line-strong"}`} />
      {label}
    </button>
  );
}

/** 申请新域弹层（任何登录用户）：域名 2-40 字 / 典型问题 ≤1000 字 / 急迫度三选一。 */
function DomainRequestModal({ onClose }: { onClose: () => void }) {
  const [domain, setDomain] = useState("");
  const [questions, setQuestions] = useState("");
  const [urgency, setUrgency] = useState<UrgencyLevel>("中");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const trimmed = domain.trim();
  const valid = trimmed.length >= 2 && trimmed.length <= 40;

  const submit = async () => {
    if (busy || !valid) return;
    setBusy(true);
    setError(null);
    try {
      await apiSubmitDomainRequest(trimmed, urgency, questions.trim() || undefined);
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "提交失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={done ? onClose : undefined}>
      <div className="w-[26rem] rounded-lg border border-line bg-panel p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {done ? (
          <div>
            <div className="text-sm font-semibold text-good">已提交</div>
            <div className="mt-2 text-xs text-ink-2">已提交，受理后会联系你。</div>
            <div className="mt-4 text-right">
              <button
                type="button"
                className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-2"
                onClick={onClose}
              >
                好的
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-sm font-semibold text-ink">申请新域</div>
            <div className="mt-1 text-[11px] text-ink-3">
              当前未覆盖的业务域（如采购、人力资源等）——受理后会按扩域流程建设知识库。
            </div>
            <label className="mt-3 block text-xs text-ink-3">
              域名（2-40 字）
              <input
                autoFocus
                className="mt-1 w-full rounded border border-line bg-card px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                maxLength={40}
                placeholder="如：采购域"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="mt-3 block text-xs text-ink-3">
              典型问题（选填，≤1000 字——你平时想问什么）
              <textarea
                className="mt-1 h-24 w-full resize-none rounded border border-line bg-card px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                maxLength={1000}
                placeholder={"如：本月采购金额Top供应商？\n瓷砖原料库存周转如何？"}
                value={questions}
                onChange={(e) => setQuestions(e.target.value)}
                disabled={busy}
              />
            </label>
            <div className="mt-3 text-xs text-ink-3">
              急迫度
              <div className="mt-1 flex gap-1">
                {(["高", "中", "低"] as const).map((u) => (
                  <button
                    key={u}
                    type="button"
                    className={`rounded px-3 py-1 text-xs transition-colors ${
                      urgency === u ? "bg-accent-soft text-ink" : "text-ink-3 hover:text-ink"
                    }`}
                    onClick={() => setUrgency(u)}
                    disabled={busy}
                  >
                    {u}
                  </button>
                ))}
              </div>
            </div>
            {error && <div className="mt-3 text-xs text-bad">{error}</div>}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-line px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink"
                disabled={busy}
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={busy || !valid}
                onClick={() => void submit()}
              >
                {busy ? "提交中…" : "提交"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
