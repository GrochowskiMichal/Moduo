import { useMemo } from "react";
import type { Task } from "../types";
import { priorityVisual } from "./task-visuals";

type AssigneeInfo = { label: string; avatarUrl: string | null; initial: string };

type Props = {
  tasks: Task[];
  selectedTaskId: string | null;
  projectNameById: Map<string, string>;
  assigneeById: Map<string, AssigneeInfo>;
  showProjectName: boolean;
  onSelectTask: (taskId: string) => void;
  onOpenTaskContextMenu?: (taskId: string, x: number, y: number) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_WIDTH = 44;
const ROW_H = 40;
const BAR_H = 22;
const MAX_DAYS = 180;

const DOW = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"] as const;

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return startOfDay(next);
}

function diffDays(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS);
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function parseDateTime(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

type GanttRow = {
  task: Task;
  start: Date;
  end: Date;
};

type MonthGroup = {
  label: string;
  startIndex: number;
  span: number;
};

function buildRow(task: Task, today: Date): GanttRow {
  const due = parseIsoDate(task.dueDate);
  const created = parseDateTime(task.createdAt);
  if (due) {
    const fallbackStart = addDays(due, -6);
    const baseline = created ?? fallbackStart;
    const start = diffDays(baseline, due) > 30 ? fallbackStart : baseline;
    return { task, start: start > due ? due : start, end: due };
  }
  const start = created ?? today;
  return { task, start, end: start };
}

function buildMonthGroups(days: Date[]): MonthGroup[] {
  const groups: MonthGroup[] = [];
  let currentMonth = -1;
  let currentYear = -1;
  let startIndex = 0;
  for (let i = 0; i < days.length; i++) {
    const day = days[i]!;
    if (day.getMonth() !== currentMonth || day.getFullYear() !== currentYear) {
      if (i > 0) {
        groups.push({
          label: days[startIndex]!.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
          startIndex,
          span: i - startIndex,
        });
      }
      currentMonth = day.getMonth();
      currentYear = day.getFullYear();
      startIndex = i;
    }
  }
  if (days.length > 0) {
    groups.push({
      label: days[startIndex]!.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
      startIndex,
      span: days.length - startIndex,
    });
  }
  return groups;
}

export function TasksGantt({ tasks, selectedTaskId, projectNameById, assigneeById, showProjectName, onSelectTask, onOpenTaskContextMenu }: Props) {
  const today = useMemo(() => startOfDay(new Date()), []);

  const { rows, rangeStart, dayCount } = useMemo(() => {
    const baseRows = tasks
      .map((task) => buildRow(task, today))
      .sort(
        (a, b) =>
          a.start.getTime() - b.start.getTime() ||
          a.task.priority - b.task.priority ||
          a.task.position.localeCompare(b.task.position)
      );

    if (!baseRows.length) {
      return { rows: [] as GanttRow[], rangeStart: addDays(today, -3), dayCount: 30 };
    }

    let min = baseRows[0]!.start;
    let max = baseRows[0]!.end;
    for (const row of baseRows) {
      if (row.start < min) min = row.start;
      if (row.end > max) max = row.end;
    }
    if (today < min) min = today;
    if (today > max) max = today;

    let rangeStart = addDays(min, -3);
    let rangeEnd = addDays(max, 5);
    const minEnd = addDays(rangeStart, 21);
    if (rangeEnd < minEnd) rangeEnd = minEnd;

    let dayCount = diffDays(rangeStart, rangeEnd) + 1;
    if (dayCount > MAX_DAYS) {
      rangeStart = addDays(rangeEnd, -(MAX_DAYS - 1));
      dayCount = MAX_DAYS;
    }

    return { rows: baseRows, rangeStart, dayCount };
  }, [tasks, today]);

  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, i) => addDays(rangeStart, i)),
    [dayCount, rangeStart]
  );

  const monthGroups = useMemo(() => buildMonthGroups(days), [days]);
  const timelineWidth = dayCount * DAY_WIDTH;
  const todayOffset = diffDays(rangeStart, today) * DAY_WIDTH;

  if (!rows.length) {
    return (
      <div className="grid h-full place-items-center text-[12px] text-[#3a3a3a]">
        No tasks with dates to display.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto">
      <div className="min-w-max">

        {/* ── HEADER ──────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 border-b border-[#1c1c1c]">

          {/* Month band */}
          <div className="grid grid-cols-[280px_auto]">
            <div className="border-r border-[#1c1c1c] h-6" />
            <div className="relative h-6" style={{ width: timelineWidth }}>
              {monthGroups.map((group) => (
                <div
                  key={`${group.label}-${group.startIndex}`}
                  className="absolute top-0 h-full border-r border-[#1c1c1c] flex items-center px-2.5 overflow-hidden"
                  style={{ left: group.startIndex * DAY_WIDTH, width: group.span * DAY_WIDTH }}
                >
                  <span className="text-[9.5px] font-semibold uppercase tracking-[0.16em] text-[#383e4a] whitespace-nowrap select-none">
                    {group.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Day band – one cell per day, shows DOW + date number */}
          <div className="grid grid-cols-[280px_auto]">
            <div className="h-10 px-3 flex items-center border-r border-[#1c1c1c]">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#2a2f3a]">
                Task
              </span>
            </div>
            <div className="relative h-10" style={{ width: timelineWidth }}>
              {/* Today column tint in header */}
              {todayOffset >= 0 && todayOffset < timelineWidth && (
                <div
                  className="absolute top-0 h-full pointer-events-none"
                  style={{ left: todayOffset, width: DAY_WIDTH, background: "rgba(240,164,61,0.06)" }}
                />
              )}

              {days.map((day, index) => {
                const isToday = day.getTime() === today.getTime();
                const isWeekend = day.getDay() === 0 || day.getDay() === 6;
                return (
                  <div
                    key={day.toISOString()}
                    className={`absolute top-0 h-full border-r flex flex-col items-center justify-center gap-[2px] ${
                      isWeekend ? "border-[#161616]" : "border-[#181818]"
                    }`}
                    style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }}
                  >
                    <span
                      className={`text-[8px] font-semibold tracking-wide select-none leading-none ${
                        isToday
                          ? "text-[#f0a43d]"
                          : isWeekend
                          ? "text-[#252525]"
                          : "text-[#32394a]"
                      }`}
                    >
                      {DOW[day.getDay()]}
                    </span>
                    <span
                      className={`text-[10px] tabular-nums select-none leading-none font-medium ${
                        isToday
                          ? "text-[#f0a43d] font-bold"
                          : isWeekend
                          ? "text-[#252525]"
                          : "text-[#3a4052]"
                      }`}
                    >
                      {day.getDate()}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── ROWS ────────────────────────────────────────────── */}
        <div>
          {rows.map((row, rowIdx) => {
            const priority = priorityVisual(row.task.priority);
            const rowStart = row.start < rangeStart ? rangeStart : row.start;
            const rowEnd = row.end < rowStart ? rowStart : row.end;
            const startOffset = diffDays(rangeStart, rowStart) * DAY_WIDTH;
            const span = Math.max(1, diffDays(rowStart, rowEnd) + 1);
            // bar occupies the span columns minus a small gap on each side
            const barWidth = Math.max(DAY_WIDTH - 4, span * DAY_WIDTH - 6);
            const selected = selectedTaskId === row.task.id;
            const isEven = rowIdx % 2 === 0;
            const rowBg = selected
              ? "bg-white/[0.03]"
              : isEven
              ? "bg-transparent hover:bg-white/[0.015]"
              : "bg-transparent hover:bg-white/[0.012]";

            const projectName = showProjectName ? projectNameById.get(row.task.projectId) : undefined;
            const assignee = row.task.assigneeId ? assigneeById.get(row.task.assigneeId) : undefined;
            const dueDateFormatted = row.task.dueDate
              ? new Date(`${row.task.dueDate}T00:00:00`).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })
              : null;

            // weekend stripe pattern for the timeline cell
            const weekendBg = days
              .map((day, i) =>
                day.getDay() === 0 || day.getDay() === 6
                  ? `rgba(255,255,255,0.012) ${i * DAY_WIDTH}px, rgba(255,255,255,0.012) ${(i + 1) * DAY_WIDTH}px`
                  : null
              )
              .filter(Boolean)
              .join(", ");

            return (
              <div
                key={row.task.id}
                className={`grid grid-cols-[280px_auto] border-b ${
                  selected ? "border-[#222222]" : "border-[#131313]"
                }`}
              >
                {/* Label column */}
                <button
                  type="button"
                  className={`px-3 text-left border-r border-[#161616] transition-colors flex flex-col justify-center gap-[3px] ${rowBg}`}
                  style={{ height: ROW_H }}
                  onClick={() => onSelectTask(row.task.id)}
                  onContextMenu={(event) => {
                    if (!onOpenTaskContextMenu) return;
                    event.preventDefault();
                    onOpenTaskContextMenu(row.task.id, event.clientX, event.clientY);
                  }}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span
                      className="shrink-0 w-[3px] h-[11px] rounded-full"
                      style={{ backgroundColor: priority.color }}
                    />
                    <span
                      className={`truncate text-[12px] font-medium leading-none ${
                        selected ? "text-[#e8e8e8]" : "text-[#b8b8b8]"
                      }`}
                    >
                      {row.task.title || "Untitled"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 pl-[11px]">
                    <span
                      className="text-[9px] font-bold tracking-wide shrink-0"
                      style={{ color: priority.color, opacity: 0.7 }}
                    >
                      {priority.label}
                    </span>
                    {projectName && (
                      <span className="truncate text-[10px] text-[#2b3040]">
                        {projectName}
                      </span>
                    )}
                    {assignee && (
                      <span className="ml-auto shrink-0 flex items-center gap-1">
                        {assignee.avatarUrl ? (
                          <img
                            src={assignee.avatarUrl}
                            alt={assignee.label}
                            className="w-4 h-4 rounded-full object-cover ring-1 ring-[#2a2a2a]"
                          />
                        ) : (
                          <span className="w-4 h-4 rounded-full bg-[#252525] ring-1 ring-[#2a2a2a] flex items-center justify-center text-[8px] font-bold text-[#555]">
                            {assignee.initial}
                          </span>
                        )}
                      </span>
                    )}
                  </div>
                </button>

                {/* Timeline column */}
                <button
                  type="button"
                  className={`relative text-left transition-colors overflow-hidden ${rowBg}`}
                  style={{
                    width: timelineWidth,
                    height: ROW_H,
                    backgroundImage: weekendBg ? `linear-gradient(transparent, transparent), linear-gradient(to right, ${weekendBg})` : undefined,
                  }}
                  onClick={() => onSelectTask(row.task.id)}
                  onContextMenu={(event) => {
                    if (!onOpenTaskContextMenu) return;
                    event.preventDefault();
                    onOpenTaskContextMenu(row.task.id, event.clientX, event.clientY);
                  }}
                >
                  {/* Day grid lines */}
                  {days.map((day, index) => (
                    <div
                      key={day.toISOString()}
                      className={`absolute top-0 h-full border-r pointer-events-none ${
                        day.getDay() === 0 || day.getDay() === 6
                          ? "border-[#141414]"
                          : "border-[#111111]"
                      }`}
                      style={{ left: index * DAY_WIDTH, width: DAY_WIDTH }}
                    />
                  ))}

                  {/* Today column */}
                  {todayOffset >= 0 && todayOffset < timelineWidth && (
                    <div
                      className="absolute top-0 h-full pointer-events-none z-10"
                      style={{ left: todayOffset, width: DAY_WIDTH }}
                    >
                      <div className="absolute inset-0" style={{ background: "rgba(240,164,61,0.03)" }} />
                      <div className="absolute top-0 left-0 h-full w-px" style={{ background: "rgba(240,164,61,0.4)" }} />
                    </div>
                  )}

                  {/* Bar shape */}
                  <div
                    className={`absolute rounded-[3px] pointer-events-none z-20 ${
                      selected
                        ? "shadow-[0_0_0_1px_rgba(255,255,255,0.1),0_2px_8px_rgba(0,0,0,0.6)]"
                        : "shadow-[0_1px_4px_rgba(0,0,0,0.4)]"
                    }`}
                    style={{
                      top: "50%",
                      transform: "translateY(-50%)",
                      left: startOffset + 3,
                      width: barWidth,
                      height: BAR_H,
                      backgroundColor: selected ? "#1e1e1e" : "#191919",
                      borderLeft: `2px solid ${priority.color}`,
                    }}
                  />

                  {/* Bar label — floats after bar left edge, overflows bar bounds */}
                  <div
                    className="absolute pointer-events-none z-30 flex items-center"
                    style={{
                      top: "50%",
                      transform: "translateY(-50%)",
                      left: startOffset + 8,
                      // extend to end of timeline so text is never clipped
                      width: timelineWidth - startOffset - 8,
                      height: BAR_H,
                    }}
                  >
                    <span
                      className="whitespace-nowrap text-[10.5px] leading-none select-none font-medium"
                      style={{ color: selected ? "#c8cdd8" : "#6a7080" }}
                    >
                      {row.task.title || "Untitled"}
                      {dueDateFormatted && (
                        <span
                          className="ml-2 text-[9px]"
                          style={{ color: selected ? "#8a8f9a" : "#404550", opacity: 0.85 }}
                        >
                          {dueDateFormatted}
                        </span>
                      )}
                    </span>
                  </div>
                </button>
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
