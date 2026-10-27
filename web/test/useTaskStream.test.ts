// S4-B2-C2-B2-3-UI：useTaskStream 控制器协议测试（无 DOM；假 EventSource/GET/计时器）。
// 重点覆盖 recovery 非终态、204/CLOSED GET、failed/cancelled done 后补查、合成 id 不污染游标、
// 人工恢复后续流、卸载清理，以及 Windows/off 旧正常/失败路径。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TaskStreamController,
  SYNTHETIC_SSE_ID_MIN,
  recoveryNoticeText,
  shouldQueryHistoricalRecovery,
} from "../src/hooks/useTaskStream.ts";
import type { StreamState } from "../src/hooks/useTaskStream.ts";
import type { TaskStatus } from "../src/types.ts";

const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
const RUN_ID = "run-recovery-1";

const status = (patch: Partial<TaskStatus> = {}): TaskStatus => ({
  run_id: RUN_ID,
  session_id: "sess-1",
  status: "running",
  stage: null,
  attempt: 1,
  error_code: null,
  created_at: 1,
  ...patch,
});

class FakeEventSource {
  url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  closed = false;
  private listeners = new Map<string, ((ev: MessageEvent) => void)[]>();

  constructor(url: string) {
    this.url = url;
  }

  addEventListener(type: string, fn: (ev: MessageEvent) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
  }

  open(): void {
    this.readyState = 1;
    this.onopen?.();
  }

  emit(type: string, payload: unknown, lastEventId: number): void {
    const ev = {
      data: JSON.stringify(payload),
      lastEventId: String(lastEventId),
    } as unknown as MessageEvent;
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }

  /** 原生连接错误（不是 SSE event: error）：data 非 string，浏览器 CLOSED。 */
  nativeError(): void {
    this.readyState = 2;
    const ev = { data: undefined, lastEventId: "" } as unknown as MessageEvent;
    for (const fn of this.listeners.get("error") ?? []) fn(ev);
  }
}

class FakeClock {
  private nextId = 0;
  private timers = new Map<number, { fn: () => void; ms: number }>();

  setTimeoutFn = (fn: () => void, ms: number): ReturnType<typeof setTimeout> => {
    const id = ++this.nextId;
    this.timers.set(id, { fn, ms });
    return id as unknown as ReturnType<typeof setTimeout>;
  };

  clearTimeoutFn = (handle: ReturnType<typeof setTimeout>): void => {
    this.timers.delete(Number(handle));
  };

  get pending(): number {
    return this.timers.size;
  }

  async runNext(): Promise<boolean> {
    const first = this.timers.entries().next();
    if (first.done) return false;
    const [id, timer] = first.value;
    this.timers.delete(id);
    timer.fn();
    await flush();
    return true;
  }
}

function setup(initialStatus: TaskStatus) {
  const states: StreamState[] = [];
  const sources: FakeEventSource[] = [];
  const clock = new FakeClock();
  const statusCalls: string[] = [];
  let nextStatus: TaskStatus | (() => Promise<TaskStatus>) = initialStatus;
  const controller = new TaskStreamController({
    runId: RUN_ID,
    onState: (s) => states.push(s),
    fetchStatus: async (runId) => {
      statusCalls.push(runId);
      const v = nextStatus;
      return typeof v === "function" ? await v() : v;
    },
    createEventSource: (url) => {
      const s = new FakeEventSource(url);
      sources.push(s);
      return s as never;
    },
    pollIntervalMs: 1_000,
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
  });
  const latest = () => states[states.length - 1];
  const setNext = (v: TaskStatus | (() => Promise<TaskStatus>)) => {
    nextStatus = v;
  };
  return { controller, states, sources, clock, statusCalls, latest, setNext };
}

test("recovery SSE error 无 message：非终态、无未知错误、关流并只走 GET", async () => {
  const h = setup(status({ status: "running", recovery_required: true, error_code: "CLEANUP_RECOVERY_REQUIRED" }));
  h.controller.start();
  const es = h.sources[0];
  es.emit("stage", { stage: "analyzing" }, 1);
  es.emit("error", { code: "CLEANUP_RECOVERY_REQUIRED", run_id: RUN_ID }, SYNTHETIC_SSE_ID_MIN + 1);
  await flush();

  const s = h.latest();
  assert.equal(s.recoveryRequired, true);
  assert.equal(s.terminal, false);
  assert.equal(s.error, null, "不得显示未知错误");
  assert.equal(s.conn, "recovering");
  assert.equal(es.closed, true, "收到 recovery error 后关闭 EventSource");
  assert.equal(h.statusCalls.length, 1, "立即受控 GET 一次");
  assert.ok(h.clock.pending > 0, "保留低频 GET 轮询");
  h.controller.dispose();
});

test("204/CLOSED：不无限重连，先 GET 确认 recovery，再按低频轮询", async () => {
  const h = setup(status({ status: "running", recovery_required: true, error_code: "CLEANUP_RECOVERY_REQUIRED" }));
  h.controller.start();
  const es = h.sources[0];
  es.nativeError();
  await flush();

  assert.equal(h.sources.length, 1, "CLOSED 后不主动新建 EventSource");
  assert.equal(h.latest().recoveryRequired, true);
  assert.equal(h.latest().terminal, false);
  assert.equal(h.statusCalls.length, 1);
  assert.ok(h.clock.pending > 0);

  // 连续轮询仍是 recovery：仍不得创建新事件流。
  for (let i = 0; i < 3; i += 1) {
    await h.clock.runNext();
    assert.equal(h.sources.length, 1);
  }
  h.controller.dispose();
  assert.equal(h.clock.pending, 0, "卸载时清理轮询");
});

test("failed done + recovery_required=true：真实业务终态与资源恢复并存", async () => {
  const h = setup(
    status({
      status: "failed",
      recovery_required: true,
      error_code: "ENGINE_ERROR",
    }),
  );
  h.controller.start();
  const es = h.sources[0];
  es.emit("done", { status: "failed", elapsed_ms: 12, tokens: null, recovered: false }, 2);
  await flush();

  const s = h.latest();
  assert.equal(s.terminal, true);
  assert.equal(s.done?.status, "failed");
  assert.equal(s.recoveryRequired, true);
  assert.equal(s.error?.code, "ENGINE_ERROR", "保留真实业务失败原因");
  assert.equal(es.closed, true);
  assert.ok(h.clock.pending > 0, "业务终态仍应低频 GET，等待人工解除 hold");

  h.setNext(status({ status: "failed", recovery_required: false, error_code: "ENGINE_ERROR" }));
  await h.clock.runNext();
  assert.equal(h.latest().terminal, true);
  assert.equal(h.latest().recoveryRequired, false, "hold 解除后清除 recovery 提示");
  assert.equal(h.latest().done?.status, "failed", "业务失败终态不被清除");
  assert.equal(h.clock.pending, 0, "恢复解除后停止轮询");
  h.controller.dispose();
});

test("cancelled done + recovery_required=true：取消终态与资源恢复并存", async () => {
  const h = setup(status({ status: "cancelled", recovery_required: true }));
  h.controller.start();
  h.sources[0].emit("done", { status: "cancelled", elapsed_ms: 4, tokens: null, recovered: false }, 2);
  await flush();

  const s = h.latest();
  assert.equal(s.terminal, true);
  assert.equal(s.done?.status, "cancelled");
  assert.equal(s.recoveryRequired, true);
  assert.equal(s.error, null);
  assert.ok(h.clock.pending > 0, "取消终态仍等待资源恢复，低频 GET");
  h.controller.dispose();
});

test("人工解除 hold 后从真实 last seq 续流，合成 id 不进入 after", async () => {
  const h = setup(status({ status: "running", recovery_required: true }));
  h.controller.start();
  const first = h.sources[0];
  first.emit("stage", { stage: "analyzing" }, 7);
  first.emit("error", { code: "CLEANUP_RECOVERY_REQUIRED", run_id: RUN_ID }, SYNTHETIC_SSE_ID_MIN + 7);
  await flush();
  assert.equal(h.latest().recoveryRequired, true);

  h.setNext(status({ status: "running", recovery_required: false }));
  await h.clock.runNext();

  assert.equal(h.sources.length, 2, "恢复后重建事件流");
  const resumed = h.sources[1];
  assert.match(resumed.url, /\?after=7$/, "必须用真实 last seq 续流");
  assert.ok(!resumed.url.includes(String(SYNTHETIC_SSE_ID_MIN + 7)), "绝不能用合成 id 当游标");

  resumed.emit("stage", { stage: "querying" }, 8);
  assert.equal(h.latest().stage, "querying");
  assert.equal(h.latest().recoveryRequired, false);
  assert.equal(h.latest().terminal, false);
  h.controller.dispose();
});

test("卸载清理：关闭 EventSource、清除轮询、之后的异步/事件不再写状态", async () => {
  const h = setup(status({ status: "running", recovery_required: true }));
  h.controller.start();
  const es = h.sources[0];
  es.emit("error", { code: "CLEANUP_RECOVERY_REQUIRED", run_id: RUN_ID }, SYNTHETIC_SSE_ID_MIN + 1);
  await flush();
  const count = h.states.length;

  h.controller.dispose();
  assert.equal(es.closed, true);
  assert.equal(h.clock.pending, 0);
  es.emit("stage", { stage: "querying" }, 2);
  await flush();
  assert.equal(h.states.length, count, "dispose 后不得再回调 UI");
});

test("Windows/off 正常 done：成功路径不查询 recovery、不显示 recovery", async () => {
  const h = setup(status({ status: "succeeded" }));
  h.controller.start();
  const es = h.sources[0];
  es.emit("done", { status: "succeeded", elapsed_ms: 20, tokens: null, recovered: false }, 2);
  await flush();

  const s = h.latest();
  assert.equal(s.terminal, true);
  assert.equal(s.done?.status, "succeeded");
  assert.equal(s.recoveryRequired, false);
  assert.equal(es.closed, true);
  assert.equal(h.statusCalls.length, 0, "成功 done 不触发 recovery 补查");
  h.controller.dispose();
});

test("Windows/off 普通 error：保持原错误文案/终态语义，不误判 recovery", async () => {
  const h = setup(status({ status: "running" }));
  h.controller.start();
  const es = h.sources[0];
  es.emit("error", { code: "ENGINE_ERROR", message: "上游异常" }, 2);
  await flush();

  const s = h.latest();
  assert.equal(s.recoveryRequired, false);
  assert.equal(s.terminal, true);
  assert.deepEqual(s.error, { code: "ENGINE_ERROR", message: "上游异常" });
  assert.equal(es.closed, false, "普通 error 仍等待后续 done（旧行为）");
  h.controller.dispose();
});

test("Windows/off failed done 无 recovery：保留业务失败，不出现 recovery 提示", async () => {
  const h = setup(status({ status: "failed", error_code: "REPORT_CHECK" }));
  h.controller.start();
  const es = h.sources[0];
  es.emit("done", { status: "failed", elapsed_ms: 5, tokens: null, recovered: false }, 2);
  await flush();

  const s = h.latest();
  assert.equal(s.terminal, true);
  assert.equal(s.done?.status, "failed");
  assert.equal(s.recoveryRequired, false);
  assert.equal(es.closed, true);
  assert.equal(h.statusCalls.length, 1, "failed done 后主动 GET 一次");
  h.controller.dispose();
});

test("普通历史/重复事件仍按 seq 去重，合成通知不改变真实事件轨迹", async () => {
  const h = setup(status({ status: "running", recovery_required: true }));
  h.controller.start();
  const es = h.sources[0];
  es.emit("stage", { stage: "analyzing" }, 1);
  es.emit("stage", { stage: "analyzing" }, 1); // 重放重叠帧
  es.emit("error", { code: "CLEANUP_RECOVERY_REQUIRED", run_id: RUN_ID }, SYNTHETIC_SSE_ID_MIN + 1);
  await flush();
  assert.equal(h.latest().timeline.length, 1);
  assert.equal(h.clock.pending > 0, true);
  h.controller.dispose();
});

test("Recovery 文案：独立等待态与业务终态并存，不丢失失败/取消信息", () => {
  assert.deepEqual(recoveryNoticeText({ done: null, terminal: false }), {
    title: "任务中断，等待恢复",
    detail: "资源仍待恢复，暂不可重试。",
  });
  assert.deepEqual(
    recoveryNoticeText({
      done: { status: "failed", elapsedMs: 1, tokens: null, recovered: false },
      terminal: true,
    }),
    {
      title: "任务中断，等待恢复",
      detail: "业务任务已结束（失败）；资源仍待恢复。",
    },
  );
  assert.deepEqual(
    recoveryNoticeText({
      done: { status: "cancelled", elapsedMs: null, tokens: null, recovered: false },
      terminal: true,
    }),
    {
      title: "任务中断，等待恢复",
      detail: "业务任务已结束（已取消）；资源仍待恢复。",
    },
  );
});

test("历史 recovery 补查范围仅 failed/cancelled", () => {
  assert.equal(shouldQueryHistoricalRecovery("failed"), true);
  assert.equal(shouldQueryHistoricalRecovery("cancelled"), true);
  assert.equal(shouldQueryHistoricalRecovery("succeeded"), false);
  assert.equal(shouldQueryHistoricalRecovery("running"), false);
});
