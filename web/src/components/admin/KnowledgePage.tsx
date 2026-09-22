// 知识库管理入口（知识健康治理 §四）：左侧文件列表（按域分组）→ 右侧等宽编辑器。
// 保存即发布：确认弹层明示"将触发 79 场景离线回归"→ 调 BFF → harness 脚本 git commit 过 C2 门。
// 结果面板：成功显示 sha+eval 摘要；门拒显示尾部清单——内容保留在编辑器不丢，改完可再发。
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, apiAdminKnowledgeFile, apiAdminKnowledgeFiles, apiAdminKnowledgePublish } from "../../api";
import type { KnowledgeFileMeta, KnowledgePublishResult } from "../../types";
import { fmtTs } from "./format";

const fmtSize = (n: number): string => (n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`);

/** 按域分组（列表已升序，组内保持路径序）。 */
function groupByDomain(files: KnowledgeFileMeta[]): { domain: string; files: KnowledgeFileMeta[] }[] {
  const groups: { domain: string; files: KnowledgeFileMeta[] }[] = [];
  for (const f of files) {
    const last = groups[groups.length - 1];
    if (last && last.domain === f.domain) last.files.push(f);
    else groups.push({ domain: f.domain, files: [f] });
  }
  return groups;
}

export default function KnowledgePage() {
  const [files, setFiles] = useState<KnowledgeFileMeta[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [origin, setOrigin] = useState(""); // 加载时内容（脏判定基准）
  const [loadFileError, setLoadFileError] = useState<string | null>(null);
  const [loadingFile, setLoadingFile] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState("");
  const [publishing, setPublishing] = useState(false);
  const [result, setResult] = useState<KnowledgePublishResult | null>(null);

  const refreshFiles = useCallback(async () => {
    try {
      setFiles(await apiAdminKnowledgeFiles());
      setLoaded(true);
    } catch (err) {
      setListError(err instanceof ApiError ? err.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void refreshFiles();
  }, [refreshFiles]);

  const open = useCallback(async (path: string) => {
    setSelected(path);
    setResult(null);
    setLoadFileError(null);
    setLoadingFile(true);
    try {
      const r = await apiAdminKnowledgeFile(path);
      setContent(r.content);
      setOrigin(r.content);
      setMessage(`知识更新: ${path.split("/").pop()}`);
    } catch (err) {
      setLoadFileError(err instanceof ApiError ? err.message : "读取失败");
      setContent("");
      setOrigin("");
    } finally {
      setLoadingFile(false);
    }
  }, []);

  const dirty = content !== origin;
  const groups = useMemo(() => groupByDomain(files), [files]);

  const publish = useCallback(async () => {
    if (!selected) return;
    setPublishing(true);
    setResult(null);
    try {
      const r = await apiAdminKnowledgePublish(selected, content, message.trim());
      setResult(r);
      setConfirming(false);
      if (r.ok) {
        setOrigin(content); // 已提交：以编辑器内容为新基准
        await refreshFiles(); // mtime/size 刷新
      }
      // 门拒：编辑器内容原样保留，改完可再发
    } catch (err) {
      setConfirming(false);
      setResult({ ok: false, reason: "network", gate_output: [err instanceof ApiError ? err.message : "请求失败"] });
    } finally {
      setPublishing(false);
    }
  }, [selected, content, message, refreshFiles]);

  return (
    <div className="flex h-full min-h-0">
      {/* 左：文件列表（按域分组） */}
      <aside className="flex w-72 shrink-0 flex-col overflow-y-auto border-r border-line bg-panel">
        <div className="border-b border-line px-4 py-3 text-xs text-ink-3">
          {loaded ? `${files.length} 个可编辑文件 / ${groups.length} 域` : "加载中…"}
        </div>
        {listError && <div className="px-4 py-3 text-xs text-bad">{listError}</div>}
        {groups.map((g) => (
          <div key={g.domain} className="border-b border-line/60 last:border-b-0">
            <div className="px-4 pb-1 pt-3 text-[11px] font-medium text-accent-2">{g.domain}</div>
            {g.files.map((f) => {
              const name = f.path.split("/").slice(2).join("/");
              const active = f.path === selected;
              return (
                <button
                  key={f.path}
                  type="button"
                  className={`block w-full truncate px-4 py-1.5 text-left text-xs transition-colors ${
                    active ? "bg-accent-soft text-ink" : "text-ink-2 hover:bg-lift hover:text-ink"
                  }`}
                  title={`${f.path}\n${fmtSize(f.size)} · ${fmtTs(f.mtime)}`}
                  onClick={() => void open(f.path)}
                >
                  {name}
                </button>
              );
            })}
          </div>
        ))}
        {loaded && files.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-ink-3">（无可编辑文件——检查服务端 HARNESS_DIR）</div>
        )}
      </aside>

      {/* 右：编辑器 + 结果面板 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-line bg-panel px-5 py-3">
          <span className="truncate font-mono text-xs text-ink" title={selected ?? undefined}>
            {selected ?? "选择左侧文件开始编辑"}
          </span>
          {selected && (
            <span className={`text-[11px] ${dirty ? "text-warn" : "text-ink-3"}`}>{dirty ? "未保存" : "与已发布一致"}</span>
          )}
          <span className="ml-auto" />
          <button
            type="button"
            className="rounded bg-accent px-3 py-1.5 text-xs text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!selected || !dirty || publishing || loadingFile}
            onClick={() => setConfirming(true)}
          >
            保存并发布
          </button>
        </div>

        {loadFileError && <div className="border-b border-bad/40 bg-bad/10 px-5 py-2 text-xs text-bad">{loadFileError}</div>}

        <textarea
          className="min-h-0 flex-1 resize-none bg-base px-5 py-4 font-mono text-xs leading-5 text-ink outline-none"
          spellCheck={false}
          placeholder={selected ? "" : "左侧选择知识文件（metrics.md / SKILL.md 等）"}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          disabled={!selected || publishing}
        />

        {/* 发布结果面板（最近一次） */}
        {result && (
          <div
            className={`max-h-56 shrink-0 overflow-y-auto border-t px-5 py-3 text-xs ${
              result.ok ? "border-good/40 bg-good/5" : "border-bad/40 bg-bad/10"
            }`}
          >
            {result.ok ? (
              <div className="text-good">
                <div>
                  ✓ 已发布 <span className="font-mono" title={result.sha}>{result.sha?.slice(0, 12)}</span>（knowledge-ui 提交，已过发布门）
                </div>
                {result.eval_summary && <div className="mt-1 font-mono text-[11px] text-ink-2">{result.eval_summary}</div>}
              </div>
            ) : (
              <div className="text-bad">
                <div>
                  ✗ 未发布
                  {result.reason === "gate"
                    ? "——离线回归未全过，内容已还原（编辑器内容保留，修复后可再发）"
                    : `（${result.reason ?? "未知原因"}）`}
                </div>
                {result.gate_output && result.gate_output.length > 0 && (
                  <pre className="mt-1 max-h-32 overflow-y-auto whitespace-pre-wrap rounded bg-base/60 p-2 font-mono text-[11px] text-ink-2">
                    {result.gate_output.join("\n")}
                  </pre>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 确认弹层：保存即发布 */}
      {confirming && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[28rem] rounded-lg border border-line bg-panel p-5 shadow-xl">
            <div className="text-sm font-semibold text-ink">确认发布</div>
            <div className="mt-2 truncate font-mono text-xs text-ink-2" title={selected}>{selected}</div>
            <div className="mt-3 rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
              保存即发布：将触发 79 场景离线回归（可能需要数分钟），期间请勿重复操作。
              回归未全过时改动会被自动还原。
            </div>
            <label className="mt-3 block text-xs text-ink-3">
              提交说明（commit message）
              <input
                autoFocus
                className="mt-1 w-full rounded border border-line bg-card px-2 py-1.5 text-xs text-ink outline-none focus:border-accent"
                maxLength={200}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                disabled={publishing}
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-line px-3 py-1.5 text-xs text-ink-2 transition-colors hover:border-accent hover:text-ink"
                disabled={publishing}
                onClick={() => setConfirming(false)}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded bg-accent px-3 py-1.5 text-xs text-white hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={publishing || !message.trim()}
                onClick={() => void publish()}
              >
                {publishing ? "回归运行中…" : "确认发布"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
