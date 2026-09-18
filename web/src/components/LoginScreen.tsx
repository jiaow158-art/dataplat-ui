// UI-T5 登录屏：用户名/密码 + 错误提示 + 提交中态。成功后由父级切入应用壳。
import { useState, type FormEvent } from "react";
import { ApiError, apiLogin } from "../api";

export default function LoginScreen({ onSuccess }: { onSuccess: (username: string) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || !username.trim() || !password) return;
    setBusy(true);
    setError(null);
    try {
      const { username: name } = await apiLogin(username.trim(), password);
      onSuccess(name);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败，请重试");
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-base px-4">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-line bg-panel p-8 shadow-xl"
      >
        <div className="mb-1 text-center text-xs font-semibold tracking-[0.3em] text-accent uppercase">
          Dongpeng
        </div>
        <h1 className="mb-8 text-center text-xl font-semibold text-ink">东鹏问数系统</h1>

        <label className="mb-1 block text-xs text-ink-2" htmlFor="login-username">
          用户名
        </label>
        <input
          id="login-username"
          className="mb-4 w-full rounded border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={busy}
        />

        <label className="mb-1 block text-xs text-ink-2" htmlFor="login-password">
          密码
        </label>
        <input
          id="login-password"
          type="password"
          className="mb-6 w-full rounded border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={busy}
        />

        {error && (
          <div className="mb-4 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">
            {error}
          </div>
        )}

        <button
          type="submit"
          className="w-full rounded bg-accent py-2 text-sm font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || !username.trim() || !password}
        >
          {busy ? "登录中…" : "登 录"}
        </button>
      </form>
    </div>
  );
}
