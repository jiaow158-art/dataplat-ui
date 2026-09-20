// UI-T5 应用根：启动探测 /api/me（401→登录屏，200→直接进主页）+ 登录/登出状态机。
// v1 无路由库：登录/主页由 boot 状态切换；管理后台（M4）为 state 路由子视图——
// 仅 /api/me.is_admin=1 时渲染入口，chat/admin 两视图共享侧栏导航。
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiCreateSession, apiListSessions, apiLogout, apiMe } from "./api";
import type { UiSession } from "./types";
import LoginScreen from "./components/LoginScreen";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import AdminView from "./components/admin/AdminView";

type Boot = { kind: "loading" } | { kind: "login" } | { kind: "ready"; username: string; isAdmin: boolean };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const [sessions, setSessions] = useState<UiSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "admin">("chat");

  const enter = useCallback(async (username: string, isAdmin: boolean) => {
    setSessions(await apiListSessions());
    setActiveId(null); // 进入时停在新会话态（首问自动建会话，UI-T6）
    setView("chat");
    setBoot({ kind: "ready", username, isAdmin });
  }, []);

  useEffect(() => {
    apiMe()
      .then((u) => enter(u.username, u.is_admin === 1))
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
    // 登录响应不含角色——成功后再探 /api/me 取 is_admin（入口判定只信 BFF）
    return (
      <LoginScreen
        onSuccess={async () => {
          const me = await apiMe();
          await enter(me.username, me.is_admin === 1);
        }}
      />
    );
  }

  const active = sessions.find((s) => s.id === activeId) ?? null;

  return (
    <div className="flex h-full">
      <Sidebar
        username={boot.username}
        sessions={sessions}
        activeId={activeId}
        isAdmin={boot.isAdmin}
        onAdmin={() => setView("admin")}
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
          setView("chat");
          setBoot({ kind: "login" });
        }}
      />
      {view === "admin" ? (
        <AdminView username={boot.username} onBack={() => setView("chat")} />
      ) : (
        <ChatView
          sessionId={active?.id ?? null}
          sessionTitle={active?.title ?? "新会话"}
          onFirstAsk={(id) => {
            setActiveId(id); // 首问成功：BFF 已自动建会话（标题=首问前 30 字），切入并刷列表
            void refreshSessions();
          }}
          onSessionActivity={() => void refreshSessions()}
        />
      )}
    </div>
  );
}
