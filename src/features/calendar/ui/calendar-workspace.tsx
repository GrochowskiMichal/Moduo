import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from "react";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import type { UseCalendarState } from "../hooks/use-calendar";
import type { CalendarEvent, CalendarEventDraft, CalendarSource } from "../types";

type Props = UseCalendarState;

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 64;
const SNAP_MINUTES = 15;
const MIN_DRAG_PX = 4;
const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_NAMES_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  d.setHours(0, 0, 0, 0);
  return d;
}

function getWeekDays(date: Date): Date[] {
  const start = getWeekStart(date);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    return d;
  });
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function isToday(date: Date): boolean {
  return isSameDay(date, new Date());
}

function formatHour(hour: number): string {
  if (hour === 0) return "12 AM";
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return "12 PM";
  return `${hour - 12} PM`;
}

function formatTime(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return m === 0 ? `${hour} ${ampm}` : `${hour}:${m.toString().padStart(2, "0")} ${ampm}`;
}

function getMonthDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  const startDay = first.getDay();
  const days: Date[] = [];
  for (let i = -startDay; i < 42 - startDay; i++) {
    days.push(new Date(year, month, 1 + i));
  }
  return days;
}

function eventTopAndHeight(event: CalendarEvent, dayStart: Date): { top: number; height: number } {
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const dayStartMs = dayStart.getTime();
  const startMinutes = Math.max(0, (start.getTime() - dayStartMs) / 60000);
  const endMinutes = Math.min(1440, (end.getTime() - dayStartMs) / 60000);
  const top = (startMinutes / 60) * HOUR_HEIGHT;
  const height = Math.max(((endMinutes - startMinutes) / 60) * HOUR_HEIGHT, 20);
  return { top, height };
}

function getEventsForDay(events: CalendarEvent[], day: Date): CalendarEvent[] {
  const dayStart = new Date(day);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(day);
  dayEnd.setHours(23, 59, 59, 999);

  return events.filter((e) => {
    const start = new Date(e.startTime);
    const end = new Date(e.endTime);
    return start <= dayEnd && end >= dayStart;
  });
}

type EventLayout = {
  event: CalendarEvent;
  column: number;
  totalColumns: number;
};

function layoutOverlappingEvents(events: CalendarEvent[], dayStart: Date): EventLayout[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort((a, b) => {
    const aStart = new Date(a.startTime).getTime();
    const bStart = new Date(b.startTime).getTime();
    if (aStart !== bStart) return aStart - bStart;
    return new Date(b.endTime).getTime() - new Date(a.endTime).getTime();
  });

  type Cluster = { events: CalendarEvent[]; end: number };
  const clusters: Cluster[] = [];

  for (const ev of sorted) {
    const evStart = new Date(ev.startTime).getTime();
    const evEnd = new Date(ev.endTime).getTime();
    const last = clusters[clusters.length - 1];
    if (last && evStart < last.end) {
      last.events.push(ev);
      last.end = Math.max(last.end, evEnd);
    } else {
      clusters.push({ events: [ev], end: evEnd });
    }
  }

  const results: EventLayout[] = [];

  for (const cluster of clusters) {
    const columns: CalendarEvent[][] = [];

    for (const ev of cluster.events) {
      const evStart = new Date(ev.startTime).getTime();
      let placed = false;
      for (let c = 0; c < columns.length; c++) {
        const lastInCol = columns[c][columns[c].length - 1];
        if (new Date(lastInCol.endTime).getTime() <= evStart) {
          columns[c].push(ev);
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([ev]);
      }
    }

    const totalColumns = columns.length;
    for (let c = 0; c < columns.length; c++) {
      for (const ev of columns[c]) {
        results.push({ event: ev, column: c, totalColumns });
      }
    }
  }

  return results;
}

function snapMinutes(m: number): number {
  return Math.round(m / SNAP_MINUTES) * SNAP_MINUTES;
}

function clampMinutes(m: number): number {
  return Math.max(0, Math.min(1440, m));
}

function yToMinutes(y: number): number {
  return (y / HOUR_HEIGHT) * 60;
}

function minutesToDate(day: Date, minutes: number): Date {
  const d = new Date(day);
  d.setHours(0, 0, 0, 0);
  d.setMinutes(minutes);
  return d;
}

function dateToLocalInput(d: Date): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

type DragMode = "none" | "create" | "move" | "resize";

type DragState = {
  mode: DragMode;
  pointerId: number;
  startClientY: number;
  startClientX: number;
  committed: boolean;
  anchorMinutes: number;
  currentMinutes: number;
  dayIndex: number;
  currentDayIndex: number;
  eventId: string | null;
  eventOrigStartMin: number;
  eventOrigEndMin: number;
  eventOrigDayIndex: number;
};

function initialDragState(): DragState {
  return {
    mode: "none",
    pointerId: -1,
    startClientY: 0,
    startClientX: 0,
    committed: false,
    anchorMinutes: 0,
    currentMinutes: 0,
    dayIndex: 0,
    currentDayIndex: 0,
    eventId: null,
    eventOrigStartMin: 0,
    eventOrigEndMin: 0,
    eventOrigDayIndex: 0,
  };
}

function MiniCalendar({
  currentDate,
  onSelectDate,
}: {
  currentDate: Date;
  onSelectDate: (date: Date) => void;
}) {
  const [displayMonth, setDisplayMonth] = useState(currentDate.getMonth());
  const [displayYear, setDisplayYear] = useState(currentDate.getFullYear());

  useEffect(() => {
    setDisplayMonth(currentDate.getMonth());
    setDisplayYear(currentDate.getFullYear());
  }, [currentDate]);

  const days = getMonthDays(displayYear, displayMonth);

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3 px-1">
        <span className="text-[12px] font-bold text-[#d0d0d0]">
          {MONTH_NAMES[displayMonth]} {displayYear}
        </span>
        <div className="flex items-center gap-1">
          <button
            className="h-6 w-6 grid place-items-center rounded-md text-[#777] hover:bg-[#1f1f1f] hover:text-white transition-colors"
            onClick={() => {
              if (displayMonth === 0) {
                setDisplayMonth(11);
                setDisplayYear(displayYear - 1);
              } else {
                setDisplayMonth(displayMonth - 1);
              }
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
          </button>
          <button
            className="h-6 w-6 grid place-items-center rounded-md text-[#777] hover:bg-[#1f1f1f] hover:text-white transition-colors"
            onClick={() => {
              if (displayMonth === 11) {
                setDisplayMonth(0);
                setDisplayYear(displayYear + 1);
              } else {
                setDisplayMonth(displayMonth + 1);
              }
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 6 15 12 9 18" /></svg>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-0">
        {DAY_NAMES_SHORT.map((name) => (
          <div key={name} className="h-6 grid place-items-center text-[9px] font-bold uppercase tracking-widest text-[#555]">
            {name.charAt(0)}
          </div>
        ))}
        {days.map((day, i) => {
          const inMonth = day.getMonth() === displayMonth;
          const today = isToday(day);
          const selected = isSameDay(day, currentDate);
          return (
            <button
              key={i}
              className={`h-7 w-7 grid place-items-center rounded-full text-[11px] font-medium transition-all ${
                today && selected
                  ? "bg-[#2f2f2f] text-white font-bold"
                  : today
                    ? "bg-[#2b2b2b] text-[#d0d0d0] font-bold"
                    : selected
                      ? "bg-[#2a2a2a] text-white"
                      : inMonth
                        ? "text-[#aaa] hover:bg-[#1f1f1f]"
                        : "text-[#444] hover:bg-[#1a1a1a]"
              }`}
              onClick={() => onSelectDate(day)}
            >
              {day.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function CurrentTimeLine() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const minutes = now.getHours() * 60 + now.getMinutes();
  const top = (minutes / 60) * HOUR_HEIGHT;

  return (
    <div className="absolute left-0 right-0 z-30 pointer-events-none" style={{ top }}>
      <div className="relative flex items-center">
        <div className="absolute -left-1.5 h-3 w-3 rounded-full bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.6)]" />
        <div className="w-full h-[2px] bg-red-500/70" />
      </div>
    </div>
  );
}

function EventCard({
  event,
  dayStart,
  onClick,
  sources,
  onMoveStart,
  onResizeStart,
  isDragging,
  column,
  totalColumns,
}: {
  event: CalendarEvent;
  dayStart: Date;
  onClick: () => void;
  sources: CalendarSource[];
  onMoveStart: (e: RPointerEvent<HTMLDivElement>) => void;
  onResizeStart: (e: RPointerEvent<HTMLDivElement>) => void;
  isDragging: boolean;
  column: number;
  totalColumns: number;
}) {
  const { top, height } = eventTopAndHeight(event, dayStart);
  const source = sources.find((s) => s.id === event.calendarId);
  const color = event.color || source?.color || "#3a3a3a";
  const start = new Date(event.startTime);
  const end = new Date(event.endTime);
  const compact = height < 40;

  const GAP = 2;
  const widthPct = (1 / totalColumns) * 100;
  const leftPct = column * widthPct;

  return (
    <div
      className={`absolute z-20 rounded-lg border-l-[3px] px-2 py-1 text-left cursor-grab active:cursor-grabbing overflow-hidden group select-none ${isDragging ? "opacity-40" : "hover:brightness-125 hover:shadow-lg"}`}
      style={{
        top,
        height,
        left: `calc(${leftPct}% + ${GAP}px)`,
        width: `calc(${widthPct}% - ${GAP * 2}px)`,
        borderLeftColor: color,
        backgroundColor: `${color}18`,
      }}
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).dataset.resizeHandle) return;
        onMoveStart(e);
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {compact ? (
        <div className="flex items-center gap-1.5 h-full">
          <span className="text-[11px] font-bold text-[#e8e8e8] truncate">{event.title}</span>
        </div>
      ) : (
        <>
          <div className="text-[11px] font-bold text-[#e8e8e8] truncate leading-tight">{event.title}</div>
          <div className="text-[10px] text-[#999] mt-0.5">{formatTime(start)} - {formatTime(end)}</div>
          {event.location && height > 60 && totalColumns <= 2 && (
            <div className="text-[10px] text-[#777] mt-0.5 truncate">{event.location}</div>
          )}
        </>
      )}
      <div
        data-resize-handle="true"
        className="absolute bottom-0 left-0 right-0 h-2 cursor-s-resize hover:bg-white/10 transition-colors"
        onPointerDown={(e) => {
          e.stopPropagation();
          onResizeStart(e);
        }}
      >
        <div className="mx-auto mt-0.5 h-1 w-6 rounded-full bg-white/20 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    </div>
  );
}

function EditEventModal({
  event,
  sources,
  onClose,
  onUpdate,
  onDelete,
}: {
  event: CalendarEvent;
  sources: CalendarSource[];
  onClose: () => void;
  onUpdate: (id: string, patch: Partial<CalendarEvent>) => void;
  onDelete: (id: string) => void;
}) {
  const [title, setTitle] = useState(event.title);
  const [description, setDescription] = useState(event.description);
  const [location, setLocation] = useState(event.location);
  const [startTime, setStartTime] = useState(event.startTime.slice(0, 16));
  const [endTime, setEndTime] = useState(event.endTime.slice(0, 16));
  const [calendarId, setCalendarId] = useState(event.calendarId);
  const source = sources.find((s) => s.id === event.calendarId);
  const color = event.color || source?.color || "#3a3a3a";

  useEffect(() => {
    setTitle(event.title);
    setDescription(event.description);
    setLocation(event.location);
    setStartTime(event.startTime.slice(0, 16));
    setEndTime(event.endTime.slice(0, 16));
    setCalendarId(event.calendarId);
  }, [event]);

  const save = () => {
    const selectedSource = sources.find((s) => s.id === calendarId);
    onUpdate(event.id, {
      title: title.trim() || "Untitled",
      description,
      location,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
      calendarId,
      color: selectedSource?.color || color,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-[#111111] border border-[#222] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1c1c1c]">
          <div className="flex items-center gap-3">
            <div className="w-3.5 h-3.5 rounded-full" style={{ backgroundColor: color }} />
            <h2 className="text-[18px] font-bold text-[#f0f0f0]">Edit Event</h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-[12px] font-bold text-red-400/80 hover:text-red-400 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-400/10"
              onClick={() => {
                if (window.confirm("Delete this event?")) {
                  onDelete(event.id);
                  onClose();
                }
              }}
            >
              Delete
            </button>
            <button className="text-[#888] hover:text-white transition-colors p-1" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            </button>
          </div>
        </div>

        <div className="p-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
            }}
            className="w-full bg-transparent text-[24px] font-bold text-[#f0f0f0] outline-none placeholder:text-[#444]"
            placeholder="Event title"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#555]">Start</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none [color-scheme:dark] focus:border-[#555]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#555]">End</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none [color-scheme:dark] focus:border-[#555]"
              />
            </div>
          </div>

          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none placeholder:text-[#444] focus:border-[#555]"
            placeholder="Add location"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none resize-y placeholder:text-[#444] focus:border-[#555]"
            placeholder="Add description"
          />

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#555]">Calendar</label>
            <select
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none focus:border-[#555]"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#111]">{s.name}</option>
              ))}
            </select>
          </div>

          {event.attendees.length > 0 && (
            <div className="flex flex-col gap-2">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#555]">Attendees</label>
              <div className="flex flex-col gap-1">
                {event.attendees.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-[12px] text-[#aaa]">
                    <div className="w-5 h-5 rounded-full bg-[#2a2a2a] grid place-items-center text-[10px] font-bold text-[#888]">
                      {a.name.charAt(0).toUpperCase()}
                    </div>
                    <span>{a.name || a.email}</span>
                    <span className={`ml-auto text-[10px] font-bold uppercase ${
                      a.status === "accepted" ? "text-[#b0b0b0]" :
                      a.status === "declined" ? "text-red-400/70" :
                      a.status === "tentative" ? "text-yellow-400/70" : "text-[#555]"
                    }`}>{a.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[#1c1c1c]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-bold text-[#888] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="px-6 py-2 rounded-xl bg-[#2f2f2f] hover:bg-[#3a3a3a] text-[13px] font-bold text-white transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateEventModal({
  defaultStart,
  defaultEnd,
  sources,
  onClose,
  onCreate,
}: {
  defaultStart: string;
  defaultEnd: string;
  sources: CalendarSource[];
  onClose: () => void;
  onCreate: (draft: CalendarEventDraft) => void;
}) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(defaultStart);
  const [endTime, setEndTime] = useState(defaultEnd);
  const [location, setLocation] = useState("");
  const [description, setDescription] = useState("");
  const [calendarId, setCalendarId] = useState(sources[0]?.id ?? "");
  const selectedSource = sources.find((s) => s.id === calendarId);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-[#111111] border border-[#222] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1c1c1c]">
          <h2 className="text-[18px] font-bold text-[#f0f0f0]">New Event</h2>
          <button className="text-[#888] hover:text-white transition-colors" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (calendarId) {
                  onCreate({
                    title: title.trim() || "New Event",
                    description,
                    location,
                    startTime: new Date(startTime).toISOString(),
                    endTime: new Date(endTime).toISOString(),
                    allDay: false,
                    calendarId,
                    color: selectedSource?.color || "#3a3a3a",
                    reminders: [10],
                  });
                  onClose();
                }
              }
            }}
            className="w-full bg-transparent text-[24px] font-bold text-[#f0f0f0] outline-none placeholder:text-[#444]"
            placeholder="Event title"
          />

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#555]">Start</label>
              <input
                type="datetime-local"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none [color-scheme:dark] focus:border-[#555]"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase tracking-widest text-[#555]">End</label>
              <input
                type="datetime-local"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none [color-scheme:dark] focus:border-[#555]"
              />
            </div>
          </div>

          <input
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none placeholder:text-[#444] focus:border-[#555]"
            placeholder="Add location"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none resize-y placeholder:text-[#444] focus:border-[#555]"
            placeholder="Add description"
          />

          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-bold uppercase tracking-widest text-[#555]">Calendar</label>
            <select
              value={calendarId}
              onChange={(e) => setCalendarId(e.target.value)}
              className="bg-[#151515] border border-[#2a2a2a] rounded-lg px-3 py-2 text-[13px] text-[#d0d0d0] outline-none focus:border-[#555]"
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id} className="bg-[#111]">{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-[#1c1c1c]">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[13px] font-bold text-[#888] hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (!calendarId) return;
              onCreate({
                title: title.trim() || "New Event",
                description,
                location,
                startTime: new Date(startTime).toISOString(),
                endTime: new Date(endTime).toISOString(),
                allDay: false,
                calendarId,
                color: selectedSource?.color || "#3a3a3a",
                reminders: [10],
              });
              onClose();
            }}
            className="px-6 py-2 rounded-xl bg-[#2f2f2f] hover:bg-[#3a3a3a] text-[13px] font-bold text-white transition-colors"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

function useGridDrag(
  weekDays: Date[],
  events: CalendarEvent[],
  sources: CalendarSource[],
  columnRefsArr: React.RefObject<(HTMLDivElement | null)[]>,
  scrollRef: React.RefObject<HTMLDivElement | null>,
  onCreateDone: (start: string, end: string) => void,
  onMoveEvent: (eventId: string, patch: { startTime: string; endTime: string }) => void,
  onSelectEvent: (id: string) => void,
) {
  const dragRef = useRef<DragState>(initialDragState());
  const [render, setRender] = useState(0);
  const rerender = useCallback(() => setRender((n) => n + 1), []);

  const getRelativeY = useCallback((clientY: number, dayIdx: number): number => {
    const col = columnRefsArr.current?.[dayIdx];
    if (!col) return 0;
    const rect = col.getBoundingClientRect();
    return clientY - rect.top + (scrollRef.current?.scrollTop ?? 0);
  }, [columnRefsArr, scrollRef]);

  const getDayIndexFromX = useCallback((clientX: number): number => {
    const cols = columnRefsArr.current;
    if (!cols) return 0;
    for (let i = 0; i < cols.length; i++) {
      const col = cols[i];
      if (!col) continue;
      const rect = col.getBoundingClientRect();
      if (clientX >= rect.left && clientX <= rect.right) return i;
    }
    return dragRef.current.dayIndex;
  }, [columnRefsArr]);

  const onPointerMoveGlobal = useCallback((e: globalThis.PointerEvent) => {
    const d = dragRef.current;
    if (d.mode === "none") return;

    const dx = e.clientX - d.startClientX;
    const dy = e.clientY - d.startClientY;
    if (!d.committed && Math.abs(dx) + Math.abs(dy) < MIN_DRAG_PX) return;
    d.committed = true;

    const dayIdx = d.mode === "move" ? getDayIndexFromX(e.clientX) : d.dayIndex;
    const y = getRelativeY(e.clientY, dayIdx);
    const rawMin = yToMinutes(y);
    const snapped = clampMinutes(snapMinutes(rawMin));

    d.currentMinutes = snapped;
    d.currentDayIndex = dayIdx;
    rerender();
  }, [getDayIndexFromX, getRelativeY, rerender]);

  const onPointerUpGlobal = useCallback((e: globalThis.PointerEvent) => {
    const d = dragRef.current;
    if (d.mode === "none") return;

    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onPointerMoveGlobal);
    window.removeEventListener("pointerup", onPointerUpGlobal);

    if (!d.committed) {
      dragRef.current = initialDragState();
      rerender();
      return;
    }

    if (d.mode === "create") {
      const minA = Math.min(d.anchorMinutes, d.currentMinutes);
      const minB = Math.max(d.anchorMinutes, d.currentMinutes);
      const endMin = minB === minA ? minA + SNAP_MINUTES : minB;
      const day = weekDays[d.dayIndex];
      const startDate = minutesToDate(day, minA);
      const endDate = minutesToDate(day, endMin);
      onCreateDone(dateToLocalInput(startDate), dateToLocalInput(endDate));
    }

    if (d.mode === "move" && d.eventId) {
      const deltaMin = d.currentMinutes - d.anchorMinutes;
      const newStartMin = clampMinutes(d.eventOrigStartMin + deltaMin);
      const duration = d.eventOrigEndMin - d.eventOrigStartMin;
      const newEndMin = clampMinutes(newStartMin + duration);
      const newDay = weekDays[d.currentDayIndex];
      onMoveEvent(d.eventId, {
        startTime: minutesToDate(newDay, newStartMin).toISOString(),
        endTime: minutesToDate(newDay, newEndMin).toISOString(),
      });
    }

    if (d.mode === "resize" && d.eventId) {
      const newEndMin = clampMinutes(Math.max(d.eventOrigStartMin + SNAP_MINUTES, d.currentMinutes));
      const day = weekDays[d.dayIndex];
      onMoveEvent(d.eventId, {
        startTime: minutesToDate(day, d.eventOrigStartMin).toISOString(),
        endTime: minutesToDate(day, newEndMin).toISOString(),
      });
    }

    dragRef.current = initialDragState();
    rerender();
  }, [getDayIndexFromX, getRelativeY, onCreateDone, onMoveEvent, onPointerMoveGlobal, rerender, weekDays]);

  const startCreate = useCallback((e: RPointerEvent<HTMLDivElement>, dayIndex: number) => {
    if (e.button !== 0) return;
    const y = getRelativeY(e.clientY, dayIndex);
    const snapped = clampMinutes(snapMinutes(yToMinutes(y)));
    dragRef.current = {
      ...initialDragState(),
      mode: "create",
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startClientX: e.clientX,
      anchorMinutes: snapped,
      currentMinutes: snapped,
      dayIndex,
      currentDayIndex: dayIndex,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMoveGlobal);
    window.addEventListener("pointerup", onPointerUpGlobal);
    rerender();
  }, [getRelativeY, onPointerMoveGlobal, onPointerUpGlobal, rerender]);

  const startMove = useCallback((e: RPointerEvent<HTMLDivElement>, eventId: string, dayIndex: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ev = events.find((x) => x.id === eventId);
    if (!ev) return;
    const dayStart = new Date(weekDays[dayIndex]);
    dayStart.setHours(0, 0, 0, 0);
    const evStart = new Date(ev.startTime);
    const evEnd = new Date(ev.endTime);
    const startMin = snapMinutes((evStart.getTime() - dayStart.getTime()) / 60000);
    const endMin = snapMinutes((evEnd.getTime() - dayStart.getTime()) / 60000);
    const y = getRelativeY(e.clientY, dayIndex);
    const clickMin = clampMinutes(snapMinutes(yToMinutes(y)));

    dragRef.current = {
      ...initialDragState(),
      mode: "move",
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startClientX: e.clientX,
      anchorMinutes: clickMin,
      currentMinutes: clickMin,
      dayIndex,
      currentDayIndex: dayIndex,
      eventId,
      eventOrigStartMin: startMin,
      eventOrigEndMin: endMin,
      eventOrigDayIndex: dayIndex,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMoveGlobal);
    window.addEventListener("pointerup", onPointerUpGlobal);
    rerender();
  }, [events, getRelativeY, onPointerMoveGlobal, onPointerUpGlobal, rerender, weekDays]);

  const startResize = useCallback((e: RPointerEvent<HTMLDivElement>, eventId: string, dayIndex: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ev = events.find((x) => x.id === eventId);
    if (!ev) return;
    const dayStart = new Date(weekDays[dayIndex]);
    dayStart.setHours(0, 0, 0, 0);
    const evStart = new Date(ev.startTime);
    const evEnd = new Date(ev.endTime);
    const startMin = snapMinutes((evStart.getTime() - dayStart.getTime()) / 60000);
    const endMin = snapMinutes((evEnd.getTime() - dayStart.getTime()) / 60000);
    const y = getRelativeY(e.clientY, dayIndex);
    const clickMin = clampMinutes(snapMinutes(yToMinutes(y)));

    dragRef.current = {
      ...initialDragState(),
      mode: "resize",
      pointerId: e.pointerId,
      startClientY: e.clientY,
      startClientX: e.clientX,
      anchorMinutes: clickMin,
      currentMinutes: endMin,
      dayIndex,
      currentDayIndex: dayIndex,
      eventId,
      eventOrigStartMin: startMin,
      eventOrigEndMin: endMin,
      eventOrigDayIndex: dayIndex,
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onPointerMoveGlobal);
    window.addEventListener("pointerup", onPointerUpGlobal);
    rerender();
  }, [events, getRelativeY, onPointerMoveGlobal, onPointerUpGlobal, rerender, weekDays]);

  return { dragState: dragRef.current, startCreate, startMove, startResize };
}

function DragPreview({
  dragState,
  sources,
  events,
}: {
  dragState: DragState;
  sources: CalendarSource[];
  events: CalendarEvent[];
}) {
  if (!dragState.committed || dragState.mode === "none") return null;

  if (dragState.mode === "create") {
    const minA = Math.min(dragState.anchorMinutes, dragState.currentMinutes);
    const minB = Math.max(dragState.anchorMinutes, dragState.currentMinutes);
    const endMin = minB === minA ? minA + SNAP_MINUTES : minB;
    const top = (minA / 60) * HOUR_HEIGHT;
    const height = Math.max(((endMin - minA) / 60) * HOUR_HEIGHT, (SNAP_MINUTES / 60) * HOUR_HEIGHT);
    const startDate = minutesToDate(new Date(), minA);
    const endDate = minutesToDate(new Date(), endMin);

    return (
      <div
        className="absolute left-1 right-1 z-40 rounded-lg border-l-[3px] border-l-[#6a6a6a] bg-[#2a2a2a] px-2 py-1 pointer-events-none select-none"
        style={{ top, height }}
      >
        <div className="text-[11px] font-bold text-[#d8d8d8]">New Event</div>
        <div className="text-[10px] text-[#a5a5a5]">{formatTime(startDate)} - {formatTime(endDate)}</div>
      </div>
    );
  }

  if (dragState.mode === "move" && dragState.eventId) {
    const ev = events.find((x) => x.id === dragState.eventId);
    if (!ev) return null;
    const deltaMin = dragState.currentMinutes - dragState.anchorMinutes;
    const newStartMin = clampMinutes(dragState.eventOrigStartMin + deltaMin);
    const duration = dragState.eventOrigEndMin - dragState.eventOrigStartMin;
    const newEndMin = clampMinutes(newStartMin + duration);
    const top = (newStartMin / 60) * HOUR_HEIGHT;
    const height = Math.max(((newEndMin - newStartMin) / 60) * HOUR_HEIGHT, (SNAP_MINUTES / 60) * HOUR_HEIGHT);
    const source = sources.find((s) => s.id === ev.calendarId);
    const color = ev.color || source?.color || "#3a3a3a";

    return (
      <div
        className="absolute left-1 right-1 z-40 rounded-lg border-l-[3px] px-2 py-1 pointer-events-none select-none opacity-80 shadow-lg"
        style={{ top, height, borderLeftColor: color, backgroundColor: `${color}30` }}
      >
        <div className="text-[11px] font-bold text-[#e8e8e8] truncate">{ev.title}</div>
        <div className="text-[10px] text-[#bbb]">{formatTime(minutesToDate(new Date(), newStartMin))} - {formatTime(minutesToDate(new Date(), newEndMin))}</div>
      </div>
    );
  }

  if (dragState.mode === "resize" && dragState.eventId) {
    const ev = events.find((x) => x.id === dragState.eventId);
    if (!ev) return null;
    const newEndMin = clampMinutes(Math.max(dragState.eventOrigStartMin + SNAP_MINUTES, dragState.currentMinutes));
    const top = (dragState.eventOrigStartMin / 60) * HOUR_HEIGHT;
    const height = Math.max(((newEndMin - dragState.eventOrigStartMin) / 60) * HOUR_HEIGHT, (SNAP_MINUTES / 60) * HOUR_HEIGHT);
    const source = sources.find((s) => s.id === ev.calendarId);
    const color = ev.color || source?.color || "#3a3a3a";

    return (
      <div
        className="absolute left-1 right-1 z-40 rounded-lg border-l-[3px] px-2 py-1 pointer-events-none select-none opacity-80"
        style={{ top, height, borderLeftColor: color, backgroundColor: `${color}30` }}
      >
        <div className="text-[11px] font-bold text-[#e8e8e8] truncate">{ev.title}</div>
        <div className="text-[10px] text-[#bbb]">{formatTime(minutesToDate(new Date(), dragState.eventOrigStartMin))} - {formatTime(minutesToDate(new Date(), newEndMin))}</div>
      </div>
    );
  }

  return null;
}

function WeekView({
  currentDate,
  events,
  sources,
  onSelectEvent,
  onCreateAtSlot,
  onUpdateEvent,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  sources: CalendarSource[];
  onSelectEvent: (id: string) => void;
  onCreateAtSlot: (start: string, end: string) => void;
  onUpdateEvent: (eventId: string, patch: Partial<CalendarEvent>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const weekDays = getWeekDays(currentDate);

  const handleMoveEvent = useCallback((eventId: string, patch: { startTime: string; endTime: string }) => {
    onUpdateEvent(eventId, patch);
  }, [onUpdateEvent]);

  const { dragState, startCreate, startMove, startResize } = useGridDrag(
    weekDays,
    events,
    sources,
    columnRefs,
    scrollRef,
    onCreateAtSlot,
    handleMoveEvent,
    onSelectEvent,
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
    }
  }, [currentDate]);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex border-b border-[#1c1c1c] bg-[#111111]/80 sticky top-0 z-10">
        <div className="w-16 shrink-0" />
        {weekDays.map((day, i) => {
          const td = isToday(day);
          return (
            <div key={i} className="flex-1 text-center py-2 border-l border-[#1a1a1a]">
              <div className={`text-[10px] font-bold uppercase tracking-widest ${td ? "text-[#d0d0d0]" : "text-[#666]"}`}>
                {DAY_NAMES_SHORT[day.getDay()]}
              </div>
              <div className={`text-[20px] font-bold mt-0.5 ${
                td ? "bg-[#2f2f2f] text-white w-9 h-9 rounded-full grid place-items-center mx-auto" : "text-[#d0d0d0]"
              }`}>
                {day.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto overflow-x-hidden custom-scrollbar">
        <div className="flex relative" style={{ height: HOURS.length * HOUR_HEIGHT }}>
          <div className="w-16 shrink-0 relative">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 pr-2 text-right"
                style={{ top: hour * HOUR_HEIGHT - 6 }}
              >
                <span className="text-[10px] font-bold text-[#555]">{formatHour(hour)}</span>
              </div>
            ))}
          </div>

          {weekDays.map((day, dayIndex) => {
            const dayStart = new Date(day);
            dayStart.setHours(0, 0, 0, 0);
            const dayEvents = getEventsForDay(events, day);
            const layoutItems = layoutOverlappingEvents(dayEvents, dayStart);
            const showTimeLine = isToday(day);
            const showCreatePreview = dragState.committed && dragState.mode === "create" && dragState.dayIndex === dayIndex;
            const showMovePreview = dragState.committed && dragState.mode === "move" && dragState.currentDayIndex === dayIndex;
            const showResizePreview = dragState.committed && dragState.mode === "resize" && dragState.dayIndex === dayIndex;

            return (
              <div
                key={dayIndex}
                ref={(el) => { columnRefs.current[dayIndex] = el; }}
                className="flex-1 relative border-l border-[#1a1a1a]"
                onPointerDown={(e) => {
                  if ((e.target as HTMLElement).closest("[data-event-card]")) return;
                  startCreate(e, dayIndex);
                }}
              >
                {HOURS.map((hour) => (
                  <div
                    key={hour}
                    className="absolute left-0 right-0 border-t border-[#1a1a1a]"
                    style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                  >
                    <div
                      className="absolute left-0 right-0 border-t border-[#141414]"
                      style={{ top: HOUR_HEIGHT / 2 }}
                    />
                  </div>
                ))}

                {layoutItems.map(({ event, column, totalColumns }) => (
                  <div key={event.id} data-event-card>
                    <EventCard
                      event={event}
                      dayStart={dayStart}
                      sources={sources}
                      isDragging={dragState.committed && dragState.eventId === event.id}
                      column={column}
                      totalColumns={totalColumns}
                      onClick={() => {
                        if (!dragState.committed) onSelectEvent(event.id);
                      }}
                      onMoveStart={(e) => startMove(e, event.id, dayIndex)}
                      onResizeStart={(e) => startResize(e, event.id, dayIndex)}
                    />
                  </div>
                ))}

                {showCreatePreview && <DragPreview dragState={dragState} sources={sources} events={events} />}
                {showMovePreview && <DragPreview dragState={dragState} sources={sources} events={events} />}
                {showResizePreview && <DragPreview dragState={dragState} sources={sources} events={events} />}

                {showTimeLine && <CurrentTimeLine />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function DayView({
  currentDate,
  events,
  sources,
  onSelectEvent,
  onCreateAtSlot,
  onUpdateEvent,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  sources: CalendarSource[];
  onSelectEvent: (id: string) => void;
  onCreateAtSlot: (start: string, end: string) => void;
  onUpdateEvent: (eventId: string, patch: Partial<CalendarEvent>) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const columnRefs = useRef<(HTMLDivElement | null)[]>([]);
  const singleDay = useMemo(() => [currentDate], [currentDate]);

  const dayStart = new Date(currentDate);
  dayStart.setHours(0, 0, 0, 0);
  const dayEvents = getEventsForDay(events, currentDate);
  const layoutItems = useMemo(() => layoutOverlappingEvents(dayEvents, dayStart), [dayEvents, dayStart]);

  const handleMoveEvent = useCallback((eventId: string, patch: { startTime: string; endTime: string }) => {
    onUpdateEvent(eventId, patch);
  }, [onUpdateEvent]);

  const { dragState, startCreate, startMove, startResize } = useGridDrag(
    singleDay,
    events,
    sources,
    columnRefs,
    scrollRef,
    onCreateAtSlot,
    handleMoveEvent,
    onSelectEvent,
  );

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 7 * HOUR_HEIGHT;
    }
  }, [currentDate]);

  const showCreatePreview = dragState.committed && dragState.mode === "create" && dragState.dayIndex === 0;
  const showMovePreview = dragState.committed && dragState.mode === "move" && dragState.currentDayIndex === 0;
  const showResizePreview = dragState.committed && dragState.mode === "resize" && dragState.dayIndex === 0;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="border-b border-[#1c1c1c] bg-[#111111]/80 py-3 px-4 sticky top-0 z-10">
        <div className={`text-[10px] font-bold uppercase tracking-widest ${isToday(currentDate) ? "text-[#d0d0d0]" : "text-[#666]"}`}>
          {DAY_NAMES_FULL[currentDate.getDay()]}
        </div>
        <div className="text-[24px] font-bold text-[#d0d0d0] mt-0.5">
          {currentDate.getDate()} {MONTH_NAMES[currentDate.getMonth()]}
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="flex relative" style={{ height: HOURS.length * HOUR_HEIGHT }}>
          <div className="w-16 shrink-0 relative">
            {HOURS.map((hour) => (
              <div key={hour} className="absolute left-0 right-0 pr-2 text-right" style={{ top: hour * HOUR_HEIGHT - 6 }}>
                <span className="text-[10px] font-bold text-[#555]">{formatHour(hour)}</span>
              </div>
            ))}
          </div>

          <div
            ref={(el) => { columnRefs.current[0] = el; }}
            className="flex-1 relative border-l border-[#1a1a1a]"
            onPointerDown={(e) => {
              if ((e.target as HTMLElement).closest("[data-event-card]")) return;
              startCreate(e, 0);
            }}
          >
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute left-0 right-0 border-t border-[#1a1a1a]"
                style={{ top: hour * HOUR_HEIGHT, height: HOUR_HEIGHT }}
              >
                <div className="absolute left-0 right-0 border-t border-[#141414]" style={{ top: HOUR_HEIGHT / 2 }} />
              </div>
            ))}

            {layoutItems.map(({ event, column, totalColumns }) => (
              <div key={event.id} data-event-card>
                <EventCard
                  event={event}
                  dayStart={dayStart}
                  sources={sources}
                  isDragging={dragState.committed && dragState.eventId === event.id}
                  column={column}
                  totalColumns={totalColumns}
                  onClick={() => {
                    if (!dragState.committed) onSelectEvent(event.id);
                  }}
                  onMoveStart={(e) => startMove(e, event.id, 0)}
                  onResizeStart={(e) => startResize(e, event.id, 0)}
                />
              </div>
            ))}

            {showCreatePreview && <DragPreview dragState={dragState} sources={sources} events={events} />}
            {showMovePreview && <DragPreview dragState={dragState} sources={sources} events={events} />}
            {showResizePreview && <DragPreview dragState={dragState} sources={sources} events={events} />}

            {isToday(currentDate) && <CurrentTimeLine />}
          </div>
        </div>
      </div>
    </div>
  );
}

function MonthView({
  currentDate,
  events,
  sources,
  onSelectDate,
  onSelectEvent,
}: {
  currentDate: Date;
  events: CalendarEvent[];
  sources: CalendarSource[];
  onSelectDate: (date: Date) => void;
  onSelectEvent: (id: string) => void;
}) {
  const days = getMonthDays(currentDate.getFullYear(), currentDate.getMonth());
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="grid grid-cols-7 border-b border-[#1c1c1c]">
        {DAY_NAMES_SHORT.map((name) => (
          <div key={name} className="py-2 text-center text-[11px] font-bold uppercase tracking-widest text-[#555]">
            {name}
          </div>
        ))}
      </div>

      <div className="flex-1 grid grid-rows-6 min-h-0">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 border-b border-[#1a1a1a] min-h-0">
            {week.map((day, di) => {
              const inMonth = day.getMonth() === currentDate.getMonth();
              const td = isToday(day);
              const dayEvents = getEventsForDay(events, day);

              return (
                <div
                  key={di}
                  className={`border-l border-[#1a1a1a] p-1 overflow-hidden cursor-pointer hover:bg-[#151515]/60 transition-colors ${!inMonth ? "opacity-40" : ""}`}
                  onClick={() => onSelectDate(day)}
                >
                  <div className={`text-[12px] font-bold mb-1 w-7 h-7 grid place-items-center rounded-full ${
                    td ? "bg-[#2f2f2f] text-white" : "text-[#aaa]"
                  }`}>
                    {day.getDate()}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, 3).map((event) => {
                      const source = sources.find((s) => s.id === event.calendarId);
                      const color = event.color || source?.color || "#3a3a3a";
                      return (
                        <button
                          key={event.id}
                          className="w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-bold text-[#e0e0e0] hover:brightness-125 transition-colors"
                          style={{ backgroundColor: `${color}25`, borderLeft: `2px solid ${color}` }}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectEvent(event.id);
                          }}
                        >
                          {event.title}
                        </button>
                      );
                    })}
                    {dayEvents.length > 3 && (
                      <div className="text-[9px] font-bold text-[#666] pl-1">+{dayEvents.length - 3} more</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarWorkspace(props: Props) {
  const {
    viewMode,
    currentDate,
    sources,
    accounts,
    selectedEventId,
    loading,
    setViewMode,
    setCurrentDate,
    navigateToday,
    navigatePrev,
    navigateNext,
    createEvent,
    updateEvent,
    deleteEvent,
    selectEvent,
    toggleSourceVisibility,
    addGoogleAccount,
    removeAccount,
    getVisibleEvents,
  } = props;

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createDefaultStart, setCreateDefaultStart] = useState("");
  const [createDefaultEnd, setCreateDefaultEnd] = useState("");
  const [editModalEventId, setEditModalEventId] = useState<string | null>(null);

  const visibleEvents = useMemo(() => getVisibleEvents(), [getVisibleEvents]);
  const editModalEvent = useMemo(
    () => (editModalEventId ? visibleEvents.find((e) => e.id === editModalEventId) ?? null : null),
    [editModalEventId, visibleEvents]
  );

  const openEditModal = useCallback((eventId: string) => {
    setEditModalEventId(eventId);
  }, []);

  const openCreateModal = useCallback(
    (start?: string, end?: string) => {
      const now = new Date();
      const pad = (n: number) => n.toString().padStart(2, "0");
      const toLocal = (d: Date) =>
        `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
      if (!start) {
        const roundedHour = new Date(now);
        roundedHour.setMinutes(0, 0, 0);
        roundedHour.setHours(roundedHour.getHours() + 1);
        start = toLocal(roundedHour);
        const endDate = new Date(roundedHour);
        endDate.setHours(endDate.getHours() + 1);
        end = toLocal(endDate);
      }
      setCreateDefaultStart(start!);
      setCreateDefaultEnd(end ?? start!);
      setCreateModalOpen(true);
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "t" || e.key === "T") { e.preventDefault(); navigateToday(); }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); setViewMode("day"); }
      if (e.key === "w" || e.key === "W") { e.preventDefault(); setViewMode("week"); }
      if (e.key === "m" || e.key === "M") { e.preventDefault(); setViewMode("month"); }
      if (e.key === "c" || e.key === "C") { e.preventDefault(); openCreateModal(); }
      if (e.key === "ArrowLeft") { e.preventDefault(); navigatePrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); navigateNext(); }
      if (e.key === "Escape") {
        if (editModalEventId) setEditModalEventId(null);
        else if (createModalOpen) setCreateModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [createModalOpen, editModalEventId, navigateNext, navigatePrev, navigateToday, openCreateModal, setViewMode]);

  const headerLabel = useMemo(() => {
    if (viewMode === "day") {
      return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getDate()}, ${currentDate.getFullYear()}`;
    }
    if (viewMode === "week") {
      const weekDays = getWeekDays(currentDate);
      const first = weekDays[0];
      const last = weekDays[6];
      if (first.getMonth() === last.getMonth()) {
        return `${MONTH_NAMES[first.getMonth()]} ${first.getDate()} - ${last.getDate()}, ${first.getFullYear()}`;
      }
      return `${MONTH_NAMES[first.getMonth()].slice(0, 3)} ${first.getDate()} - ${MONTH_NAMES[last.getMonth()].slice(0, 3)} ${last.getDate()}, ${last.getFullYear()}`;
    }
    return `${MONTH_NAMES[currentDate.getMonth()]} ${currentDate.getFullYear()}`;
  }, [currentDate, viewMode]);

  if (loading) {
    return <div className="grid h-full place-content-center text-[#8f8f8f] bg-[#0C0C0C]">Loading calendar...</div>;
  }

  return (
    <>
      <FeaturePanelsShell
        feature="calendar"
        left={
          <div className="flex h-full min-h-0 flex-col gap-5">
            <button
              onClick={() => openCreateModal()}
              className="flex items-center justify-center gap-2 rounded-xl bg-[#2f2f2f] py-2.5 text-[13px] font-bold text-white shadow transition-colors hover:bg-[#3a3a3a]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              New Event
            </button>

            <MiniCalendar
              currentDate={currentDate}
              onSelectDate={(d) => {
                setCurrentDate(d);
                if (viewMode === "month") setViewMode("day");
              }}
            />

            <div className="h-px bg-[#222]" />

            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="mb-3 flex items-center justify-between px-1">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#555]">My Calendars</h3>
              </div>
              <div className="flex flex-col gap-1">
                {sources.map((source) => {
                  const account = accounts.find((a) => a.id === source.accountId);
                  return (
                    <div key={source.id} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[#1a1a1a] transition-colors group">
                      <button
                        className="shrink-0 w-4 h-4 rounded border-2 grid place-items-center transition-colors"
                        style={{
                          borderColor: source.color,
                          backgroundColor: source.visible ? source.color : "transparent",
                        }}
                        onClick={() => toggleSourceVisibility(source.id)}
                      >
                        {source.visible && (
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>
                        )}
                      </button>
                      <span className="text-[12px] font-medium text-[#bbb] truncate flex-1">{source.name}</span>
                      {account && account.provider !== "local" && (
                        <span className="text-[9px] font-bold uppercase text-[#555] opacity-0 group-hover:opacity-100 transition-opacity">
                          {account.provider}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="h-px bg-[#222]" />

            <div>
              <div className="mb-2 px-1">
                <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#555]">Accounts</h3>
              </div>
              <div className="flex flex-col gap-1">
                {accounts.map((account) => (
                  <div key={account.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-[#1a1a1a] transition-colors group">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full ${account.connected ? "bg-[#8f8f8f]" : "bg-[#555]"}`} />
                      <span className="text-[12px] font-medium text-[#bbb] truncate">
                        {account.provider === "local" ? "Local" : account.email || account.displayName}
                      </span>
                    </div>
                    {account.provider !== "local" && (
                      <button
                        onClick={() => removeAccount(account.id)}
                        className="text-[10px] text-[#666] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                onClick={() => void addGoogleAccount()}
                className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-dashed border-[#333] bg-transparent hover:bg-[#161616] hover:border-[#444] px-3 py-2 text-[11px] font-bold text-[#777] hover:text-[#aaa] transition-all"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#b0b0b0" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.13v2.84C3.99 20.53 7.7 23 12 23z" fill="#9a9a9a" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.13C1.43 8.55 1 10.22 1 12s.43 3.45 1.13 4.93l3.71-2.84z" fill="#8f8f8f" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.13 7.07l3.71 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#6f6f6f" />
                </svg>
                Connect Google Calendar
              </button>
            </div>
          </div>
        }
        center={
          <div className="flex flex-col h-full min-h-0">
            <div className="flex items-center justify-between px-2 py-2 border-b border-[#1c1c1c] shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={navigateToday}
                  className="rounded-lg border border-[#2a2a2a] bg-[#151515] px-3 py-1.5 text-[12px] font-bold text-[#d0d0d0] hover:bg-[#1f1f1f] hover:text-white transition-colors"
                >
                  Today
                </button>
                <div className="flex items-center gap-1">
                  <button onClick={navigatePrev} className="h-7 w-7 grid place-items-center rounded-md text-[#777] hover:bg-[#1f1f1f] hover:text-white transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
                  </button>
                  <button onClick={navigateNext} className="h-7 w-7 grid place-items-center rounded-md text-[#777] hover:bg-[#1f1f1f] hover:text-white transition-colors">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 6 15 12 9 18" /></svg>
                  </button>
                </div>
                <h2 className="text-[15px] font-bold text-[#e8e8e8]">{headerLabel}</h2>
              </div>

              <div className="flex items-center gap-1 bg-[#151515] p-1 rounded-xl border border-[#222]">
                {(["day", "week", "month"] as const).map((mode) => (
                  <button
                    key={mode}
                    className={`rounded-lg px-3 py-1.5 text-[12px] font-medium transition-all capitalize ${
                      viewMode === mode
                        ? "bg-[#252525] text-white shadow-sm shadow-black/40"
                        : "text-[#777] hover:text-[#bbb] hover:bg-[#1d1d1d]"
                    }`}
                    onClick={() => setViewMode(mode)}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 min-h-0">
              {viewMode === "week" && (
                <WeekView
                  currentDate={currentDate}
                  events={visibleEvents}
                  sources={sources}
                  onSelectEvent={openEditModal}
                  onCreateAtSlot={(s, e) => openCreateModal(s, e)}
                  onUpdateEvent={updateEvent}
                />
              )}
              {viewMode === "day" && (
                <DayView
                  currentDate={currentDate}
                  events={visibleEvents}
                  sources={sources}
                  onSelectEvent={openEditModal}
                  onCreateAtSlot={(s, e) => openCreateModal(s, e)}
                  onUpdateEvent={updateEvent}
                />
              )}
              {viewMode === "month" && (
                <MonthView
                  currentDate={currentDate}
                  events={visibleEvents}
                  sources={sources}
                  onSelectDate={(d) => {
                    setCurrentDate(d);
                    setViewMode("day");
                  }}
                  onSelectEvent={openEditModal}
                />
              )}
            </div>
          </div>
        }
        right={
          <div className="h-full flex flex-col items-center justify-center px-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#2d2d2d] to-[#1f1f1f] border border-[#4a4a4a] flex items-center justify-center mb-4">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-[#d0d0d0]">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </div>
            <h3 className="text-[#eeeeee] font-medium text-[15px] mb-2 text-center">Calendar</h3>
            <p className="text-[#777777] text-[12px] text-center max-w-[200px] leading-relaxed">
              Click an event to edit, or drag on the grid to create. Drag events to move or resize them.
            </p>
            <div className="mt-6 text-[10px] text-[#555] space-y-1 text-center">
              <p><span className="text-[#888] font-bold">C</span> Create event</p>
              <p><span className="text-[#888] font-bold">T</span> Go to today</p>
              <p><span className="text-[#888] font-bold">D/W/M</span> Switch view</p>
              <p><span className="text-[#888] font-bold">Arrow keys</span> Navigate</p>
            </div>
          </div>
        }
      />

      {createModalOpen && (
        <CreateEventModal
          defaultStart={createDefaultStart}
          defaultEnd={createDefaultEnd}
          sources={sources}
          onClose={() => setCreateModalOpen(false)}
          onCreate={(draft) => {
            createEvent(draft);
            setCreateModalOpen(false);
          }}
        />
      )}

      {editModalEvent && (
        <EditEventModal
          event={editModalEvent}
          sources={sources}
          onClose={() => setEditModalEventId(null)}
          onUpdate={(id, patch) => {
            updateEvent(id, patch);
            setEditModalEventId(null);
          }}
          onDelete={(id) => {
            deleteEvent(id);
            setEditModalEventId(null);
          }}
        />
      )}
    </>
  );
}
