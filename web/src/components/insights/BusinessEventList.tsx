import type { InsightDailyEvent } from "../../types";
import BusinessEventCard from "./BusinessEventCard";

export default function BusinessEventList({
  events, onOpen,
}: { events: InsightDailyEvent[]; onOpen: (id: string) => void }) {
  if (!events.length) {
    return (
      <div className="rounded-xl bg-white p-8 text-center text-sm text-slate-400 ring-1 ring-slate-100">
        今日暂无重大经营异常
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {events.map((e, i) => (
        <BusinessEventCard key={e.eventId} event={e} rank={i + 1} onOpen={onOpen} />
      ))}
    </div>
  );
}
