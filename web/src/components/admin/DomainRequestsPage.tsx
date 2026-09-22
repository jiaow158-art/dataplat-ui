// 域申请队列（知识健康治理 §四C 扩域入口）：同 incidents 风格——过滤（全部/待受理/受理/搁置/驳回）
// + 表格（时间/用户/域名/典型问题/急迫度/状态/操作）。操作按状态渲染：
// 待受理→受理/搁置/驳回；受理→搁置/驳回；搁置→受理/驳回；驳回→重开。note 行内可编辑。
import { Fragment, useCallback, useEffect, useState } from "react";
import { ApiError, apiAdminDomainRequests, apiAdminUpdateDomainRequest } from "../../api";
import type { DomainRequestRow, DomainRequestStatus } from "../../types";
import { fmtTs, oneLine } from "./format";

const STATUS_FILTERS: { value: DomainRequestStatus | null; label: string }[] = [
  { value: null, label: "全部" },
  { value: "待受理", label: "待受理" },
  { value: "受理", label: "受理" },
  { value: "搁置", label: "搁置" },
  { value: "驳回", label: "驳回" },
];

const STATUS_CLASS: Record<DomainRequestStatus, string> = {
  待受理: "text-ink",
  受理: "text-good",
  搁置: "text-warn",
  驳回: "text-ink-3",
};

const URGENCY_CLASS: Record<string, string> = { 高: "text-bad", 中: "text-warn", 低: "text-ink-3" };

/** 行内编辑态：note=编辑处置备注。 */
type Editor = { id: string; kind: "note" } | null;

export default function DomainRequestsPage() {
  const [filter, setFilter] = useState<DomainRequestStatus | null>(null);
  const [rows, setRows] = useState<DomainRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [editor, setEditor] = useState<Editor>(null);
  const [noteInput, setNoteInput] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRows(await apiAdminDomainRequests(filter ?? undefined));
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

  const patch = (id: string, body: Parameters<typeof apiAdminUpdateDomainRequest>[1]) =>
    guard(async () => {
      await apiAdminUpdateDomainRequest(id, body);
      setEditor(null);
      setNoteInput("");
      await refresh();
    });

  const openNote = (id: string) => {
    setEditor(editor?.id === id ? null : { id, kind: "note" });
    setNoteInput(rows.find((r) => r.id === id)?.note ?? "");
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
              <th className="px-4 py-2.5 font-medium">域名</th>
              <th className="px-4 py-2.5 font-medium">典型问题</th>
              <th className="px-4 py-2.5 font-medium">急迫度</th>
              <th className="px-4 py-2.5 font-medium">状态</th>
              <th className="px-4 py-2.5 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {!loaded && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-3">加载中…</td>
              </tr>
            )}
            {loaded && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-3">（暂无申请）</td>
              </tr>
            )}
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-b border-line/60 align-top last:border-b-0">
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-3">{fmtTs(r.created_at)}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-ink-2">{r.username}</td>
                  <td className="whitespace-nowrap px-4 py-2.5 font-medium text-ink">{r.domain_name}</td>
                  <td className="max-w-[20rem] px-4 py-2.5">
                    <div className="text-ink-2">{oneLine(r.example_questions, 60) || "—"}</div>
                    {r.note && <div className="mt-0.5 text-[11px] text-accent-2">备注：{oneLine(r.note, 60)}</div>}
                  </td>
                  <td className={`whitespace-nowrap px-4 py-2.5 font-medium ${URGENCY_CLASS[r.urgency] ?? "text-ink-3"}`}>{r.urgency}</td>
                  <td className={`whitespace-nowrap px-4 py-2.5 font-medium ${STATUS_CLASS[r.status] ?? "text-ink-3"}`}>{r.status}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      {(r.status === "待受理" || r.status === "搁置") && (
                        <button type="button" className={`${btn} text-good hover:border-good`} disabled={busy} onClick={() => patch(r.id, { status: "受理" })}>
                          受理
                        </button>
                      )}
                      {r.status === "待受理" && (
                        <button type="button" className={`${btn} text-warn hover:border-warn`} disabled={busy} onClick={() => patch(r.id, { status: "搁置" })}>
                          搁置
                        </button>
                      )}
                      {(r.status === "待受理" || r.status === "受理" || r.status === "搁置") && (
                        <button type="button" className={`${btn} text-ink-3 hover:border-bad hover:text-bad`} disabled={busy} onClick={() => patch(r.id, { status: "驳回" })}>
                          驳回
                        </button>
                      )}
                      {r.status === "驳回" && (
                        <button type="button" className={`${btn} text-ink-2 hover:border-accent hover:text-ink`} disabled={busy} onClick={() => patch(r.id, { status: "待受理" })}>
                          重开
                        </button>
                      )}
                      <button type="button" className={`${btn} text-ink-3 hover:border-accent hover:text-ink`} disabled={busy} onClick={() => openNote(r.id)}>
                        备注
                      </button>
                    </span>
                  </td>
                </tr>
                {editor?.id === r.id && editor.kind === "note" && (
                  <tr className="border-b border-line/60 bg-lift/40">
                    <td colSpan={7} className="px-4 py-2.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-ink-3">处置备注（受理计划/驳回理由等）：</span>
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
                          onClick={() => patch(r.id, { note: noteInput })}
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
