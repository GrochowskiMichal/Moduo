import { useMemo } from "react";
import type { Task } from "../types";
import { priorityVisual } from "./task-visuals";

type Props = {
  tasks: Task[];
  selectedTaskId: string | null;
  projectNameById: Map<string, string>;
  onSelectTask: (taskId: string) => void;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_WIDTH = 34;
const MAX_DAYS = 180;

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

function buildRow(task: Task, today: Date): GanttRow {
  const due = parseIsoDate(task.dueDate);
  const created = parseDateTime(task.createdAt);
  if (due) {
    const fallbackStart = addDays(due, -6);
    const baseline = created ?? fallbackStart;
    const start = diffDays(baseline, due) > 30 ? fallbackStart : baseline;
    return {
      task,
      start: start > due ? due : start,
      end: due,
    };
  }
  const start = created ?? today;
  return { task, start, end: start };
}

export function TasksGantt({ tasks, selectedTaskId, projectNameById, onSelectTask }: Props) {
  const { rows, rangeStart, rangeEnd, dayCount } = useMemo(() => {
    const today = startOfDay(new Date());
    const baseRows = tasks
      .map((task) => buildRow(task, today))
      .sort((a, b) => a.start.getTime() - b.start.getTime() || a.task.priority - b.task.priority || a.task.position.localeCompare(b.task.position));

    if (!baseRows.length) {
      return {
        rows: [] as GanttRow[],
        rangeStart: today,
        rangeEnd: addDays(today, 13),
        dayCount: 14,
      };
    }

    let min = baseRows[0]!.start;
    let max = baseRows[0]!.end;
    for (const row of baseRows) {
      if (row.start < min) min = row.start;
      if (row.end > max) max = row.end;
    }

    let rangeStart = addDays(min, -1);
    let rangeEnd = addDays(max, 1);
    const minEnd = addDays(rangeStart, 13);
    if (rangeEnd < minEnd) rangeEnd = minEnd;

    let dayCount = diffDays(rangeStart, rangeEnd) + 1;
    if (dayCount > MAX_DAYS) {
      rangeStart = addDays(rangeEnd, -(MAX_DAYS - 1));
      dayCount = MAX_DAYS;
    }

    return { rows: baseRows, rangeStart, rangeEnd, dayCount };
  }, [tasks]);

  const timelineWidth = dayCount * DAY_WIDTH;
  const days = useMemo(
    () => Array.from({ length: dayCount }, (_, index) => addDays(rangeStart, index)),
    [dayCount, rangeStart]
  );

  if (!rows.length) {
    return (
      <div className="grid h-full place-items-center rounded-2xl border border-[#232323] bg-[#101010] text-[13px] text-[#808892]">
        No tasks for timeline.
      </div>
    );
  }

  return (
    <div className="h-full min-h-0 overflow-auto rounded-2xl border border-[#232323] bg-[#101010]">
      <div className="min-w-max">
        <div className="sticky top-0 z-20 grid grid-cols-[260px_auto] border-b border-[#242424] bg-[#121212]">
          <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[#8d96a4]">Task</div>
          <div className="relative h-9" style={{ width: timelineWidth }}>
            {days.map((day, index) => (
              <div key={day.toISOString()} className="absolute top-0 h-full border-l border-white/[0.05]" style={{ left: index * DAY_WIDTH }}>
                {index % 3 === 0 ? (
                  <span className="absolute left-1 top-2 text-[10px] text-[#8d96a4]">
                    {day.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div>
          {rows.map((row) => {
            const priority = priorityVisual(row.task.priority);
            const rowStart = row.start < rangeStart ? rangeStart : row.start;
            const rowEnd = row.end < rowStart ? rowStart : row.end;
            const startOffset = diffDays(rangeStart, rowStart) * DAY_WIDTH;
            const span = Math.max(1, diffDays(rowStart, rowEnd) + 1);
            const barWidth = Math.max(16, span * DAY_WIDTH - 6);
            const selected = selectedTaskId === row.task.id;

            return (
              <div key={row.task.id} className="grid grid-cols-[260px_auto] border-b border-[#1c1c1c] last:border-b-0">
                <button
                  type="button"
                  className={`h-12 px-3 text-left transition-colors ${selected ? "bg-[#151920]" : "hover:bg-[#151515]"}`}
                  onClick={() => onSelectTask(row.task.id)}
                >
                  <div className="truncate text-[13px] text-[#e5eaf2]">{row.task.title || "Untitled"}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] text-[#8792a3]">
                    <span style={{ color: priority.color }}>{priority.icon}</span>
                    <span className="truncate">{projectNameById.get(row.task.projectId) ?? "Project"}</span>
                  </div>
                </button>

                <button
                  type="button"
                  className={`relative h-12 text-left ${selected ? "bg-[#121822]" : "hover:bg-[#121212]"}`}
                  style={{
                    width: timelineWidth,
                    backgroundImage: "linear-gradient(to right, rgba(255,255,255,0.05) 1px, transparent 1px)",
                    backgroundSize: `${DAY_WIDTH}px 100%`,
                  }}
                  onClick={() => onSelectTask(row.task.id)}
                >
                  <div
                    className={`absolute top-2.5 h-7 rounded-md border px-2 text-[11px] leading-7 ${selected
                      ? "border-[#6581b8] bg-[#22395d] text-[#dbeafe]"
                      : "border-[#3a4a62] bg-[#1d2b42] text-[#c7d2e6]"
                      }`}
                    style={{ left: startOffset + 3, width: barWidth }}
                  >
                    <span className="truncate">{row.task.dueDate ?? "No due date"}</span>
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
