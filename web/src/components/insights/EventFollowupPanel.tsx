import { useState } from "react";
import { ApiError, apiInsightFollowup } from "../../api";

export default function EventFollowupPanel({
  eventId, prompts, onFollowed,
}: { eventId: string; prompts: string[]; onFollowed: (r: { uiSessionId: string; seedQuestion: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const go = async (prompt?: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await apiInsightFollowup(eventId, prompt);
      onFollowed(r);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "追问创建失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-xl bg-white p-6 ring-1 ring-slate-100">
      <h3 className="text-sm font-semibold text-slate-900">基于本事件继续问 AI</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {prompts.map((p) => (
          <button key={p} disabled={busy} onClick={() => void go(p)}
            className="rounded-full bg-blue-50 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-100 disabled:opacity-50">
            {p}
          </button>
        ))}
        <button disabled={busy} onClick={() => void go()}
          className="rounded-lg bg-blue-600 px-4 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50">
          继续分析
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-red-500">{err}</p>}
    </div>
  );
}
