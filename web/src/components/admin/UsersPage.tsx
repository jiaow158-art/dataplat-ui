// M4-B2 用户管理页：账号表格 + 建号表单 + 行内重置密码/停用启用；操作后刷新；
// 管理留痕（audit-ops）折叠展示。写操作全部经 BFF /api/admin/users*（服务端留痕）。
import { Fragment, useCallback, useEffect, useState } from "react";
import { ApiError, apiAdminAuditOps, apiAdminCreateUser, apiAdminResetPassword, apiAdminSetDisabled, apiAdminUsers } from "../../api";
import type { AdminAuditOpRow, AdminUserRow } from "../../types";
import { fmtTs } from "./format";

const ACTION_LABEL: Record<string, string> = {
  user_create: "建号",
  user_disable: "停用",
  user_enable: "启用",
  password_reset: "重置密码",
  grant_admin: "提权",
  revoke_admin: "降级",
};

/** 行内编辑态：reset=重置密码输入；disable=停用确认。 */
type Editor = { username: string; kind: "reset" | "disable" } | null;

export default function UsersPage({ me }: { me: string }) {
  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [ops, setOps] = useState<AdminAuditOpRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [showOps, setShowOps] = useState(false);

  // 建号表单
  const [newName, setNewName] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newAdmin, setNewAdmin] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // 行内编辑
  const [editor, setEditor] = useState<Editor>(null);
  const [resetPw, setResetPw] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [u, o] = await Promise.all([apiAdminUsers(), apiAdminAuditOps()]);
      setUsers(u);
      setOps(o);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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

  const createUser = () =>
    guard(async () => {
      const name = newName.trim();
      if (!name || newPw.length < 8) {
        setFormError(name ? "密码至少 8 位" : "用户名不能为空");
        return;
      }
      setFormError(null);
      await apiAdminCreateUser(name, newPw, newAdmin);
      setNewName("");
      setNewPw("");
      setNewAdmin(false);
      await refresh();
    });

  const commitReset = (username: string) =>
    guard(async () => {
      if (resetPw.length < 8) {
        setError("密码至少 8 位");
        return;
      }
      await apiAdminResetPassword(username, resetPw);
      setEditor(null);
      setResetPw("");
      await refresh();
    });

  const setDisabled = (username: string, disabled: boolean) =>
    guard(async () => {
      await apiAdminSetDisabled(username, disabled);
      setEditor(null);
      await refresh();
    });

  return (
    <div className="mx-auto max-w-4xl px-6 py-5">
      {error && <div className="mb-4 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}
      {formError && <div className="mb-4 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{formError}</div>}

      {/* 建号表单 */}
      <section className="mb-6 rounded-lg border border-line bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">新建账号</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="w-40 rounded border border-line bg-card px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
            placeholder="用户名"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            disabled={busy}
          />
          <input
            className="w-48 rounded border border-line bg-card px-2.5 py-1.5 text-xs text-ink outline-none focus:border-accent"
            type="password"
            placeholder="密码（≥8 位）"
            value={newPw}
            onChange={(e) => setNewPw(e.target.value)}
            disabled={busy}
          />
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            <input
              type="checkbox"
              className="accent-accent"
              checked={newAdmin}
              onChange={(e) => setNewAdmin(e.target.checked)}
              disabled={busy}
            />
            管理员
          </label>
          <button
            type="button"
            className="rounded bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy || !newName.trim() || newPw.length < 8}
            onClick={createUser}
          >
            建号
          </button>
        </div>
      </section>

      {/* 账号表格 */}
      <section className="mb-6 overflow-hidden rounded-lg border border-line bg-panel">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="px-4 py-2.5 font-medium">用户名</th>
              <th className="px-4 py-2.5 font-medium">角色</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 font-medium">创建时间</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {!loaded && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-3">
                  加载中…
                </td>
              </tr>
            )}
            {loaded && users.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-ink-3">
                  （无账号）
                </td>
              </tr>
            )}
            {users.map((u) => (
              <Fragment key={u.username}>
                <tr className="border-b border-line/60 last:border-b-0">
                  <td className="px-4 py-2.5 text-ink">
                    {u.username}
                    {u.username === me && <span className="ml-1.5 text-[10px] text-ink-3">（我）</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-2">{u.is_admin === 1 ? "管理员" : "普通"}</td>
                  <td className="px-4 py-2.5">
                    {u.disabled === 1 ? <span className="text-bad">已停用</span> : <span className="text-good">正常</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-3">{fmtTs(u.created_at)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        type="button"
                        className="rounded border border-line px-2 py-0.5 text-ink-2 transition-colors hover:border-accent hover:text-ink"
                        disabled={busy}
                        onClick={() => {
                          setEditor(editor?.username === u.username && editor.kind === "reset" ? null : { username: u.username, kind: "reset" });
                          setResetPw("");
                        }}
                      >
                        重置密码
                      </button>
                      {u.disabled === 1 ? (
                        <button
                          type="button"
                          className="rounded border border-line px-2 py-0.5 text-good transition-colors hover:border-good"
                          disabled={busy}
                          onClick={() => setDisabled(u.username, false)}
                        >
                          启用
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="rounded border border-line px-2 py-0.5 text-ink-2 transition-colors hover:border-bad hover:text-bad"
                          disabled={busy || u.username === me} // 不能停用自己（服务端也拒）
                          title={u.username === me ? "不能停用自己" : undefined}
                          onClick={() => setEditor(editor?.username === u.username && editor.kind === "disable" ? null : { username: u.username, kind: "disable" })}
                        >
                          停用
                        </button>
                      )}
                    </span>
                  </td>
                </tr>
                {editor?.username === u.username && editor.kind === "reset" && (
                  <tr className="border-b border-line/60 bg-lift/40">
                    <td colSpan={5} className="px-4 py-2.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-ink-3">为 {u.username} 设置新密码（≥8 位）：</span>
                        <input
                          autoFocus
                          className="w-48 rounded border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                          type="password"
                          value={resetPw}
                          onChange={(e) => setResetPw(e.target.value)}
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className="rounded bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-2 disabled:opacity-50"
                          disabled={busy || resetPw.length < 8}
                          onClick={() => commitReset(u.username)}
                        >
                          确认重置
                        </button>
                        <button type="button" className="rounded px-2 py-1 text-xs text-ink-3 hover:text-ink" onClick={() => setEditor(null)}>
                          取消
                        </button>
                      </span>
                    </td>
                  </tr>
                )}
                {editor?.username === u.username && editor.kind === "disable" && (
                  <tr className="border-b border-line/60 bg-lift/40">
                    <td colSpan={5} className="px-4 py-2.5">
                      <span className="flex items-center gap-2">
                        <span className="text-ink-3">停用后 {u.username} 将无法登录（可再启用）。</span>
                        <button
                          type="button"
                          className="rounded bg-bad/80 px-2.5 py-1 text-xs text-white hover:bg-bad disabled:opacity-50"
                          disabled={busy}
                          onClick={() => setDisabled(u.username, true)}
                        >
                          确认停用
                        </button>
                        <button type="button" className="rounded px-2 py-1 text-xs text-ink-3 hover:text-ink" onClick={() => setEditor(null)}>
                          取消
                        </button>
                      </span>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>

      {/* 管理留痕（折叠） */}
      <section className="rounded-lg border border-line bg-panel">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-ink"
          onClick={() => setShowOps(!showOps)}
        >
          <span>管理留痕（最近 {ops.length} 条）</span>
          <span className="text-xs text-ink-3">{showOps ? "收起 ▲" : "展开 ▼"}</span>
        </button>
        {showOps && (
          <table className="w-full border-t border-line text-xs">
            <thead>
              <tr className="text-left text-ink-3">
                <th className="px-4 py-2 font-medium">时间</th>
                <th className="px-4 py-2 font-medium">操作者</th>
                <th className="px-4 py-2 font-medium">动作</th>
                <th className="px-4 py-2 font-medium">对象</th>
                <th className="px-4 py-2 font-medium">备注</th>
              </tr>
            </thead>
            <tbody>
              {ops.map((o) => (
                <tr key={o.id} className="border-t border-line/60">
                  <td className="px-4 py-1.5 text-ink-3">{fmtTs(o.created_at)}</td>
                  <td className="px-4 py-1.5 text-ink-2">{o.username}</td>
                  <td className="px-4 py-1.5 text-ink">{ACTION_LABEL[o.action] ?? o.action}</td>
                  <td className="px-4 py-1.5 text-ink-2">{o.target}</td>
                  <td className="px-4 py-1.5 text-ink-3">{o.detail ?? "—"}</td>
                </tr>
              ))}
              {ops.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-4 text-center text-ink-3">
                    （暂无留痕）
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
