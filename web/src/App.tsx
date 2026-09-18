// UI-T5 应用根：启动探测 /api/me（401→登录屏，200→直接进主页）+ 登录/登出状态机。
// v1 无路由库：两屏（登录/主页）由 boot 状态切换；/report 预览壳在 main.tsx 分流（UI-T7）。
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiCreateSession, apiListSessions, apiLogout, apiMe } from "./api";
import type { UiSession } from "./types";
import LoginScreen from "./components/LoginScreen";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";

type Boot = { kind: "loading" } | { kind: "login" } | { kind: "ready"; username: string };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const [sessions, setSessions] = useState<UiSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const enter = useCallback(async (username: string) => {
    setSessions(await apiListSessions());
    setActiveId(null); // 进入时停在新会话态（首问自动建会话，UI-T6）
    setBoot({ kind: "ready", username });
  }, []);

  useEffect(() => {
    apiMe()
      .then((u) => enter(u.username))
      .catch(() => setBoot({ kind: "login" })); // 401/网络错 → 登录屏
  }, [enter]);

  const refreshSessions = useCallback(async () => {
    setSessions(await apiListSessions());
  }, []);

  if (boot.kind === "loading") {
    return (
      <div className="flex h-full items-center justify-center bg-base text-sm text-ink-3">加载中…</div>
    );
  }
  if (boot.kind === "login") {
    return <LoginScreen onSuccess={enter} />;
  }

  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="flex h-full">
      <Sidebar
        username={boot.username}
        sessions={sessions}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={async () => {
          const s = await apiCreateSession();
          await refreshSessions();
          setActiveId(s.id); // 建带默认标题的空会话并选中；不选 = 首问自动建（UI-T6）
        }}
        onChanged={refreshSessions}
        onActiveDeleted={() => setActiveId(null)}
        onLogout={async () => {
          try {
            await apiLogout();
          } catch (err) {
            if (!(err instanceof ApiError)) throw err; // 网络层异常上抛；401 也视作已登出
          }
          setSessions([]);
          setActiveId(null);
          setBoot({ kind: "login" });
        }}
      />
      <ChatView
        sessionId={active?.id ?? null}
        sessionTitle={active?.title ?? "新会话"}
        onFirstAsk={(id) => {
          setActiveId(id); // 首问成功：BFF 已自动建会话（标题=首问前 30 字），切入并刷列表
          void refreshSessions();
        }}
        onSessionActivity={() => void refreshSessions()}
      />
    </div>
  );
}
