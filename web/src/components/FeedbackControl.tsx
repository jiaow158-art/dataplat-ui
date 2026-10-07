// 用户反馈闭环（知识健康治理 §三B）：已完成回答气泡下的低调「有问题」入口。
// 展开行内表单：分类四选一（必填）+ 描述（选填 ≤500 字）→ POST /api/feedback；
// 成功后收起并显示"已记录，感谢反馈"（同回合不再重复提交）。用户内容仅文本渲染（红线）。
import { useState } from "react";
import { ApiError, apiSubmitFeedback } from "../api";
import type { FeedbackCategory } from "../types";

const CATEGORIES: FeedbackCategory[] = ["数值不对", "口径不对", "看不懂", "其他"];

export default function FeedbackControl({ runId, uiSessionId }: { runId: string; uiSessionId?: string }) {
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory | "">("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!category || busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiSubmitFeedback(runId, category, description.trim() || undefined, uiSessionId);
      setDone(true); // 成功：按钮置灰（入口不再渲染），短状态常驻
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "提交失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return <div className="text-xs text-ck-ink-3">已记录，感谢反馈</div>;
  }

  if (!open) {
    return (
      <button
        type="button"
        className="w-fit rounded px-1 py-0.5 text-xs text-ck-ink-3 transition-colors hover:text-ck-ink"
        onClick={() => setOpen(true)}
      >
        有问题
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-ck-line bg-ck-card px-3 py-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-ck-ink-2">这个问题属于：</span>
        <select
          className="rounded border border-ck-line bg-ck-card px-2 py-1 text-xs text-ck-ink outline-none focus:border-ck-primary"
          value={category}
          onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
          disabled={busy}
        >
          <option value="">选择分类（必填）</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className="min-h-[3rem] resize-y rounded border border-ck-line bg-ck-card px-2.5 py-1.5 text-xs text-ck-ink outline-none focus:border-ck-primary"
        rows={2}
        maxLength={500}
        placeholder="补充说明（选填，≤500 字）：期望的数值/口径或看不懂的位置"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        disabled={busy}
      />
      {error && <div className="text-ck-danger">{error}</div>}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="rounded bg-ck-primary px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-ck-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy || !category}
          onClick={() => void submit()}
        >
          {busy ? "提交中…" : "提交反馈"}
        </button>
        <button
          type="button"
          className="rounded px-2 py-1 text-xs text-ck-ink-3 transition-colors hover:text-ck-ink"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          取消
        </button>
      </div>
    </div>
  );
}
