export default function EventFactCards({ facts }: { facts: Array<{ label: string; value: string }> }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {facts.slice(0, 4).map((f) => (
        <div key={f.label} className="rounded-xl bg-white p-4 ring-1 ring-slate-100">
          <div className="text-xs text-slate-400">{f.label}</div>
          <div className="mt-1 text-lg font-semibold text-slate-900">{f.value}</div>
        </div>
      ))}
    </div>
  );
}
