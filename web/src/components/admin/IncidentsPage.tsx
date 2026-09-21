// 用户反馈闭环·管理队列（知识健康治理 §三B）：过滤（全部/待归因/修复中/已发布/驳回）+
// 表格（时间/用户/分类/问题文本/状态/操作）。操作按状态渲染：
// 待归因→去归因(跳审计 run 详情)/开始修复/驳回；修复中→标记已发布(填 fix_commit)/驳回；
// 驳回→重开；已发布→只读短 sha。resolution_note 行内可编辑。闭环链：用户反馈→知识 commit→回写 sha。
import { Fragment, useCallback, useEffect, useState } from "react";
import { ApiError, apiAdminIncidents, apiAdminUpdateIncident } from "../../api";
import type { IncidentRow, IncidentStatus } from "../../types";
import { fmtTs, oneLine } from "./format";

const STATUS_FILTERS: { value: IncidentStatus | null; label: string }[] = [
  { value: null, label: "全部" },
  { value: "待归因", label: "待归因" },
  { value: "修复中", label: "修复中" },
  { value: "已发布", label: "已发布" },
  { value: "驳回", label: "驳回" },
];

const STATUS_CLASS: Record<IncidentStatus, string> = {
  待归因: "text-ink",
  修复中: "text-accent-2",
  已发布: "text-good",
  驳回: "text-ink-3",
};

/** 行内编辑态：publish=标记已发布填 fix_commit；note=编辑 resolution_note。 */
type Editor = { id: string; kind: "publish" | "note" } | null;

export default function IncidentsPage({ onOpenRun }: { onOpenRun: (runId: string) => void }) {
  const [filter, setFilter] = useState<IncidentStatus | null>(null);
  const [rows, setRows] = useState<IncidentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [commitInput, setCommitInput] = useState("");
  const [noteInput, setNoteInput] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRows(await apiAdminIncidents(filter ?? undefined));
      setLoaded(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载失败");
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  const patch = (id: string, body: Parameters<typeof apiAdminUpdateIncident>[1]) =>
    guard(async () => {
      await apiAdminUpdateIncident(id, body);
      setEditor(null);
      setCommitInput("");
      setNoteInput("");
      await refresh();
    });

  const openEditor = (id: string, kind: "publish" | "note") => {
    setEditor(editor?.id === id && editor.kind === kind ? null : { id, kind });
    setCommitInput("");
    const row = rows.find((r) => r.id === id);
    setNoteInput(row?.resolution_note ?? "");
  };

  const btn = "rounded border border-line px-2 py-0.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50";

  return (
    <div className="mx-auto max-w-5xl px-6 py-5">
      {error && <div className="mb-4 rounded border border-bad/40 bg-bad/10 px-3 py-2 text-xs text-bad">{error}</div>}

      <div className="mb-4 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-panel p-1">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.label}
            type="button"
            className={`rounded px-3 py-1.5 text-xs transition-colors ${
              filter === f.value ? "bg-accent-soft text-ink" : "text-ink-3 hover:text-ink"
            }`}
            onClick={() => setFilter(f.value)}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto px-2 text-[11px] text-ink-3">{loaded ? `${rows.length} 条` : ""}</span>
      </div>

      <section className="overflow-hidden rounded-lg border border-line bg-panel">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line text-left text-ink-3">
              <th className="px-4 py-2.5 font-medium">时间</th>
              <th className="px-4 py-2.5 font-medium">用户</th>
              <th className="px-4 py-2.5 font-medium">分类</th>
              <th className="px-4 py-2.5 font-medium">问题文本</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {!loaded && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-3">
                  加载中…
                </td>
              </tr>
            )}
            {loaded && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-ink-3">
                  （暂无反馈）
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-b border-line/60 align-top last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-3">{fmtTs(r.created_at)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">{r.username}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink">{r.category}</td>
                  <td className="max-w-[22rem] px-4 py-2.5">
                    <div className="text-ink-2">{oneLine(r.question, 40) || "—"}</div>
                    {r.description && <div className="mt-0.5 text-[11px] text-ink-3">用户说：{oneLine(r.description, 60)}</div>}
                    {r.resolution_note && <div className="mt-0.5 text-[11px] text-accent-2">备注：{oneLine(r.resolution_note, 60)}</div>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5">
                    <span className={`font-medium ${STATUS_CLASS[r.status] ?? "text-ink-3"}`}>{r.status}</span>
                    {r.status === "已发布" && r.fix_commit && (
                      <div className="mt-0.5 font-mono text-[10px] text-ink-3" title={r.fix_commit}>
                        {r.fix_commit.slice(0, 7)}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      {r.status === "待归因" && (
                        <>
                          <button type="button" className={`${btn} text-ink-2 hover:border-accent hover:text-ink`} disabled={busy} onClick={() => onOpenRun(r.run_id)}>
                            去归因
                          </button>
                          <button type="button" className={`${btn} text-ink-2 hover:border-accent hover:text-ink`} disabled={busy} onClick={() => patch(r.id, { status: "修复中" })}>
                            开始修复
                          </button>
                          <button type="button" className={`${btn} text-ink-3 hover:border-bad hover:text-bad`} disabled={busy} onClick={() => patch(r.id, { status: "驳回" })}>
                            驳回
                          </button>
                        </>
                      )}
                      {r.status === "修复中" && (
                        <>
                          <button type="button" className={`${btn} text-good hover:border-good`} disabled={busy} onClick={() => openEditor(r.id, "publish")}>
                            标记已发布
                          </button>
                          <button type="button" className={`${btn} text-ink-3 hover:border-bad hover:text-bad`} disabled={busy} onClick={() => patch(r.id, { status: "驳回" })}>
                            驳回
                          </button>
                        </>
                      )}
                      {r.status === "驳回" && (
                        <button type="button" className={`${btn} text-ink-2 hover:border-accent hover:text-ink`} disabled={busy} onClick={() => patch(r.id, { status: "待归因" })}>
                          重开
                        </button>
                      )}
                      <button type="button" className={`${btn} text-ink-3 hover:border-accent hover:text-ink`} disabled={busy} onClick={() => openEditor(r.id, "note")}>
                        备注
                      </button>
                    </span>
                  </td>
                </tr>
                {editor?.id === r.id && editor.kind === "publish" && (
                  <tr className="border-b border-line/60 bg-lift/40">
                    <td colSpan={6} className="px-4 py-2.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-ink-3">知识修复过发布门后的 commit sha：</span>
                        <input
                          autoFocus
                          className="w-72 rounded border border-line bg-card px-2 py-1 font-mono text-xs text-ink outline-none focus:border-accent"
                          placeholder="8-40 位 hex，如 0f1e2d3c"
                          value={commitInput}
                          onChange={(e) => setCommitInput(e.target.value.trim())}
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className="rounded bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-2 disabled:opacity-50"
                          disabled={busy || !/^[0-9a-f]{8,40}$/.test(commitInput)}
                          onClick={() => patch(r.id, { status: "已发布", fix_commit: commitInput })}
                        >
                          确认发布
                        </button>
                        <button type="button" className="rounded px-2 py-1 text-xs text-ink-3 hover:text-ink" onClick={() => setEditor(null)}>
                          取消
                        </button>
                      </span>
                    </td>
                  </tr>
                )}
                {editor?.id === r.id && editor.kind === "note" && (
                  <tr className="border-b border-line/60 bg-lift/40">
                    <td colSpan={6} className="px-4 py-2.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-ink-3">处置备注（归因结论/驳回理由等）：</span>
                        <input
                          autoFocus
                          className="w-72 rounded border border-line bg-card px-2 py-1 text-xs text-ink outline-none focus:border-accent"
                          maxLength={500}
                          value={noteInput}
                          onChange={(e) => setNoteInput(e.target.value)}
                          disabled={busy}
                        />
                        <button
                          type="button"
                          className="rounded bg-accent px-2.5 py-1 text-xs text-white hover:bg-accent-2 disabled:opacity-50"
                          disabled={busy}
                          onClick={() => patch(r.id, { resolution_note: noteInput })}
                        >
                          保存备注
                        </button>
                        <button type="button" className="rounded px-2 py-1 text-xs text-ink-3 hover:text-ink" onClick={() => setEditor(null)}>
                          取消
                        </button>
                      </span>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
