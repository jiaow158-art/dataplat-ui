// UI-T5 主区壳：会话标题栏 + 对话流滚动区 + 底部输入框（对话流与发送在 UI-T6 接线）。
import { useState } from "react";
import type { UiSession } from "../types";

export default function ChatView({ session }: { session: UiSession | null }) {
  const [draft, setDraft] = useState("");

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-base">
      <div className="flex h-12 shrink-0 items-center border-b border-line bg-panel px-5">
        <span className="truncate text-sm text-ink-2">{session ? session.title : "新会话"}</span>
      </div>

      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center px-4 py-10 text-center">
          <div className="mb-2 text-lg font-medium text-ink">问点什么吧</div>
          <div className="text-xs text-ink-3">例如：上月瓷砖事业部库存周转情况如何？</div>
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-panel px-4 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-end gap-2">
          <textarea
            className="max-h-40 min-h-[2.5rem] flex-1 resize-none rounded border border-line bg-card px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            rows={1}
            placeholder="输入问题，Enter 发送（Shift+Enter 换行）"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled /* UI-T6 接线：/api/ask + SSE 事件流 */
          />
          <button
            type="button"
            className="rounded bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-50"
            disabled
          >
            提问
          </button>
        </div>
      </div>
    </main>
  );
}
