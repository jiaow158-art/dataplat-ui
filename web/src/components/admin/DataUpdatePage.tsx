// SCH-1 数据更新管理（仅 is_admin）：调度状态/下次计划/执行锁/最近运行/触发队列/缓存，
// 手动操作只暴露真实能力（修正E）：补跑流水线（今日/昨日）、预热目标/区域、缓存失效。
// 诚实声明（裁定2）：09:30 无硬门控——页头明示 first-final-wins 真实语义。
import { useCallback, useEffect, useState } from "react";
import { apiInsightAdminStatus, apiInsightAdminTrigger, type InsightAdminStatus } from "../../api";

const fmtTs = (sec: number | null | undefined) =>
  sec ? new Date(sec * 1000).toLocaleString("zh-CN", { hour12: false }) : "—";

const STATUS_TONE: Record<string, string> = {
  succeeded: "text-good", partial: "text-warn", not_ready: "text-warn",
  failed: "text-bad", running: "text-accent-2", queued: "text-ink-3",
  skipped: "text-ink-3", shadow: "text-ink-3",
  pending: "text-ink-3", claimed: "text-accent-2", done: "text-good",
};

export default function DataUpdatePage() {
  const [st, setSt] = useState<InsightAdminStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [briefDate, setBriefDate] = useState<string>("today");

  const load = useCallback(() => {
    apiInsightAdminStatus().then(setSt).catch((e) => setErr(e instanceof Error ? e.message : String(e)));
  }, []);
  useEffect(() => {
    load();
    const iv = setInterval(load, 15000);
    return () => clearInterval(iv);
  }, [load]);

  const trigger = async (action: string, brief?: string) => {
    if (busy) return;
    const label = action === "daily_run" ? `补跑 ${brief === "yesterday" ? "昨日" : "今日"} 流水线` :
      action === "prewarm_target" ? "预热目标管理缓存" :
      action === "prewarm_region" ? "预热区域地图缓存" : "清空趋势缓存";
    if (!window.confirm(`${label}？\n（幂等安全：已跑雷达自动跳过、final 简报不可改写、归因受 10:00-14:00 窗口门控）`)) return;
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const bd = action === "daily_run"
        ? (brief === "yesterday"
            ? new Date(Date.now() - 86400000).toISOString().slice(0, 10)
            : new Date().toISOString().slice(0, 10))
        : undefined;
      const r = await apiInsightAdminTrigger(action, bd);
      setMsg(`已入队：${r.request_id}（${r.status}）——由 scheduler 领取执行`);
      setTimeout(load, 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const sched = st?.scheduler ? (JSON.parse(st.scheduler.v) as {
    mode: string; holder: string; pid: number; started_at: string;
    next_fire: Record<string, string | null>;
  }) : null;

  return (
    <div className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">数据更新管理</h3>
          <p className="mt-1 text-[11px] text-ink-3">{st?.freeze_note ?? "…"}（本页不声称严格 09:30 冻结）</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <select
            className="rounded border border-line bg-card px-2 py-1 text-xs text-ink"
            value={briefDate}
            onChange={(e) => setBriefDate(e.target.value)}
            disabled={busy}
          >
            <option value="today">今日</option>
            <option value="yesterday">昨日</option>
          </select>
          {[
            ["daily_run", "补跑流水线"],
            ["prewarm_target", "预热目标"],
            ["prewarm_region", "预热区域"],
            ["cache_invalidate", "缓存失效"],
          ].map(([a, label]) => (
            <button
              key={a}
              type="button"
              disabled={busy}
              className="rounded border border-line-strong bg-card px-2.5 py-1 text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:opacity-50"
              onClick={() => void trigger(a, briefDate)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {msg && <div className="rounded border border-good/40 bg-good/10 px-3 py-2 text-xs text-good">{msg}</div>}
      {err && <div className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{err}</div>}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-line bg-card p-4">
          <div className="text-xs text-ink-3">调度器</div>
          {sched ? (
            <div className="mt-2 space-y-1 text-sm text-ink-2">
              <div>模式：<span className={sched.mode === "live" ? "text-good" : "text-warn"}>{sched.mode === "live" ? "生效" : "shadow（只记账不执行）"}</span></div>
              <div className="text-xs text-ink-3">下次：daily {sched.next_fire.daily?.slice(11, 16) ?? "—"} · 归因 {sched.next_fire.attribution_second?.slice(11, 16) ?? "—"}</div>
              <div className="text-xs text-ink-3">pid {sched.pid} · 状态更新 {fmtTs(st?.scheduler?.updated_at)}</div>
            </div>
          ) : <div className="mt-2 text-sm text-ink-3">未上线（scheduler 未运行或未广播）</div>}
        </div>
        <div className="rounded-lg border border-line bg-card p-4">
          <div className="text-xs text-ink-3">执行锁</div>
          {st?.lock ? (
            <div className="mt-2 space-y-1 text-sm text-ink-2">
              <div className="truncate text-xs" title={st.lock.holder}>{st.lock.holder}</div>
              <div className="text-xs text-ink-3">brief {st.lock.brief_date ?? "—"} · 心跳 {fmtTs(st.lock.heartbeat_at)}</div>
            </div>
          ) : <div className="mt-2 text-sm text-ink-3">空闲</div>}
        </div>
        <div className="rounded-lg border border-line bg-card p-4">
          <div className="text-xs text-ink-3">趋势缓存（进程内）</div>
          <div className="mt-2 text-sm text-ink-2">{st?.cache.length ?? 0} 条</div>
          <div className="mt-1 max-h-16 overflow-y-auto text-[10px] leading-4 text-ink-3">
            {st?.cache.map((c) => <div key={c.key} className="truncate">{c.key}</div>)}
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-card p-4">
        <div className="mb-2 text-xs text-ink-3">最近运行（自动刷新 15s）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="pb-2">任务</th><th className="pb-2">状态</th><th className="pb-2">触发</th>
              <th className="pb-2">brief</th><th className="pb-2">开始</th><th className="pb-2">耗时</th><th className="pb-2">备注</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {(st?.recent_runs ?? []).map((r) => (
              <tr key={r.run_id}>
                <td className="py-1.5 text-ink">{r.job_type}</td>
                <td className={`py-1.5 ${STATUS_TONE[r.status] ?? "text-ink-2"}`}>{r.status}</td>
                <td className="py-1.5 text-ink-3">{r.trigger_type}{r.triggered_by ? `·${r.triggered_by}` : ""}</td>
                <td className="py-1.5 text-ink-3">{r.brief_date ?? "—"}</td>
                <td className="py-1.5 text-ink-3">{fmtTs(r.started_at)}</td>
                <td className="py-1.5 text-ink-3">
                  {r.started_at && r.finished_at ? `${Math.round((r.finished_at - r.started_at) / 1000)}s` : r.status === "running" ? "…" : "—"}
                </td>
                <td className="max-w-[22rem] truncate py-1.5 text-ink-3" title={r.error_message ?? ""}>{r.error_message ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-line bg-card p-4">
        <div className="mb-2 text-xs text-ink-3">手动触发队列</div>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-line">
            {(st?.queue ?? []).map((q) => (
              <tr key={q.request_id}>
                <td className="py-1.5 text-ink">{q.action}</td>
                <td className={`py-1.5 ${STATUS_TONE[q.status] ?? "text-ink-2"}`}>{q.status}</td>
                <td className="py-1.5 text-ink-3">{q.requested_by} · {fmtTs(q.requested_at)}</td>
                <td className="max-w-[18rem] truncate py-1.5 text-ink-3">{q.note ?? ""}</td>
              </tr>
            ))}
            {!st?.queue.length && <tr><td className="py-1.5 text-ink-3">（空）</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
