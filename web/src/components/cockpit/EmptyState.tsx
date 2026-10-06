// 空态：居中灰字一行 + 可选补充提示。
export default function EmptyState({ text, hint }: { text: string; hint?: string }) {
  return (
    <div className="py-10 text-center text-sm text-ck-ink-3">
      {text}
      {hint != null && <div className="mt-1 text-xs">{hint}</div>}
    </div>
  );
}
