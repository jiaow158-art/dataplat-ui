// UI-T6/T7：报告卡片。预览走 /report?run_id= 壳页（新窗，UI-T7 提供——内层 iframe sandbox
// 隔离不可信 HTML）；下载走 BFF /api/reports?download=1（属主校验 + attachment 头）。
export default function ReportCard({ runId }: { runId: string }) {
  const base = `/api/reports?run_id=${encodeURIComponent(runId)}`;
  return (
    <div className="mt-2 flex items-center justify-between rounded border border-line bg-card px-4 py-3">
      <div className="flex items-center gap-2 text-sm text-ink">
        <IconReport />
        <span>分析报告已生成</span>
      </div>
      <div className="flex gap-2">
        <a
          className="rounded border border-line-strong px-3 py-1 text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink"
          href={`/report?run_id=${encodeURIComponent(runId)}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          预览
        </a>
        <a
          className="rounded bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-2"
          href={`${base}&download=1`}
        >
          下载
        </a>
      </div>
    </div>
  );
}

const IconReport = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true" className="text-accent-2">
    <path
      d="M9 1.5H3.5A1 1 0 0 0 2.5 2.5v11a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V5L9 1.5Z"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
    <path d="M9 1.5V5h3.5M5.5 8.5h5M5.5 11h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
