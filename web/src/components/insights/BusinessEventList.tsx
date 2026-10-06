import type { InsightDailyEvent } from "../../types";
import EmptyState from "../cockpit/EmptyState";
import BusinessEventCard from "./BusinessEventCard";

export default function BusinessEventList({
  events, onOpen,
}: { events: InsightDailyEvent[]; onOpen: (id: string) => void }) {
  if (!events.length) {
    return <EmptyState text="今日暂无重大经营异常" />;
  }
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
      {events.map((e, i) => (
        <BusinessEventCard key={e.eventId} event={e} rank={i + 1} onOpen={onOpen} />
      ))}
    </div>
  );
}
