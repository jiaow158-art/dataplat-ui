// ED-1 L9 基于本事件继续问 AI：沿用既有 followup 链路（BFF 种子会话 + 问数六步法），
// 追问模板只从结构化字段派生（entities.name/type——不读自由文本猜原因，修正要求），
// 与既有通用 prompts 并列；onAsk 由页面注入（页头「继续AI分析」复用同一编排）。
import SectionCard from "../cockpit/SectionCard";

/** 从结构化 entities 派生至多 2 个具体追问（仅用 name/type 字段拼接，零文本推测）。 */
export function deriveFollowupPrompts(
  entities: Array<{ name: string; type: string }>,
): string[] {
  const out: string[] = [];
  for (const e of entities) {
    if (out.length >= 2) break;
    if (/客户/.test(e.type)) out.push(`重点分析 ${e.name} 的相关变化`);
    else if (/渠道|运营中心|销售组|工程中心/.test(e.type)) out.push(`按 ${e.name} 继续拆解分析`);
  }
  return out;
}

export default function EventFollowupPanel({
  prompts, busy, onAsk, err,
}: {
  prompts: string[];
  busy: boolean;
  err: string | null;
  onAsk: (prompt?: string) => void;
}) {
  return (
    <SectionCard title="基于本事件继续问 AI">
      <div className="flex flex-wrap gap-2">
        {prompts.map((p) => (
          <button
            key={p}
            type="button"
            disabled={busy}
            onClick={() => onAsk(p)}
            className="rounded-full border border-ck-primary/40 bg-ck-primary-soft px-3 py-1.5 text-sm text-ck-primary transition-colors hover:border-ck-primary disabled:opacity-50"
          >
            {p}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => onAsk()}
          className="rounded-lg bg-ck-primary px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-ck-primary-hover disabled:opacity-50"
        >
          {busy ? "创建中…" : "继续分析"}
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-ck-danger">{err}</p>}
    </SectionCard>
  );
}
