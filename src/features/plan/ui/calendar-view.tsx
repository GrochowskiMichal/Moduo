import { useEffect, useMemo, useRef, useState } from "react";
import type { CalendarEvent, CalendarSource } from "../../calendar/types";
import type { Task, TaskWorkflowState } from "../../tasks/types";
import type { CalDensity } from "./plan-nav";

const HOUR_H = 56;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const DAY_ABR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function pad(n: number) { return String(n).padStart(2, "0"); }
function sod(d: Date) { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; }
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function isSameDay(a: Date, b: Date) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function isToday(d: Date) { return isSameDay(d, new Date()); }
function weekOf(d: Date) { const s = sod(d); s.setDate(s.getDate() - s.getDay()); return Array.from({ length: 7 }, (_, i) => addDays(s, i)); }
function monthDays(d: Date) {
  const first = new Date(d.getFullYear(), d.getMonth(), 1);
  return Array.from({ length: 42 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), 1 + i - first.getDay()));
}
function fmtHour(h: number) { if (h === 0) return "12 AM"; if (h < 12) return `${h} AM`; if (h === 12) return "12 PM"; return `${h - 12} PM`; }
function fmtTime(d: Date) { const h = d.getHours(), m = d.getMinutes(), ap = h >= 12 ? "PM" : "AM", hr = h % 12 || 12; return m === 0 ? `${hr} ${ap}` : `${hr}:${pad(m)} ${ap}`; }
function eventsForDay(evts: CalendarEvent[], day: Date) {
  const s = sod(day), e = new Date(s); e.setHours(23, 59, 59, 999);
  return evts.filter(ev => { const es = new Date(ev.startTime), ee = new Date(ev.endTime); return !ev.deletedAt && es <= e && ee >= s; });
}
function tasksForDay(tasks: Task[], states: TaskWorkflowState[], day: Date) {
  const ds = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
  const doneIds = new Set(states.filter(s => s.kind === "done" || s.kind === "canceled").map(s => s.id));
  return tasks.filter(t => !t.deletedAt && t.dueDate === ds && !doneIds.has(t.stateId));
}
function layoutOverlap(evts: CalendarEvent[]) {
  const sorted = [...evts].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  const result: Array<{ ev: CalendarEvent; col: number; cols: number }> = [];
  const clusters: Array<{ evts: CalendarEvent[]; end: number }> = [];
  for (const ev of sorted) {
    const es = new Date(ev.startTime).getTime(), ee = new Date(ev.endTime).getTime();
    const last = clusters[clusters.length - 1];
    if (last && es < last.end) { last.evts.push(ev); last.end = Math.max(last.end, ee); }
    else clusters.push({ evts: [ev], end: ee });
  }
  for (const c of clusters) {
    const cols: CalendarEvent[][] = [];
    for (const ev of c.evts) {
      const es = new Date(ev.startTime).getTime();
      let placed = false;
      for (let ci = 0; ci < cols.length; ci++) {
        if (new Date(cols[ci][cols[ci].length - 1]!.endTime).getTime() <= es) { cols[ci].push(ev); placed = true; break; }
      }
      if (!placed) cols.push([ev]);
    }
    const n = cols.length;
    for (let ci = 0; ci < n; ci++) for (const ev of cols[ci]) result.push({ ev, col: ci, cols: n });
  }
  return result;
}

function NowLine() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const top = ((now.getHours() * 60 + now.getMinutes()) / 60) * HOUR_H;
  return (
    <div className="absolute inset-x-0 z-30 pointer-events-none" style={{ top }}>
      <div className="flex items-center"><div className="w-1.5 h-1.5 rounded-full bg-[#aaa] shrink-0" /><div className="flex-1 h-px bg-[#333]" /></div>
    </div>
  );
}

function EvBlock({ ev, dayStart, sources, col, cols, onClick }: { ev: CalendarEvent; dayStart: Date; sources: CalendarSource[]; col: number; cols: number; onClick: () => void }) {
  const s = new Date(ev.startTime), e = new Date(ev.endTime);
  const dsMs = sod(dayStart).getTime();
  const sMin = Math.max(0, (s.getTime() - dsMs) / 60000);
  const eMin = Math.min(1440, (e.getTime() - dsMs) / 60000);
  const top = (sMin / 60) * HOUR_H, height = Math.max(18, ((eMin - sMin) / 60) * HOUR_H);
  const src = sources.find(sr => sr.id === ev.calendarId);
  const color = ev.color || src?.color || "#5865f2";
  const compact = height < 32;
  const w = 100 / cols, l = col * w;
  return (
    <div onClick={e => { e.stopPropagation(); onClick(); }}
      className="absolute z-20 rounded-lg overflow-hidden cursor-pointer hover:brightness-110 transition-all select-none"
      style={{ top, height, left: `calc(${l}%+2px)`, width: `calc(${w}%-4px)`, background: `${color}1a`, borderLeft: `2px solid ${color}` }}>
      {compact
        ? <div className="px-1.5 h-full flex items-center gap-1"><div className="w-1 h-1 rounded-full shrink-0" style={{ background: color }} /><span className="text-[9px] font-semibold truncate" style={{ color }}>{ev.title}</span></div>
        : <div className="px-1.5 pt-1"><div className="text-[10px] font-semibold truncate" style={{ color }}>{ev.title}</div><div className="text-[9px] text-[#555] mt-0.5">{fmtTime(s)}</div></div>}
    </div>
  );
}

function TimeGrid({ days, events, tasks, taskStates, sources, showTasks, onClickEvent, onSelectTask }: {
  days: Date[]; events: CalendarEvent[]; tasks: Task[]; taskStates: TaskWorkflowState[];
  sources: CalendarSource[]; showTasks: boolean;
  onClickEvent: (id: string) => void; onSelectTask: (id: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = 7 * HOUR_H; }, []);
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 grid border-b border-[#111]" style={{ gridTemplateColumns: `48px repeat(${days.length},minmax(0,1fr))` }}>
        <div />
        {days.map((d, i) => {
          const tod = isToday(d);
          const evC = eventsForDay(events, d).length;
          const tkC = showTasks ? tasksForDay(tasks, taskStates, d).length : 0;
          return (
            <div key={i} className="flex flex-col items-center gap-0.5 py-2 border-l border-[#111]">
              <span className={`text-[8px] font-bold uppercase tracking-widest ${tod ? "text-[#d4d4d4]" : "text-[#2a2a2a]"}`}>{DAY_ABR[d.getDay()]}</span>
              <div className={`h-6 w-6 grid place-items-center rounded-full text-[12px] font-bold ${tod ? "bg-[#2a2a2a] text-[#f1f1f1] shadow-[0_0_12px_#2a2a2a40]" : "text-[#555]"}`}>{d.getDate()}</div>
              {(evC + tkC) > 0 && <div className="flex gap-0.5">{evC > 0 && <div className="w-1 h-1 rounded-full bg-[#7b7b7b]/60" />}{tkC > 0 && <div className="w-1 h-1 rounded-full bg-[#ffaa44]/50" />}</div>}
            </div>
          );
        })}
      </div>
      <div ref={scrollRef} className="flex flex-1 min-h-0 overflow-y-auto">
        <div className="shrink-0 w-12 relative" style={{ height: 24 * HOUR_H }}>
          {HOURS.map(h => (
            <div key={h} className="absolute w-full flex justify-end pr-2 items-start" style={{ top: h * HOUR_H, height: HOUR_H }}>
              {h > 0 && <span className="text-[8px] font-medium text-[#222] -translate-y-1.5 whitespace-nowrap">{fmtHour(h)}</span>}
            </div>
          ))}
        </div>
        <div className="flex-1 grid" style={{ gridTemplateColumns: `repeat(${days.length},minmax(0,1fr))` }}>
          {days.map((day, di) => {
            const tod = isToday(day);
            const dayEvts = eventsForDay(events, day);
            const dayTasks = showTasks ? tasksForDay(tasks, taskStates, day) : [];
            const layouts = layoutOverlap(dayEvts);
            return (
              <div key={di} className={`relative border-l border-[#232323] ${tod ? "bg-[#ffffff]/[0.015]" : ""}`} style={{ height: 24 * HOUR_H }}>
                {HOURS.map(h => <div key={h} className="absolute inset-x-0 border-t border-[#232323]" style={{ top: h * HOUR_H }} />)}
                {HOURS.map(h => <div key={`h${h}`} className="absolute inset-x-0 border-t border-[#1a1a1a]" style={{ top: h * HOUR_H + HOUR_H / 2 }} />)}
                {tod && <NowLine />}
                {layouts.map(({ ev, col, cols }) => <EvBlock key={ev.id} ev={ev} dayStart={day} sources={sources} col={col} cols={cols} onClick={() => onClickEvent(ev.id)} />)}
                {dayTasks.length > 0 && (
                  <div className="absolute inset-x-1 top-1 z-10 flex flex-col gap-px">
                    {dayTasks.slice(0, 2).map(t => {
                      const c = t.priority === 0 ? "#ff5f5f" : t.priority === 1 ? "#ffaa44" : t.priority === 2 ? "#5865f2" : "#555";
                      return (
                        <button key={t.id} onClick={() => onSelectTask(t.id)} className="flex items-center gap-1 w-full px-1.5 py-0.5 rounded-md border border-[#1e1e1e] bg-[#111] hover:bg-[#1a1a1a] transition-all text-left">
                          <span className="text-[8px] shrink-0" style={{ color: c }}>✓</span>
                          <span className="text-[9px] font-medium text-[#888] truncate flex-1">{t.title}</span>
                        </button>
                      );
                    })}
                    {dayTasks.length > 2 && <span className="text-[8px] text-[#333] pl-1">+{dayTasks.length - 2}</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthGrid({ currentDate, events, tasks, taskStates, sources, showEvents, showTasks, onClickEvent, onSelectTask }: {
  currentDate: Date; events: CalendarEvent[]; tasks: Task[]; taskStates: TaskWorkflowState[];
  sources: CalendarSource[]; showEvents: boolean; showTasks: boolean;
  onClickEvent: (id: string) => void; onSelectTask: (id: string) => void;
}) {
  const days = monthDays(currentDate);
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7));

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="grid grid-cols-7 border-b border-[#1c1c1c]">
        {DAY_ABR.map(name => (
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
              const dayEvents = showEvents ? eventsForDay(events, day) : [];
              const dayTasks = showTasks ? tasksForDay(tasks, taskStates, day) : [];
              return (
                <div key={di} className={`border-l border-[#1a1a1a] p-1 overflow-hidden ${!inMonth ? "opacity-40" : ""}`}>
                  <div className={`text-[12px] font-bold mb-1 w-7 h-7 grid place-items-center rounded-full ${td ? "bg-[#2f2f2f] text-white" : "text-[#aaa]"}`}>
                    {day.getDate()}
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {dayEvents.slice(0, 2).map(event => {
                      const source = sources.find(s => s.id === event.calendarId);
                      const color = event.color || source?.color || "#3a3a3a";
                      return (
                        <button
                          key={event.id}
                          className="w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-bold text-[#e0e0e0] hover:brightness-125 transition-colors"
                          style={{ backgroundColor: `${color}25`, borderLeft: `2px solid ${color}` }}
                          onClick={e => { e.stopPropagation(); onClickEvent(event.id); }}
                        >
                          {event.title}
                        </button>
                      );
                    })}
                    {dayTasks.slice(0, 2).map(task => (
                      <button
                        key={task.id}
                        className="w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] font-bold text-[#d8d8d8] bg-[#1a1a1a] border-l-2 border-[#666] hover:bg-[#222] transition-colors"
                        onClick={e => { e.stopPropagation(); onSelectTask(task.id); }}
                      >
                        {task.title}
                      </button>
                    ))}
                    {(dayEvents.length + dayTasks.length) > 4 && (
                      <div className="text-[9px] font-bold text-[#666] pl-1">+{dayEvents.length + dayTasks.length - 4} more</div>
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

export function PlanCalendarView({
  density,
  currentDate,
  events,
  tasks,
  taskStates,
  sources,
  showEvents,
  showTasks,
  onClickEvent,
  onSelectTask,
}: {
  density: CalDensity;
  currentDate: Date;
  events: CalendarEvent[];
  tasks: Task[];
  taskStates: TaskWorkflowState[];
  sources: CalendarSource[];
  showEvents: boolean;
  showTasks: boolean;
  onClickEvent: (id: string) => void;
  onSelectTask: (id: string) => void;
}) {
  if (density === "month") {
    return (
      <MonthGrid
        currentDate={currentDate}
        events={events}
        tasks={tasks}
        taskStates={taskStates}
        sources={sources}
        showEvents={showEvents}
        showTasks={showTasks}
        onClickEvent={onClickEvent}
        onSelectTask={onSelectTask}
      />
    );
  }
  const days = density === "day" ? [sod(currentDate)] : weekOf(currentDate);
  return (
    <TimeGrid
      days={days}
      events={showEvents ? events : []}
      tasks={tasks}
      taskStates={taskStates}
      sources={sources}
      showTasks={showTasks}
      onClickEvent={onClickEvent}
      onSelectTask={onSelectTask}
    />
  );
}
