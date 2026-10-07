// UI-T6：单任务 SSE 消费状态机（契约 §4 SSE 语义、§6 六类事件词表）。
// 每个使用中的 run 一份实例（组件局部状态）——多标签页各开各的 EventSource，无共享可变全局。
// 断线语义：浏览器原生 EventSource 自动重连并带 Last-Event-ID，网关补发 seq>after 的历史，
// 不重不漏（D15）——客户端只显示"重连中"，不自己去重。流静默结束（reaper 终态无 done 事件）
// 由周期性 GET /api/tasks/:id/status 兜底判终态。
import { useEffect, useRef, useState } from "react";
import { apiTaskStatus } from "../api";
import type { TaskStatus } from "../types";

/** 契约 §6 stage 词表 → UI 文案（ queued 为网关状态机词，一并映射）。 */
export const STAGE_TEXT: Record<string, string> = {
  queued: "排队中",
  analyzing: "理解问题",
  querying: "查询数据",
  script_running: "运行脚本",
  report_checking: "生成报告",
  repairing: "恢复中",
  publishing: "发布报告",
};

export interface SqlRecord {
  sql: string;
  rows: number | null;
  truncated: boolean;
  elapsedMs: number | null;
}

/** stage 事件原始轨迹（P3 层2/层3 的过程数据源）：stage 词表 + 事件自带 text（工具名/原文）。
 *  只追加不去重计数——幂等由 SSE 帧级去重保证（见 listener 内 seenIds）。 */
export interface StageMark {
  stage: string;
  text: string | null;
}

export interface DoneInfo {
  status: string;
  elapsedMs: number | null;
  tokens: { input: number; output: number; cache_read: number } | null;
  recovered: boolean;
}

export interface StreamState {
  /** 事件流连接面。 */
  conn: "connecting" | "open" | "reconnecting";
  stage: string | null;
  stageText: string | null; // 事件自带 text 优先，否则词表映射
  attempt: number;
  sqls: SqlRecord[];
  /** stage 事件轨迹（按到达序追加；层2 分组/层3 工具行的唯一过程数据源）。 */
  timeline: StageMark[];
  answer: string | null;
  reportPath: string | null;
  error: { code: string; message: string } | null;
  done: DoneInfo | null;
  /** 终态（done/error 事件，或 status 兜底判定）。 */
  terminal: boolean;
  terminalFromStatus: boolean; // true = 未见 done 事件、由 GET status 收尾（可提示过程不完整）
}

const initialState = (): StreamState => ({
  conn: "connecting",
  stage: null,
  stageText: null,
  attempt: 0,
  sqls: [],
  timeline: [],
  answer: null,
  reportPath: null,
  error: null,
  done: null,
  terminal: false,
  terminalFromStatus: false,
});

/** 六类事件名。与原生 EventSource 的 error（连接错误）同名冲突，靠 data 是否为 string 区分。 */
const EVENT_TYPES = ["stage", "sql", "answer", "report", "done", "error"] as const;

export function useTaskStream(runId: string, onTerminal?: () => void): StreamState {
  const [state, setState] = useState<StreamState>(initialState);
  const stateRef = useRef<StreamState>(initialState());
  const esRef = useRef<EventSource | null>(null);
  const onTerminalRef = useRef(onTerminal);

  useEffect(() => {
    const fresh = initialState();
    stateRef.current = fresh;
    setState(fresh);
    if (!runId) return;
    // 终态双确认：status 兜底轮询连续两轮都是终态才收尾——避开"任务刚 done、
    // 事件帧还在路上"的竞态（真 done/error 事件到达时会覆盖并清掉 fromStatus 标记）。
    let statusTerminalSeen = false;
    let statusFailures = 0;

    const es = new EventSource(`/api/tasks/${encodeURIComponent(runId)}/events`);
    // 事件分发点同步维护 ref（批处理内连续事件不丢；绝不在渲染期调用）
    const patch = (p: Partial<StreamState>) => {
      const next = { ...stateRef.current, ...p };
      stateRef.current = next;
      setState(next);
    };

    const finalizeFromStatus = (st: TaskStatus) => {
      const cur = stateRef.current;
      if (cur.terminal) return;
      if (st.status !== "succeeded" && st.status !== "failed" && st.status !== "cancelled") {
        statusTerminalSeen = false;
        return;
      }
      if (!statusTerminalSeen) {
        statusTerminalSeen = true; // 第一轮只记账，给在途的 done/error 事件帧留一个轮询周期
        return;
      }
      if (st.status === "succeeded" || st.status === "cancelled") {
        patch({ done: { status: st.status, elapsedMs: null, tokens: null, recovered: false }, terminal: true, terminalFromStatus: true });
      } else {
        patch({
          error: { code: st.error_code ?? "ENGINE_ERROR", message: "任务执行失败（未收到失败详情事件）" },
          terminal: true,
          terminalFromStatus: true,
        });
      }
    };

    const pollStatus = async () => {
      try {
        statusFailures = 0;
        finalizeFromStatus(await apiTaskStatus(runId));
      } catch {
        // BFF/网关不可达：连续两轮失败即视为连接面故障（半开 TCP 下 EventSource 不会立刻
        // onerror），提示"重连中"；恢复后由重连补发或本轮询收尾。
        statusFailures += 1;
        if (statusFailures >= 2 && !stateRef.current.terminal) patch({ conn: "reconnecting" });
      }
    };

    const handle = (type: string, raw: unknown) => {
      let p: any;
      try {
        p = JSON.parse(String(raw));
      } catch {
        return; // 非 JSON payload 忽略
      }
      const cur = stateRef.current;
      switch (type) {
        case "stage": {
          const stage = typeof p.stage === "string" ? p.stage : "";
          const text = typeof p.text === "string" && p.text ? p.text : (STAGE_TEXT[stage] ?? stage);
          patch({
            stage,
            stageText: text,
            attempt: typeof p.attempt === "number" ? p.attempt : cur.attempt,
            // 原始 text（非词表兜底值）入轨迹：层3 工具行展示用
            timeline: [...cur.timeline, { stage, text: typeof p.text === "string" ? p.text : null }],
          });
          break;
        }
        case "sql":
          patch({
            sqls: [
              ...cur.sqls,
              {
                sql: typeof p.sql === "string" ? p.sql : "",
                rows: typeof p.rows === "number" ? p.rows : null,
                truncated: p.truncated === true,
                elapsedMs: typeof p.elapsed_ms === "number" ? p.elapsed_ms : null,
              },
            ],
          });
          break;
        case "answer":
          if (typeof p.markdown === "string") patch({ answer: p.markdown });
          break;
        case "report":
          if (typeof p.path === "string") patch({ reportPath: p.path });
          break;
        case "done":
          patch({
            done: {
              status: typeof p.status === "string" ? p.status : "succeeded",
              elapsedMs: typeof p.elapsed_ms === "number" ? p.elapsed_ms : null,
              tokens:
                p.tokens && typeof p.tokens.input === "number"
                  ? {
                      input: p.tokens.input,
                      output: typeof p.tokens.output === "number" ? p.tokens.output : 0,
                      cache_read: typeof p.tokens.cache_read === "number" ? p.tokens.cache_read : 0,
                    }
                  : null,
              recovered: p.recovered === true,
            },
            terminal: true,
            terminalFromStatus: false, // 真 done 事件到达：以事件为准，覆盖此前的 status 兜底
          });
          es.close(); // done 后关流（契约 §4）
          break;
        case "error":
          // 终态展示即定，但流不关：网关在 error 后仍发 done（status/elapsed/tokens）并主动关流，
          // 提前断开会连带断掉 BFF↔网关管道，done 途经不了代理 → 记账 status 永远停在 queued。
          patch({
            error: { code: String(p.code ?? "UNKNOWN"), message: String(p.message ?? "未知错误") },
            terminal: true,
            terminalFromStatus: false,
          });
          break;
      }
    };

    // P3 边界2（重连幂等）：网关每帧带 `id: seq`，BFF 字节透传，重连补发按 Last-Event-ID 裁剪——
    // 正常路径本无重复帧；此守卫是防御纵深（Last-Event-ID 丢失/代理重启等场景的重叠帧）：
    // 按 lastEventId 丢弃重复帧，保证 timeline/计数/SQL 列表在重连后绝不翻倍。
    // 刷新/重挂场景（全新 EventSource、无 Last-Event-ID → 网关从 seq 0 全量重放）不受影响：
    // 本 effect 先建 fresh state + 空 seenIds，全量重放正是所需。
    const seenIds = new Set<string>();
    for (const t of EVENT_TYPES) {
      es.addEventListener(t, (ev) => {
        if (t === "error" && typeof (ev as MessageEvent).data !== "string") {
          // 原生连接错误（与 SSE error 事件同名）：CLOSED=致命（BFF 非 200 等）→ 关流走 status 兜底；
          // 否则浏览器将自动重连（自带 Last-Event-ID），只提示"重连中"。
          if (es.readyState === EventSource.CLOSED) {
            es.close();
            patch({ conn: "reconnecting" });
            void pollStatus();
          } else {
            patch({ conn: "reconnecting" });
          }
          return;
        }
        const sid = (ev as MessageEvent).lastEventId;
        if (sid) {
          if (seenIds.has(sid)) return; // 与已收帧重叠（同 seq）：幂等丢弃
          seenIds.add(sid);
        }
        handle(t, (ev as MessageEvent).data);
      });
    }
    es.onopen = () => patch({ conn: "open" });

    // 终态兜底轮询：流可能静默结束（reaper 收尾无 done 事件）或卡死——每 8s 以任务状态对账一次。
    const poller = setInterval(() => {
      if (!stateRef.current.terminal) void pollStatus();
    }, 8000);

    esRef.current = es;
    return () => {
      clearInterval(poller);
      es.close();
      if (esRef.current === es) esRef.current = null;
    };
  }, [runId]);

  // 关流时机：done 事件后（契约 §4）或 status 兜底收尾（不会再有 done）。
  // 仅收到 error 事件时保持连接等 done 途经 BFF 落账（见上）。
  useEffect(() => {
    if (state.terminal && (state.done !== null || state.terminalFromStatus)) esRef.current?.close();
  }, [state.terminal, state.done, state.terminalFromStatus]);

  // 终态回调（用于刷新会话列表等旁路动作）
  useEffect(() => {
    if (state.terminal) onTerminalRef.current?.();
  }, [state.terminal]);

  return state;
}
