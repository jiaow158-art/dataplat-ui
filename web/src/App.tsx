// UI-T5 应用根：启动探测 /api/me（401→登录屏，200→直接进主页）+ 登录/登出状态机。
// v1 无路由库：登录/主页由 boot 状态切换；管理后台（M4）为 state 路由子视图——
// 仅 /api/me.is_admin=1 时渲染入口，chat/admin 两视图共享侧栏导航。
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiCreateSession, apiInsightEnabled, apiListSessions, apiLogout, apiMe } from "./api";
import type { UiSession } from "./types";
import LoginScreen from "./components/LoginScreen";
import Sidebar from "./components/Sidebar";
import ChatView from "./components/ChatView";
import AdminView from "./components/admin/AdminView";
import OperatingDashboardPage from "./components/insights/OperatingDashboardPage";
import EventDetailPage from "./components/insights/EventDetailPage";
import EventCenterPage from "./components/insights/EventCenterPage";
import MySubscriptionsPage from "./components/insights/MySubscriptionsPage";
import TargetManagementPage from "./components/insights/TargetManagementPage";
import RegionBattleMapPage from "./components/insights/RegionBattleMapPage";

type Boot = { kind: "loading" } | { kind: "login" } | { kind: "ready"; username: string; isAdmin: boolean };

export default function App() {
  const [boot, setBoot] = useState<Boot>({ kind: "loading" });
  const [sessions, setSessions] = useState<UiSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [view, setView] = useState<"chat" | "admin" | "insights" | "events" | "subscriptions" | "targets" | "regions">("chat");
  const [insightsOn, setInsightsOn] = useState(false);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [detailSource, setDetailSource] = useState<"insights" | "events" | "regions">("insights"); // P0 边界3——详情页侧栏高亮跟来源页
  const [followupSeed, setFollowupSeed] = useState<{ sessionId: string; question: string } | null>(null);

  const enter = useCallback(async (username: string, isAdmin: boolean) => {
    setSessions(await apiListSessions());
    // 驾驶舱 flag 探测（两条进入路径都经 enter：启动 /api/me 链与登录成功链）；失败=功能关，不挡登录。
    const on = await apiInsightEnabled().then((r) => r.enabled).catch(() => false);
    setInsightsOn(on);
    setActiveId(null); // 进入时停在新会话态（首问自动建会话，UI-T6）
    setView(on ? "insights" : "chat"); // flag 开：登录默认落地驾驶舱
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

  // P1-2 区域页「让AI分析」：预建会话→种 followup 问题→切对话（同 followup 编排；ChatView autoAsk 需已存在会话）
  const askSeed = useCallback(async (question: string) => {
    const s = await apiCreateSession();
    await refreshSessions();
    setActiveId(s.id);
    setFollowupSeed({ sessionId: s.id, question });
    setView("chat");
  }, [refreshSessions]);

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
        activeView={view === "insights" && openEventId ? detailSource : view} // 详情打开中（仅 insights 分支渲染）：侧栏高亮来源页
        isAdmin={boot.isAdmin}
        onAdmin={() => setView("admin")}
        insightsEnabled={insightsOn}
        onInsights={() => {
          setView("insights");
          setOpenEventId(null);
        }}
        onEventCenter={() => setView("events")}
        onSubscriptions={() => setView("subscriptions")}
        onTargets={() => setView("targets")}
        onRegionMap={() => setView("regions")}
        onChat={() => setView("chat")}
        onSelect={(id) => {
          setActiveId(id);
          setView("chat"); // 驾驶舱/管理后台视图下点会话 → 切回对话（此前只改 activeId，主区停在驾驶舱回不去）
        }}
        onNew={async () => {
          const s = await apiCreateSession();
          await refreshSessions();
          setActiveId(s.id); // 建带默认标题的空会话并选中；不选 = 首问自动建（UI-T6）
          setView("chat");
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
      ) : view === "subscriptions" && insightsOn ? (
        <MySubscriptionsPage />
      ) : view === "events" && insightsOn ? (
        <EventCenterPage
          onOpenEvent={(id) => {
            setDetailSource("events");
            setOpenEventId(id);
            setView("insights"); // 详情页渲染在 insights 分支：设 id 的同时切视图才真的打开
          }}
          onFollowed={(r) => {
            // 与 EventDetailPage 同一编排（D-e7）：种下追问→切对话→刷会话列表
            setFollowupSeed({ sessionId: r.uiSessionId, question: r.seedQuestion });
            setActiveId(r.uiSessionId);
            setView("chat");
            void refreshSessions();
          }}
        />
      ) : view === "targets" && insightsOn ? (
        <TargetManagementPage />
      ) : view === "regions" && insightsOn ? (
        <RegionBattleMapPage
          onOpenEvent={(id) => {
            setDetailSource("regions");
            setOpenEventId(id);
            setView("insights"); // 详情页渲染在 insights 分支：设 id 的同时切视图才真的打开
          }}
          onOpenEventCenter={() => setView("events")}
          onAsk={(q) => void askSeed(q)}
        />
      ) : view === "insights" && insightsOn ? (
        openEventId ? (
          <EventDetailPage
            eventId={openEventId}
            onBack={() => {
              setOpenEventId(null);
              setView(detailSource); // 返回来源页
            }}
            onOpenEvent={(id) => setOpenEventId(id)}
            onFollowed={(r) => {
              setFollowupSeed({ sessionId: r.uiSessionId, question: r.seedQuestion });
              setActiveId(r.uiSessionId);
              setView("chat");
              void refreshSessions();
            }}
          />
        ) : (
          <OperatingDashboardPage
            onOpenEvent={(id) => {
              setDetailSource("insights");
              setOpenEventId(id);
            }}
            onOpenEventCenter={() => setView("events")}
          />
        )
      ) : (
        <ChatView
          sessionId={active?.id ?? null}
          sessionTitle={active?.title ?? "新会话"}
          onFirstAsk={(id) => {
            setActiveId(id); // 首问成功：BFF 已自动建会话（标题=首问前 30 字），切入并刷列表
            void refreshSessions();
          }}
          onSessionActivity={() => void refreshSessions()}
          autoAsk={followupSeed && followupSeed.sessionId === (active?.id ?? null) ? followupSeed.question : undefined}
          onAutoAskDone={() => setFollowupSeed(null)}
        />
      )}
    </div>
  );
}
