// A day's header over the grid (CALR-2, AC6): the weekday as an eyebrow over a
// large date, today's date in the pill, and the day's open due work as one
// quiet dashed "2 due" beside the date. Every header has the same two fixed
// rows, so all dates sit on one baseline whatever a day carries. The count
// opens that day's list: a row opens its task, Schedule (S) puts it on the day.

import { Circle } from "lucide-react";
import { type KeyboardEvent, useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "../../../components/ui/button";
import { Kbd } from "../../../components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
import type { DueChip } from "../lens";

type Props = {
  day: Date;
  today: boolean;
  past: boolean;
  /** The day's due-only tasks (done ones are left out of the count and list). */
  due: readonly DueChip[];
  onOpenTask: (taskId: string) => void;
  onSchedule: (taskId: string) => void;
  /** False for a view-only reader: the list opens tasks but schedules nothing. */
  canSchedule?: boolean;
};

export function DayHeader({
  day,
  today,
  past,
  due,
  onOpenTask,
  onSchedule,
  canSchedule = true,
}: Props) {
  const open = due.filter((d) => !d.done);
  const weekend = day.getDay() === 0 || day.getDay() === 6;
  return (
    <div
      data-day-header
      className={cn(
        "@container flex min-w-0 flex-col gap-0.5 px-2 pb-2 pt-1.5",
        today ? "text-foreground" : "text-subtle-foreground",
      )}
    >
      <div
        data-day-weekday
        className="flex h-3.5 items-center text-2xs font-medium leading-none tracking-wide"
      >
        {day.toLocaleDateString(undefined, { weekday: "short" })}
      </div>
      <div data-day-date-row className="flex h-7 min-w-0 items-center gap-1.5">
        <span
          data-day-date
          data-today-pill={today ? "" : undefined}
          className={cn(
            "shrink-0 font-display font-semibold leading-none tracking-tight tabular-nums",
            today
              ? "inline-grid h-7 min-w-7 place-items-center rounded-full bg-primary px-1.5 text-lg text-primary-foreground"
              : cn(
                  "text-xl",
                  past
                    ? "text-subtle-foreground"
                    : weekend
                      ? "text-muted-foreground"
                      : "text-foreground",
                ),
          )}
        >
          {day.getDate()}
        </span>
        {open.length > 0 ? (
          <DueList
            day={day}
            due={open}
            onOpenTask={onOpenTask}
            onSchedule={canSchedule ? onSchedule : null}
          />
        ) : null}
      </div>
    </div>
  );
}

function DueList({
  day,
  due,
  onOpenTask,
  onSchedule,
}: {
  day: Date;
  due: readonly DueChip[];
  onOpenTask: (taskId: string) => void;
  onSchedule: ((taskId: string) => void) | null;
}) {
  const [open, setOpen] = useState(false);
  const dayLabel = day.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!onSchedule || e.key.toLowerCase() !== "s" || e.metaKey || e.ctrlKey || e.altKey) return;
    const row =
      e.target instanceof Element ? e.target.closest<HTMLElement>("[data-task-id]") : null;
    const taskId = row?.dataset.taskId ?? due[0]?.taskId;
    if (!taskId) return;
    e.preventDefault();
    e.stopPropagation();
    setOpen(false);
    onSchedule(taskId);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`${due.length} due on ${dayLabel}`}
          className="inline-flex h-(--ctrl-h-xs) min-w-0 items-center overflow-hidden rounded-md border border-dashed border-timeline-outline px-1.5 text-2xs tabular-nums @max-day-narrow:px-1 whitespace-nowrap text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-state-active aria-expanded:text-foreground"
        >
          <span className="min-w-0 truncate">{due.length}</span>
          <span className="whitespace-pre @max-day-narrow:hidden"> due</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72 p-1.5">
        <div className="flex flex-col">
          <div className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground">Due {dayLabel}</div>
          {due.map((task) => (
            <div key={task.taskId} data-task-id={task.taskId} className="flex items-center gap-1">
              <button
                type="button"
                // The task opens in the right panel; the list stays for the next one.
                onClick={() => onOpenTask(task.taskId)}
                onKeyDown={onKeyDown}
                className="flex h-(--row-h-sm) min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm text-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Circle className="size-3 shrink-0 text-subtle-foreground" aria-hidden />
                <span className="min-w-0 truncate">{task.title || "Untitled"}</span>
              </button>
              {onSchedule ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="shrink-0"
                  onClick={() => {
                    setOpen(false);
                    onSchedule(task.taskId);
                  }}
                >
                  Schedule <Kbd>S</Kbd>
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The short name of the zone the grid's hours are in ("CET", "PT"). */
export function zoneAbbreviation(at: Date, timeZone?: string): string {
  const read = (locale: string | undefined) =>
    new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? "";
  const own = read(undefined);
  // Many locales spell European zones as "GMT+1"; British English names them.
  if (!/^(GMT|UTC)[+-]/.test(own)) return own;
  const gb = read("en-GB");
  return /^(GMT|UTC)[+-]/.test(gb) ? own : gb;
}

/** The corner above the hours: the zone the grid reads in. */
export function ZoneCorner({ at }: { at: Date }) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <div
      data-zone-corner
      title={zone ? `Times in ${zone.replace(/_/g, " ")}` : undefined}
      className="flex items-end justify-end pb-2 pr-1.5 text-2xs text-subtle-foreground"
    >
      <span className="flex h-(--ctrl-h-xs) items-center">{zoneAbbreviation(at)}</span>
    </div>
  );
}
