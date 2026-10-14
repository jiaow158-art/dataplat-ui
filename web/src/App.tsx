// UI-T5 应用根：启动探测 /api/me（401→登录屏，200→直接进主页）+ 登录/登出状态机。
// v1 无路由库：登录/主页由 boot 状态切换；管理后台（M4）为 state 路由子视图——
// 仅 /api/me.is_admin=1 时渲染入口，chat/admin 两视图共享侧栏导航。
// P2-a 事件详情 = fixed 全屏 overlay：打开只设 openEventId 不切 view，来源页保持 mounted
// （筛选/选中/滚动在关闭后原样保留）；浏览器 Back / ESC / 返回按钮三条关闭路径同语义。
import { useCallback, useEffect, useState } from "react";
import { ApiError, apiCreateSession, apiInsightEnabled, apiListSessions, apiLogout, apiMe, getAuthEpoch } from "./api";
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
  const [detailSource, setDetailSource] = useState<"insights" | "events" | "regions" | "targets">("insights"); // 来源语义保留（P0 边界3）；overlay 模型下侧栏高亮恒跟 view，渲染不再读取
  const [followupSeed, setFollowupSeed] = useState<{ sessionId: string; question: string } | null>(null);
  // P2-b B2：事件中心→区域页的一次性聚焦（transient：区域页消费即回执清零，selectedRegion 不上提）
  const [regionFocus, setRegionFocus] = useState<string | null>(null);
  void detailSource; // 安抚 noUnusedLocals：状态保留供后续「返回来源」语义使用，各 onOpenEvent 仍照常赋值

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

  // 会话被吊销（停用/踢出/改密/单会话被新登录顶替）：任何 API 401 广播 → 弹回登录屏。
  // 纪元守卫：只处理「请求纪元 == 当前纪元」的 401——被踢后已重新登录（apiLogin 已
  // bumpAuthEpoch）时，旧登录态在途请求的迟到 401 不误伤新登录态。boot 切 login 即卸载
  // 主视图（useTaskStream 的 EventSource 随 unmount 清理）；SSE 流被服务端掐断后经
  // status 轮询 401 走同一链路。
  useEffect(() => {
    const onUnauthorized = (ev: Event) => {
      const epoch = (ev as CustomEvent<{ epoch?: number }>).detail?.epoch;
      if (epoch !== getAuthEpoch()) return; // 迟到 401：登录态已换代，忽略
      setBoot({ kind: "login" });
    };
    window.addEventListener("bff-unauthorized", onUnauthorized);
    return () => window.removeEventListener("bff-unauthorized", onUnauthorized);
  }, []);

  // 空闲页面主动复查：登录态下每 30s、窗口重新聚焦/切回可见时立即探一次 /api/me——被停用/
  // 被顶替的无操作页面不必等下一次业务请求才发现失效。探活失败不在此分支处理：401 走上面的
  // bff-unauthorized 广播（带纪元防迟到误伤），其他错误（网络抖动）不应踢人。只读 /api/me，
  // 不碰问数业务链路；boot 离开 ready（登出/被踢/组件卸载）即清理定时器与监听。
  useEffect(() => {
    if (boot.kind !== "ready") return;
    const check = () => {
      void apiMe().catch(() => {});
    };
    const onFocus = () => check();
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    const timer = setInterval(check, 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [boot.kind]);

  const refreshSessions = useCallback(async () => {
    setSessions(await apiListSessions());
  }, []);

  // P4 自动标题：ask 受理后 LLM 标题数秒内异步落库——补两次延迟轻刷让侧栏无刷新换标题
  // （sessions 受控更新原地 diff；标题落库不动 updated_at，顺序与高亮天然不跳位——裁定 b）。
  const scheduleTitleRefresh = useCallback(() => {
    setTimeout(() => void refreshSessions(), 8000);
    setTimeout(() => void refreshSessions(), 20000);
  }, [refreshSessions]);

  // ===== P2-a 详情 overlay 开合 =====
  // 边界1：Back / ESC / 返回按钮同语义——都只关 overlay，view 与来源页状态不动。
  const closeDetail = useCallback(() => {
    // 仅真开着才消费压栈条目（防刷新后残留 stale 标记的幽灵 back）；幂等：popstate 再触发时已 null
    if (openEventId && history.state?.insightDetail) history.back();
    setOpenEventId(null);
  }, [openEventId]);
  // 打开（null→id 跳变）时压栈一条；嵌套跳转（overlay 内换事件）不重复压栈，Back 一次即关
  const overlayOpen = openEventId !== null;
  useEffect(() => {
    if (overlayOpen) history.pushState({ insightDetail: true }, "");
  }, [overlayOpen]);
  // 浏览器 Back → popstate：还开着就关（不再额外 back，避免双退）
  useEffect(() => {
    const onPop = () => setOpenEventId((cur) => (cur ? null : cur));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // ESC 关 overlay
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && openEventId) closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openEventId, closeDetail]);

  // P1-2 区域页「让AI分析」：预建会话→种 followup 问题→切对话（同 followup 编排；ChatView autoAsk 需已存在会话）。
  // 定义在 closeDetail 之后：closeDetail 入 deps，防 stale 闭包漏消费 history 条目。
  // P4 titleHint：驾驶舱入口的确定性语义标题（hint 来源，自动标题永不覆盖；presentation only 不进模型）。
  const askSeed = useCallback(async (question: string, titleHint?: string) => {
    const s = await apiCreateSession(titleHint);
    await refreshSessions();
    setActiveId(s.id);
    setFollowupSeed({ sessionId: s.id, question });
    closeDetail(); // 由此切走视图同样收起 overlay（幂等）
    setView("chat");
  }, [refreshSessions, closeDetail]);

  // P2-b B2：事件→区域作战地图（事件中心只对唯一大区足迹出链接）：种一次性 focus 并切视图
  const openRegionFocus = useCallback((r: string) => {
    closeDetail(); // 导航统一关 overlay（review P2-b finding 1，键盘路径可达）
    setRegionFocus(r);
    setView("regions");
  }, [closeDetail]);

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
        activeView={view} // overlay 模型：打开详情不再切 view，来源页侧栏高亮天然保持
        isAdmin={boot.isAdmin}
        onAdmin={() => {
          closeDetail(); // 任何导航离开都先关 overlay（幂等，含 history 条目消费）
          setView("admin");
        }}
        insightsEnabled={insightsOn}
        onInsights={() => {
          closeDetail();
          setView("insights");
        }}
        onEventCenter={() => {
          closeDetail();
          setView("events");
        }}
        onSubscriptions={() => {
          closeDetail();
          setView("subscriptions");
        }}
        onTargets={() => {
          closeDetail();
          setView("targets");
        }}
        onRegionMap={() => {
          closeDetail();
          setView("regions");
        }}
        onChat={() => {
          closeDetail();
          setView("chat");
        }}
        onSelect={(id) => {
          closeDetail();
          setActiveId(id);
          setView("chat"); // 驾驶舱/管理后台视图下点会话 → 切回对话（此前只改 activeId，主区停在驾驶舱回不去）
        }}
        onNew={async () => {
          const s = await apiCreateSession();
          await refreshSessions();
          closeDetail();
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
          closeDetail(); // 登出即关 overlay，防止换账号重登后复活上一账号的详情
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
            setOpenEventId(id); // 只开 overlay，不切 view——事件中心保持 mounted（筛选/滚动保留）
          }}
          onFollowed={(r) => {
            // 与 EventDetailPage 同一编排（D-e7）：种下追问→切对话→刷会话列表
            setFollowupSeed({ sessionId: r.uiSessionId, question: r.seedQuestion });
            setActiveId(r.uiSessionId);
            closeDetail();
            setView("chat");
            void refreshSessions();
          }}
          onOpenRegion={openRegionFocus}
          onOpenTargetPage={() => { closeDetail(); setView("targets"); }} // B3：target_gap 类型级跳转
        />
      ) : view === "targets" && insightsOn ? (
        <TargetManagementPage
          onOpenEvent={(id) => {
            setDetailSource("targets");
            setOpenEventId(id); // 只开 overlay，不切 view
          }}
          onAsk={(q, titleHint) => void askSeed(q, titleHint)}
        />
      ) : view === "regions" && insightsOn ? (
        <RegionBattleMapPage
          onOpenEvent={(id) => {
            setDetailSource("regions");
            setOpenEventId(id); // 只开 overlay，不切 view——selectedRegion+metric 保留
          }}
          onOpenEventCenter={() => {
            closeDetail(); // 跳事件中心同属导航离开，先关 overlay（幂等）
            setView("events");
          }}
          onAsk={(q, titleHint) => void askSeed(q, titleHint)}
          focusRegion={regionFocus}
          onFocusRegionHandled={() => setRegionFocus(null)}
        />
      ) : view === "insights" && insightsOn ? (
        <OperatingDashboardPage
          onOpenEvent={(id) => {
            setDetailSource("insights");
            setOpenEventId(id); // 只开 overlay，驾驶舱保持 mounted
          }}
          onOpenEventCenter={() => {
            closeDetail(); // 跳事件中心同属导航离开，先关 overlay（幂等）
            setView("events");
          }}
          onOpenTarget={() => { closeDetail(); setView("targets"); }} // B1：经营概览·目标进度 → 目标管理
        />
      ) : (
        <ChatView
          sessionId={active?.id ?? null}
          sessionTitle={active?.title ?? "新会话"}
          isAdmin={boot.isAdmin}
          onFirstAsk={(id) => {
            setActiveId(id); // 首问成功：BFF 已自动建会话（初始「新会话」，LLM 标题稍后落库），切入并刷列表
            void refreshSessions();
            scheduleTitleRefresh(); // 异步标题落库后的侧栏轻刷
          }}
          onSessionActivity={() => {
            void refreshSessions();
            scheduleTitleRefresh();
          }}
          autoAsk={followupSeed && followupSeed.sessionId === (active?.id ?? null) ? followupSeed.question : undefined}
          onAutoAskDone={() => setFollowupSeed(null)}
        />
      )}
      {/* P2-a 事件详情 overlay：fixed 全屏（不占 flex 流，root/aside 结构不动），来源页在下方保持
          mounted——关闭后筛选/选中/滚动原样保留，且不触发底层页刷新（边界3）。
          边界2：chat/admin 无入口打开详情，防御性排除兜底。 */}
      {openEventId && insightsOn && view !== "chat" && view !== "admin" && (
        <div className="fixed inset-0 z-40 flex flex-col bg-ck-bg" role="dialog" aria-modal="true">
          <EventDetailPage
            key={openEventId} // 换事件即重挂载：嵌套跳转回到顶部，不带旧事件残留态
            eventId={openEventId}
            onBack={closeDetail} // 边界1：只关 overlay，view 不动即回来源页
            onOpenEvent={(id) => setOpenEventId(id)} // 嵌套跳转：换 overlay 内容，底下来源页不动
            onFollowed={(r) => {
              // 与事件中心同一编排（D-e7）：种追问→切对话→刷会话列表；同时收起 overlay
              setFollowupSeed({ sessionId: r.uiSessionId, question: r.seedQuestion });
              setActiveId(r.uiSessionId);
              closeDetail();
              setView("chat");
              void refreshSessions();
            }}
          />
        </div>
      )}
    </div>
  );
}
