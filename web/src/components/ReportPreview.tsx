// UI-T7 报告预览壳页（路由 /report?run_id=，新窗打开）。
// 方案取舍：选「最小壳页 + iframe sandbox="allow-scripts"」而非直接新窗打开 /api/reports——
// 1) spec §6.4 指定 iframe sandbox；2) 不带 allow-same-origin 的 sandbox 使引擎产出的不可信
// HTML 运行在 opaque origin，即使绕过 BFF CSP 也读不到本站 cookie/storage、发不出带凭据的
// 同源请求（纵深防御）；3) ECharts 内联脚本照常运行（allow-scripts）。
// iframe 直连 /api/reports（非 blob）：保留 BFF 侧 CSP/nosniff 响应头这道已测试的闸。
// P3：壳页浅色化（裁定：仅改壳——iframe 内报告正文是引擎产物，自带主题不强行覆盖）。
export default function ReportPreview() {
  const runId = new URLSearchParams(window.location.search).get("run_id");

  if (!runId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-ck-bg text-sm text-ck-ink-2">
        <div className="text-ck-danger">缺少 run_id 参数</div>
        <button type="button" className="rounded border border-ck-line-strong px-3 py-1 text-xs hover:border-ck-primary" onClick={() => window.close()}>
          关闭
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-ck-bg">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-ck-line bg-ck-card px-4">
        <span className="flex items-center gap-2 text-xs text-ck-ink-2">
          <span className="font-medium text-ck-ink">分析报告</span>
          <span className="text-ck-ink-3">{runId}</span>
        </span>
        <span className="flex items-center gap-2">
          <a
            className="rounded bg-ck-primary px-3 py-1 text-xs font-medium text-white hover:bg-ck-primary-hover"
            href={`/api/reports?run_id=${encodeURIComponent(runId)}&download=1`}
          >
            下载
          </a>
          <button
            type="button"
            className="rounded border border-ck-line-strong px-3 py-1 text-xs text-ck-ink-2 hover:border-ck-primary hover:text-ck-ink"
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
