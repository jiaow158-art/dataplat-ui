// UI-T7 报告预览壳页（路由 /report?run_id=，新窗打开）。
// 方案取舍：选「最小壳页 + iframe sandbox="allow-scripts"」而非直接新窗打开 /api/reports——
// 1) spec §6.4 指定 iframe sandbox；2) 不带 allow-same-origin 的 sandbox 使引擎产出的不可信
// HTML 运行在 opaque origin，即使绕过 BFF CSP 也读不到本站 cookie/storage、发不出带凭据的
// 同源请求（纵深防御）；3) ECharts 内联脚本照常运行（allow-scripts）。
// iframe 直连 /api/reports（非 blob）：保留 BFF 侧 CSP/nosniff 响应头这道已测试的闸。
export default function ReportPreview() {
  const runId = new URLSearchParams(window.location.search).get("run_id");

  if (!runId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-base text-sm text-ink-2">
        <div className="text-bad">缺少 run_id 参数</div>
        <button type="button" className="rounded border border-line-strong px-3 py-1 text-xs hover:border-accent" onClick={() => window.close()}>
          关闭
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-base">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-line bg-panel px-4">
        <span className="flex items-center gap-2 text-xs text-ink-2">
          <span className="font-medium text-ink">分析报告</span>
          <span className="text-ink-3">{runId}</span>
        </span>
        <span className="flex items-center gap-2">
          <a
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-2"
            href={`/api/reports?run_id=${encodeURIComponent(runId)}&download=1`}
          >
            下载
          </a>
          <button
            type="button"
            className="rounded border border-line-strong px-3 py-1 text-xs text-ink-2 hover:border-accent hover:text-ink"
            onClick={() => window.close()}
          >
            关闭
          </button>
        </span>
      </div>
      <iframe
        src={`/api/reports?run_id=${encodeURIComponent(runId)}`}
        sandbox="allow-scripts"
        title="分析报告"
        className="w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
