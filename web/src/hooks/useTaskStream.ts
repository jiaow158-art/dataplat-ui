// UI-T6：单任务 SSE 消费状态机（契约 §4 SSE 语义、§6 六类事件词表）。
// 每个使用中的 run 一份实例（组件局部状态）——多标签页各开各的 EventSource，无共享可变全局。
// 断线语义：浏览器原生 EventSource 自动重连并带 Last-Event-ID，网关补发 seq>after 的历史，
// 不重不漏（D15）——客户端只显示"重连中"，不自己去重。
//
// S4-B2-C2-B2-3-UI：cleanup recovery 兼容：
//   - CLEANUP_RECOVERY_REQUIRED 不是业务 terminal，不触发 onTerminal，不自动 retry；
//   - 收到该 error 后关闭 EventSource，改由低频 GET 观察真实状态；
//   - 204/CLOSED 不无限重连，GET 会确认是否仍 recovery；
//   - failed/cancelled done 后主动 GET 一次，读取可选 recovery_required；
//   - hold 解除且任务继续运行后，用真实 last seq（绝不用合成 id）重建事件流。
import { useEffect, useRef, useState } from "react";
import { apiTaskStatus } from "../api.ts";
import type { TaskStatus } from "../types.ts";

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

export type StreamConnection = "connecting" | "open" | "reconnecting" | "recovering";

export interface StreamState {
  /** 事件流连接面。 */
  conn: StreamConnection;
  stage: string | null;
  stageText: string | null; // 事件自带 text 优先，否则词表映射
  attempt: number;
  sqls: SqlRecord[];
  /** stage 事件轨迹（按到达序追加；层2 分组/层3 工具行的唯一过程数据源）。 */
  timeline: StageMark[];
  answer: string | null;
  reportPath: string | null;
  /** 真实业务错误；cleanup recovery 不写入这里，避免误显示“未知错误”。 */
  error: { code: string; message: string } | null;
  done: DoneInfo | null;
  /** 真实业务终态（done/error 事件，或 GET status 兜底判定）。 */
  terminal: boolean;
  terminalFromStatus: boolean; // true = 未见 done 事件、由 GET status 收尾（可提示过程不完整）
  /** 资源清理尚未确认，等待人工恢复；独立于业务 terminal。 */
  recoveryRequired: boolean;
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
  recoveryRequired: false,
});

/** 六类事件名。与原生 EventSource 的 error（连接错误）同名冲突，靠 data 是否为 string 区分。 */
const EVENT_TYPES = ["stage", "sql", "answer", "report", "done", "error"] as const;

/** 与 Gateway `CLEANUP_RECOVERY_SSE_CODE` 同值；只在 UI 做语义分派，不泄漏到文案。 */
export const CLEANUP_RECOVERY_CODE = "CLEANUP_RECOVERY_REQUIRED";

/**
 * Gateway 合成 SSE 游标保留区下界。UI 只用它区分“真实事件 seq”与 recovery 通知游标；
 * 绝不把保留区 id 作为 after/+1/业务游标。真实 seq 远低于该值（契约 §4.1）。
 */
export const SYNTHETIC_SSE_ID_MIN = 1_000_000_000;

/** 历史侧仅对可能有 cleanup recovery 的业务终态补查 GET。 */
export function shouldQueryHistoricalRecovery(status: string): boolean {
  return status === "failed" || status === "cancelled";
}

/** Recovery 独立提示文案：业务终态与资源恢复并存时两条信息都不丢失。 */
export function recoveryNoticeText(s: Pick<StreamState, "done" | "terminal">): {
  title: string;
  detail: string;
} {
  const businessStatus = s.done?.status;
  const businessEnded =
    businessStatus === "failed"
      ? "业务任务已结束（失败）"
      : businessStatus === "cancelled"
        ? "业务任务已结束（已取消）"
        : s.terminal
          ? "业务任务已结束"
          : null;
  return {
    title: "任务中断，等待恢复",
    detail: businessEnded ? `${businessEnded}；资源仍待恢复。` : "资源仍待恢复，暂不可重试。",
  };
}

const STATUS_POLL_MS = 8_000;
const ES_CLOSED = 2;
const TERMINAL_STATUS = new Set(["succeeded", "failed", "cancelled"]);

export interface StreamEventSource {
  addEventListener(type: string, listener: (event: MessageEvent) => void): void;
  close(): void;
  onopen: (() => void) | null;
  readonly readyState: number;
}

export interface TaskStreamControllerOptions {
  runId: string;
  onState: (state: StreamState) => void;
  fetchStatus: (runId: string) => Promise<TaskStatus>;
  createEventSource?: (url: string) => StreamEventSource;
  pollIntervalMs?: number;
  setTimeoutFn?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  clearTimeoutFn?: (handle: ReturnType<typeof setTimeout>) => void;
}

/**
 * 纯控制器：不依赖 React/DOM，便于用假 EventSource/GET/计时器测试生命周期。
 * useTaskStream 只负责把 onState 映射到 React state。
 */
export class TaskStreamController {
  private readonly runId: string;
  private readonly onState: (state: StreamState) => void;
  private readonly fetchStatus: (runId: string) => Promise<TaskStatus>;
  private readonly createEventSource: (url: string) => StreamEventSource;
  private readonly pollIntervalMs: number;
  private readonly setTimeoutFn: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (handle: ReturnType<typeof setTimeout>) => void;
  private stateValue: StreamState = initialState();
  private disposed = false;
  private es: StreamEventSource | null = null;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private pollInFlight = false;
  private statusFailures = 0;
  private statusTerminalSeen = false;
  private lastRealSeq = 0;
  private readonly seenIds = new Set<string>();

  constructor(opts: TaskStreamControllerOptions) {
    this.runId = opts.runId;
    this.onState = opts.onState;
    this.fetchStatus = opts.fetchStatus;
    this.createEventSource =
      opts.createEventSource ?? ((url: string) => new EventSource(url) as unknown as StreamEventSource);
    this.pollIntervalMs = opts.pollIntervalMs ?? STATUS_POLL_MS;
    this.setTimeoutFn = opts.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutFn = opts.clearTimeoutFn ?? ((handle) => clearTimeout(handle));
  }

  get state(): StreamState {
    return this.stateValue;
  }

  start(): void {
    if (this.disposed) return;
    this.openStream(null);
    this.schedulePoll(this.pollIntervalMs);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearPoll();
    this.closeStream();
  }

  private patch(partial: Partial<StreamState>): void {
    if (this.disposed) return;
    const next = { ...this.stateValue, ...partial };
    this.stateValue = next;
    this.onState(next);
  }

  private openStream(afterSeq: number | null): void {
    if (this.disposed) return;
    this.closeStream();
    const suffix = afterSeq === null ? "" : `?after=${afterSeq}`;
    const url = `/api/tasks/${encodeURIComponent(this.runId)}/events${suffix}`;
    let es: StreamEventSource;
    try {
      es = this.createEventSource(url);
    } catch {
      this.patch({ conn: "reconnecting" });
      return;
    }
    this.es = es;
    for (const type of EVENT_TYPES) {
      es.addEventListener(type, (ev) => this.handleEvent(type, ev));
    }
    es.onopen = () => {
      if (!this.disposed && this.es === es) this.patch({ conn: "open" });
    };
    this.patch({ conn: "connecting" });
  }

  private closeStream(): void {
    if (!this.es) return;
    try {
      this.es.close();
    } catch {
      /* already closed */
    }
    this.es = null;
  }

  private schedulePoll(ms: number): void {
    if (this.disposed) return;
    if (this.stateValue.terminal && !this.stateValue.recoveryRequired) return;
    this.clearPoll();
    this.pollTimer = this.setTimeoutFn(() => {
      this.pollTimer = null;
      void this.pollStatusOnce();
    }, ms);
  }

  private clearPoll(): void {
    if (this.pollTimer === null) return;
    this.clearTimeoutFn(this.pollTimer);
    this.pollTimer = null;
  }

  private handleEvent(type: string, ev: MessageEvent): void {
    if (this.disposed) return;
    if (type === "error" && typeof ev.data !== "string") {
      this.handleNativeError();
      return;
    }
    let payload: any;
    try {
      payload = JSON.parse(String(ev.data));
    } catch {
      return; // 非 JSON payload 忽略
    }

    const rawId = ev.lastEventId;
    const sid = typeof rawId === "string" ? rawId : "";
    if (sid) {
      if (this.seenIds.has(sid)) return;
      this.seenIds.add(sid);
      const seq = Number(sid);
      if (Number.isSafeInteger(seq) && seq >= 0 && seq < SYNTHETIC_SSE_ID_MIN) {
        this.lastRealSeq = Math.max(this.lastRealSeq, seq);
      }
    }

    const cur = this.stateValue;
    switch (type) {
      case "stage": {
        const stage = typeof payload.stage === "string" ? payload.stage : "";
        const text =
          typeof payload.text === "string" && payload.text
            ? payload.text
            : (STAGE_TEXT[stage] ?? stage);
        this.patch({
          stage,
          stageText: text,
          attempt: typeof payload.attempt === "number" ? payload.attempt : cur.attempt,
          timeline: [
            ...cur.timeline,
            { stage, text: typeof payload.text === "string" ? payload.text : null },
          ],
        });
        break;
      }
      case "sql":
        this.patch({
          sqls: [
            ...cur.sqls,
            {
              sql: typeof payload.sql === "string" ? payload.sql : "",
              rows: typeof payload.rows === "number" ? payload.rows : null,
              truncated: payload.truncated === true,
              elapsedMs: typeof payload.elapsed_ms === "number" ? payload.elapsed_ms : null,
            },
          ],
        });
        break;
      case "answer":
        if (typeof payload.markdown === "string") this.patch({ answer: payload.markdown });
        break;
      case "report":
        if (typeof payload.path === "string") this.patch({ reportPath: payload.path });
        break;
      case "done": {
        const status = typeof payload.status === "string" ? payload.status : "succeeded";
        this.patch({
          done: {
            status,
            elapsedMs: typeof payload.elapsed_ms === "number" ? payload.elapsed_ms : null,
            tokens:
              payload.tokens && typeof payload.tokens.input === "number"
                ? {
                    input: payload.tokens.input,
                    output: typeof payload.tokens.output === "number" ? payload.tokens.output : 0,
                    cache_read:
                      typeof payload.tokens.cache_read === "number" ? payload.tokens.cache_read : 0,
                  }
                : null,
            recovered: payload.recovered === true,
          },
          terminal: true,
          terminalFromStatus: false,
        });
        this.closeStream();
        this.clearPoll();
        if (status === "failed" || status === "cancelled") {
          void this.checkRecoveryAfterDone();
        }
        break;
      }
      case "error":
        if (payload.code === CLEANUP_RECOVERY_CODE) {
          this.enterRecovery();
        } else {
          this.patch({
            error: {
              code: String(payload.code ?? "UNKNOWN"),
              message: String(payload.message ?? "未知错误"),
            },
            terminal: true,
            terminalFromStatus: false,
          });
        }
        break;
      default:
        break;
    }
  }

  private handleNativeError(): void {
    if (this.disposed || !this.es) return;
    if (this.es.readyState === ES_CLOSED) {
      this.closeStream();
      if (this.stateValue.terminal) return;
      this.patch({ conn: "reconnecting" });
      this.clearPoll();
      void this.pollStatusOnce();
    } else {
      // EventSource 自动重连中（保留旧行为），不由 UI 主动重建。
      this.patch({ conn: "reconnecting" });
    }
  }

  private enterRecovery(): void {
    if (this.disposed) return;
    this.patch({ recoveryRequired: true, conn: "recovering" });
    this.closeStream();
    if (this.stateValue.terminal) {
      // 真实业务 done 已收：保留业务终态，只确认/展示资源恢复状态。
      void this.checkRecoveryAfterDone();
      return;
    }
    this.clearPoll();
    void this.pollStatusOnce();
  }

  private async checkRecoveryAfterDone(): Promise<void> {
    try {
      const st = await this.fetchStatus(this.runId);
      if (this.disposed || st.recovery_required !== true) return;
      this.patch({ recoveryRequired: true, conn: "recovering" });
      if (TERMINAL_STATUS.has(st.status)) {
        this.applyBusinessTerminalFromStatus(st, true);
      }
      // 业务终态 + 资源待恢复：继续低频 GET，人工解除 hold 后能自动清掉提示。
      this.schedulePoll(this.pollIntervalMs);
    } catch {
      // 一次性核对失败：保留已收到的真实 done，不伪造 recovery。
    }
  }

  private async pollStatusOnce(): Promise<void> {
    if (this.disposed || this.pollInFlight) return;
    if (this.stateValue.terminal && !this.stateValue.recoveryRequired) return;
    this.pollInFlight = true;
    let schedule = true;
    try {
      const st = await this.fetchStatus(this.runId);
      if (this.disposed) return;
      this.statusFailures = 0;
      this.applyStatus(st);
      schedule = !this.stateValue.terminal || this.stateValue.recoveryRequired;
    } catch {
      if (!this.disposed) {
        this.statusFailures += 1;
        if (this.statusFailures >= 2) this.patch({ conn: "reconnecting" });
      }
    } finally {
      this.pollInFlight = false;
      if (
        !this.disposed &&
        schedule &&
        (!this.stateValue.terminal || this.stateValue.recoveryRequired)
      ) {
        this.schedulePoll(this.pollIntervalMs);
      }
    }
  }

  private applyStatus(st: TaskStatus): void {
    const wasRecovery = this.stateValue.recoveryRequired;
    if (st.recovery_required === true) {
      this.statusTerminalSeen = false;
      this.patch({ recoveryRequired: true, conn: "recovering" });
      this.closeStream();
      if (TERMINAL_STATUS.has(st.status)) {
        this.applyBusinessTerminalFromStatus(st, true);
      }
      return;
    }

    if (wasRecovery) this.patch({ recoveryRequired: false });
    if (TERMINAL_STATUS.has(st.status)) {
      // 非 recovery 的兜底仍保留旧的双轮确认，避开 done 帧仍在途的竞态。
      if (!wasRecovery && !this.statusTerminalSeen) {
        this.statusTerminalSeen = true;
        return;
      }
      this.applyBusinessTerminalFromStatus(st, false);
      return;
    }

    this.statusTerminalSeen = false;
    if (wasRecovery) {
      // 人工恢复：任务仍在跑/已回队列，从最后一条真实事件 seq 续流；绝不用合成 id。
      this.openStream(this.lastRealSeq);
    }
  }

  private applyBusinessTerminalFromStatus(st: TaskStatus, withRecovery: boolean): void {
    if (st.status === "succeeded" || st.status === "cancelled") {
      if (this.stateValue.done === null) {
        this.patch({
          done: { status: st.status, elapsedMs: null, tokens: null, recovered: false },
          terminal: true,
          terminalFromStatus: true,
        });
      } else {
        this.patch({ terminal: true });
      }
    } else if (st.status === "failed") {
      const hadDone = this.stateValue.done !== null;
      const businessCode =
        st.error_code && st.error_code !== CLEANUP_RECOVERY_CODE ? st.error_code : null;
      if (this.stateValue.error === null && businessCode !== null) {
        this.patch({
          error: { code: businessCode, message: "任务执行失败（未收到失败详情事件）" },
        });
      } else if (!withRecovery && this.stateValue.error === null) {
        this.patch({
          error: {
            code: businessCode ?? "ENGINE_ERROR",
            message: "任务执行失败（未收到失败详情事件）",
          },
        });
      }
      if (withRecovery && this.stateValue.done === null) {
        this.patch({
          done: { status: "failed", elapsedMs: null, tokens: null, recovered: false },
        });
      }
      this.patch({
        terminal: true,
        terminalFromStatus: !hadDone,
      });
    } else {
      return;
    }
    this.closeStream();
    this.clearPoll();
  }
}

export function useTaskStream(runId: string, onTerminal?: () => void): StreamState {
  const [stream, setStream] = useState<{ runId: string; state: StreamState }>(() => ({
    runId,
    state: initialState(),
  }));
  const state = stream.runId === runId ? stream.state : initialState();
  const onTerminalRef = useRef(onTerminal);

  useEffect(() => {
    onTerminalRef.current = onTerminal;
  }, [onTerminal]);

  useEffect(() => {
    if (!runId) return;
    let disposed = false;
    const controller = new TaskStreamController({
      runId,
      onState: (next) => {
        if (!disposed) setStream({ runId, state: next });
      },
      fetchStatus: apiTaskStatus,
      createEventSource: (url) => new EventSource(url) as unknown as StreamEventSource,
    });
    controller.start();
    return () => {
      disposed = true;
      controller.dispose();
    };
  }, [runId]);

  useEffect(() => {
    if (state.terminal) onTerminalRef.current?.();
  }, [state.terminal]);

  return state;
}
