import type { CalendarEvent, CalendarSource } from "../../calendar/types";

export function LinkView({ events, sources }: { events: CalendarEvent[]; sources: CalendarSource[] }) {
  const withLinks = events.filter(e => e.location || e.description?.includes("http"));
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
      <div className="mb-3 text-[9px] font-bold uppercase tracking-widest text-[#2a2a2a]">Events with links</div>
      {!withLinks.length && <div className="text-center py-12 text-[11px] text-[#222]">No events with links found.</div>}
      <div className="flex flex-col gap-2">
        {withLinks.map(ev => {
          const src = sources.find(s => s.id === ev.calendarId);
          const color = ev.color || src?.color || "#5865f2";
          const link = ev.location || ev.description?.match(/https?:\/\/[^\s]+/)?.[0];
          return (
            <div key={ev.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-[#151515] bg-[#0e0e0e]">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] font-semibold text-[#ddd] truncate">{ev.title}</div>
                {link && <div className="text-[9px] text-[#5865f2] truncate mt-0.5">{link}</div>}
              </div>
              {link && <a href={link} target="_blank" rel="noreferrer"
                className="shrink-0 h-6 px-2 rounded-lg bg-[#5865f2]/10 border border-[#5865f2]/20 text-[9px] font-bold text-[#5865f2] hover:bg-[#5865f2]/20 transition-colors">Open</a>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
