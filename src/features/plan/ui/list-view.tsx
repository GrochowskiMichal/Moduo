import { useMemo } from "react";
import type { CalendarEvent, CalendarSource } from "../../calendar/types";
import type { Task, TaskWorkflowState } from "../../tasks/types";

const DAY_ABR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad(n: number) { return String(n).padStart(2, "0"); }
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function isToday(d: Date) { return isSameDay(d, new Date()); }
function fmtTime(d: Date) {
  const h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? "PM" : "AM";
  const hr = h % 12 || 12;
  return m === 0 ? `${hr} ${ap}` : `${hr}:${pad(m)} ${ap}`;
}

export function ListView({ events, tasks, taskStates, sources, showEvents, showTasks, onClickEvent, onSelectTask, onOpenTaskContextMenu }: {
  events: CalendarEvent[]; tasks: Task[]; taskStates: TaskWorkflowState[]; sources: CalendarSource[];
  showEvents: boolean; showTasks: boolean; onClickEvent: (id: string) => void; onSelectTask: (id: string) => void;
  onOpenTaskContextMenu?: (taskId: string, x: number, y: number) => void;
}) {
  const grouped = useMemo(() => {
    const map = new Map<string, { events: CalendarEvent[]; tasks: Task[] }>();
    const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (showEvents) events.forEach(ev => { const k = key(new Date(ev.startTime)); if (!map.has(k)) map.set(k, { events: [], tasks: [] }); map.get(k)!.events.push(ev); });
    if (showTasks) {
      const doneIds = new Set(taskStates.filter(s => s.kind === "done" || s.kind === "canceled").map(s => s.id));
      tasks.filter(t => !t.deletedAt && t.dueDate && !doneIds.has(t.stateId)).forEach(t => {
        const k = t.dueDate!; if (!map.has(k)) map.set(k, { events: [], tasks: [] }); map.get(k)!.tasks.push(t);
      });
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, items]) => ({ date: new Date(`${date}T00:00:00`), items }));
  }, [events, tasks, taskStates, showEvents, showTasks]);

  if (!grouped.length) return <div className="flex h-full items-center justify-center text-[12px] text-[#222]">Nothing scheduled.</div>;
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 flex flex-col gap-4">
      {grouped.map(({ date, items }) => {
        const tod = isToday(date);
        return (
          <div key={date.toISOString()}>
            <div className={`flex items-center gap-2 mb-1.5 ${tod ? "text-[#d4d4d4]" : "text-[#444]"}`}>
              <span className="text-[9px] font-bold uppercase tracking-widest">{DAY_ABR[date.getDay()]}</span>
              <span className="text-[11px] font-bold">{date.getDate()} {MONTHS[date.getMonth()]}</span>
              {tod && <span className="text-[9px] font-bold bg-[#2a2a2a] text-[#f1f1f1] px-1.5 py-0.5 rounded-full">Today</span>}
            </div>
            <div className="flex flex-col gap-1">
              {items.events.map(ev => {
                const src = sources.find(s => s.id === ev.calendarId);
                const color = ev.color || src?.color || "#5865f2";
                return (
                  <button key={ev.id} onClick={() => onClickEvent(ev.id)}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[#151515] bg-[#0e0e0e] hover:bg-[#131313] hover:border-[#1e1e1e] transition-all text-left w-full">
                    <div className="shrink-0 w-0.5 h-8 rounded-full" style={{ background: color }} />
                    <div><div className="text-[11px] font-semibold text-[#ddd]">{ev.title || "Event"}</div>
                      <div className="text-[9px] text-[#444] mt-0.5">{fmtTime(new Date(ev.startTime))} – {fmtTime(new Date(ev.endTime))}</div></div>
                  </button>
                );
              })}
              {items.tasks.map(t => {
                const c = t.priority === 0 ? "#ff5252" : t.priority === 1 ? "#f0a43d" : t.priority === 2 ? "#2f8fff" : t.priority === 3 ? "#2fbf71" : "#616978";
                const st = taskStates.find(s => s.id === t.stateId);
                return (
                  <button
                    key={t.id}
                    onClick={() => onSelectTask(t.id)}
                    onContextMenu={(event) => {
                      if (!onOpenTaskContextMenu) return;
                      event.preventDefault();
                      onOpenTaskContextMenu(t.id, event.clientX, event.clientY);
                    }}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl border border-[#151515] bg-[#0e0e0e] hover:bg-[#131313] hover:border-[#1e1e1e] transition-all text-left w-full">
                    <div className="shrink-0 w-4 h-4 rounded-md border grid place-items-center" style={{ borderColor: `${c}40` }}>
                      <span className="text-[8px]" style={{ color: c }}>✓</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-[11px] font-semibold text-[#ddd] truncate">{t.title || "Task"}</div>
                      <div className="text-[9px] mt-0.5" style={{ color: c }}>{["PI", "PII", "PIII", "PIV", "Nulla"][t.priority]}</div>
                    </div>
                    {st && <span className="text-[9px] text-[#333] shrink-0">{st.name}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
