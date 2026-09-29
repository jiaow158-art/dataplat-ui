import type { InsightTimelineItem } from "../../types";
import { severityStyle } from "./BusinessEventCard";

export default function BusinessEventTimeline({
  items, onOpen,
}: { items: InsightTimelineItem[]; onOpen: (id: string) => void }) {
  if (!items.length) return <div className="p-4 text-sm text-slate-400">近期无事件</div>;
  return (
    <ul className="divide-y divide-slate-100">
      {items.map((it) => {
        const st = severityStyle(it);
        return (
          <li key={it.eventId}>
            <button
              className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-slate-50"
              onClick={() => onOpen(it.eventId)}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${st.bar}`} />
              <span className="flex-1 truncate text-sm text-slate-700">{it.title}</span>
              <span className="shrink-0 text-xs text-slate-400">{it.dataDate}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
