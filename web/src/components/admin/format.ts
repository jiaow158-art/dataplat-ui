// 管理后台共用格式化（本地时区显示；audit.mjs 的 fmt 帮助函数同口径 port）。

const pad = (n: number) => String(n).padStart(2, "0");

/** ms epoch → "YYYY-MM-DD HH:mm:ss"（本地时区）。 */
export function fmtTs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** ms epoch → "HH:mm:ss"（时间线内同行已含日期时用）。 */
export function fmtClock(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 毫秒时长 → "12.3s" / "3m05s"；null → "—" */
export function fmtDur(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60_000)}m${pad(Math.round((ms % 60_000) / 1000))}s`;
}

/** 千分位。 */
export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}

/** 单行截断（标题/摘要展示）。 */
export function oneLine(s: string | null | undefined, n: number): string {
  const str = s == null ? "" : String(s).replace(/\s+/g, " ").trim();
  return str.length > n ? str.slice(0, n) + "…" : str;
}

/** 任务终态 → 主题色 class（沿用应用状态色 token）。 */
export function statusClass(status: string): string {
  switch (status) {
    case "succeeded":
      return "text-good";
    case "failed":
      return "text-bad";
    case "cancelled":
      return "text-warn";
    case "running":
      return "text-accent-2";
    default:
      return "text-ink-3"; // queued
  }
}
