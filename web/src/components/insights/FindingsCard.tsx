// ED-1 L4 主要影响因素：归因 findings 原文条目卡（零改写——不提炼标题、不抽数值冒充结论、
// 不改写因果表述；每条自带查询证据 ref）。脚注明示：贡献项/变化来源 ≠ 已证明的因果根因。
import SectionCard from "../cockpit/SectionCard";

export default function FindingsCard({ findings }: { findings: Array<{ text: string; evidence: string }> }) {
  if (!findings.length) return null;
  return (
    <SectionCard title="主要影响因素" extra={`${findings.length} 条 · 均附查询证据`}>
      <ol className="flex flex-col gap-3">
        {findings.map((f, i) => (
          <li key={i} className="flex gap-3">
            <span className="mt-0.5 shrink-0 font-mono text-xs text-ck-primary">
              {String(i + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0">
              <p className="text-sm leading-6 text-ck-ink-2">{f.text}</p>
              <p className="mt-1 break-all text-[11px] text-ck-ink-3">证据：{f.evidence}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-ck-line pt-3 text-[11px] leading-5 text-ck-ink-3">
        以上为归因证据支持的变化来源与贡献项，不等同于已证明的因果根因；完整下钻路径见下方「完整分析路径」。
      </p>
    </SectionCard>
  );
}
