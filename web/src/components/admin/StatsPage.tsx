// M4-B4 使用统计页：数字卡 + 近 14 天任务量条形图（纯 CSS，单色系列——单一系列
// 不用图例，标题即系列名；条形 hover 显示数值，0 值画基线残条）+ 失败清单
// （run_id 可跳审计 run 详情）。dataviz 规范：文字用 ink 色阶、数据条用单一 accent 色。
import { useEffect, useState } from "react";
import { ApiError, apiAdminStats } from "../../api";
import type { StatsResult } from "../../types";
import { fmtInt, fmtTs, statusClass } from "./format";

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-4 py-3">
      <div className="text-[11px] text-ink-3">{label}</div>
      <div className="mt-1 text-xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-ink-3">{hint}</div>}
    </div>
  );
}

/** 近 14 天每日任务量：纯 CSS 竖条（单一 accent 色；hover 抬亮并显示当日数值）。 */
function DailyBars({ daily }: { daily: { date: string; count: number }[] }) {
  const max = Math.max(1, ...daily.map((d) => d.count));
  return (
    <div>
      <div className="flex h-36 items-end gap-0.5" role="img" aria-label="近 14 天每日任务量条形图">
        {daily.map((d) => (
          <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.date} · ${d.count} 个任务`}>
            <div className="pointer-events-none mb-0.5 text-center text-[10px] text-ink-2 opacity-0 group-hover:opacity-100">
              {d.count}
            </div>
            <div
              className={`w-full rounded-t-sm transition-colors ${
                d.count > 0 ? "bg-accent group-hover:bg-accent-2" : "bg-line"
              }`}
              style={{ height: d.count > 0 ? `${Math.max((d.count / max) * 100, 6)}%` : "2px" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-0.5">
        {daily.map((d) => (
          <div key={d.date} className="flex-1 truncate text-center text-[9px] text-ink-3">
            {d.date.slice(5)}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function StatsPage({ onOpenRun }: { onOpenRun: (runId: string) => void }) {
  const [s, setS] = useState<StatsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiAdminStats()
      .then(setS)
      .catch((err) => setError(err instanceof ApiError ? err.message : "加载失败"));
  }, []);

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-5">
        <div className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>
      </div>
    );
  }
  if (!s) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-5">
        <div className="py-6 text-center text-xs text-ink-3">加载中…</div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-6 py-5">
      {/* 数字卡 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="任务总量" value={fmtInt(s.totals.all)} hint={`已终态 ${fmtInt(s.totals.terminal)}`} />
        <StatCard
          label="成功率"
          value={s.totals.success_rate_pct == null ? "—" : `${s.totals.success_rate_pct}%`}
          hint="succeeded ÷ 已终态"
        />
        <StatCard
          label="成败分布"
          value={`${fmtInt(s.totals.succeeded)} / ${fmtInt(s.totals.failed)}`}
          hint={`成功 / 失败（取消 ${fmtInt(s.totals.cancelled)} · 运行 ${fmtInt(s.totals.running)} · 排队 ${fmtInt(s.totals.queued)}）`}
        />
        <StatCard label="活跃用户" value={fmtInt(s.active_users)} hint="曾提交任务的用户数" />
        <StatCard
          label="今日新增任务"
          value={fmtInt(s.today.tasks)}
          hint={s.today.users.length ? s.today.users.join("、") : "今日无人提问"}
        />
        <StatCard label="今日开户" value={fmtInt(s.today.new_users)} hint={s.today.date} />
        <StatCard label="tokens 输入" value={fmtInt(s.tokens.input)} hint={`输出 ${fmtInt(s.tokens.output)}`} />
        <StatCard label="tokens 缓存读" value={fmtInt(s.tokens.cache_read)} hint="done 事件累计" />
      </div>

      {/* 近 14 天趋势 */}
      <section className="rounded-lg border border-line bg-panel p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">近 14 天每日任务量</h2>
        <DailyBars daily={s.daily} />
      </section>

      {/* 失败按 error_code 分布 */}
      <section className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">失败/取消 按 error_code 分布</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="px-4 py-2 font-medium">error_code</th>
              <th className="px-4 py-2 font-medium">条数</th>
              <th className="px-4 py-2 font-medium">error_message 样例</th>
            </tr>
          </thead>
          <tbody>
            {s.fail_by_code.map((f) => (
              <tr key={f.code} className="border-t border-line/60">
                <td className="px-4 py-1.5 font-mono text-[11px] text-bad">{f.code}</td>
                <td className="px-4 py-1.5 text-ink">{fmtInt(f.count)}</td>
                <td className="px-4 py-1.5 text-ink-3">{f.sample_message ?? "—"}</td>
              </tr>
            ))}
            {s.fail_by_code.length === 0 && (
              <tr>
                <td colSpan={3} className="px-4 py-4 text-center text-ink-3">
                  无失败/取消任务
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      {/* 失败清单：run_id 跳审计详情 */}
      <section className="overflow-hidden rounded-lg border border-line bg-panel">
        <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">失败任务清单（最新 100 条）</div>
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-ink-3">
              <th className="px-4 py-2 font-medium">run_id</th>
              <th className="px-4 py-2 font-medium">用户</th>
              <th className="px-4 py-2 font-medium">问题</th>
              <th className="px-4 py-2 font-medium">error_code</th>
              <th className="px-4 py-2 font-medium">attempt</th>
              <th className="px-4 py-2 font-medium">创建</th>
            </tr>
          </thead>
          <tbody>
            {s.failed.map((f) => (
              <tr key={f.run_id} className="border-t border-line/60">
                <td className="px-4 py-1.5">
                  <button
                    type="button"
                    className="font-mono text-[11px] text-accent-2 hover:underline"
                    title="在审计页查看该任务事件流"
                    onClick={() => onOpenRun(f.run_id)}
                  >
                    {f.run_id.slice(0, 16)}…
                  </button>
                </td>
                <td className="px-4 py-1.5 text-ink-2">{f.user}</td>
                <td className="px-4 py-1.5 text-ink">{f.question}</td>
                <td className={`px-4 py-1.5 ${statusClass(f.status)}`}>{f.error_code ?? "—"}</td>
                <td className="px-4 py-1.5 text-ink-3">{f.attempt}</td>
                <td className="px-4 py-1.5 text-ink-3">{fmtTs(f.created_at)}</td>
              </tr>
            ))}
            {s.failed.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-4 text-center text-ink-3">
                  无失败任务
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
