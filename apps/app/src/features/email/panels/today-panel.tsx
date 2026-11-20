// The Today view of Mail's side panel (MR-14, specs/mail-v3.md §10): the date
// in the heading, today's events (past ones muted), the tasks due today as drop
// targets (drop a thread on a task to link it), the day itself (drop to make a
// task due today, with its hint shown whenever a thread is being dragged), and
// "Create event from this email" for the open thread.

import { CalendarPlus, Hand } from "lucide-react";
import { type DragEvent, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import type { MailDropTarget } from "../commands/spine";
import { MAIL_THREAD_MIME } from "../ui/mail-page-wiring";
import type { TodayEvent } from "./today-events";

export type TodayTask = { id: string; title: string };

export type TodayPanelProps = {
  tasks: readonly TodayTask[];
  /** Today's calendar events (the Calendar module's, recurring ones expanded). */
  events?: readonly TodayEvent[];
  /** Today's local date, `YYYY-MM-DD`. */
  date: string;
  /** The clock: events that ended before it are muted. */
  nowMs?: number;
  onDropThread: (threadId: string, target: MailDropTarget) => void;
  /** Absent when no thread is open. */
  onCreateEvent?: () => void;
};

const carriesThread = (types: ReadonlyArray<string> | DOMStringList | undefined) =>
  !!types && Array.from(types as ArrayLike<string>).includes(MAIL_THREAD_MIME);

function useDropZone(onDrop: (threadId: string) => void) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => carriesThread(e.dataTransfer.types);
  return {
    over,
    props: {
      onDragOver: (e: DragEvent) => {
        if (!accepts(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "link";
        setOver(true);
      },
      onDragLeave: () => setOver(false),
      onDrop: (e: DragEvent) => {
        setOver(false);
        const id = e.dataTransfer.getData(MAIL_THREAD_MIME);
        if (!id) return;
        e.preventDefault();
        onDrop(id);
      },
    },
  };
}

/** True while a mail thread is being dragged anywhere on the page. */
export function useThreadDragging(): boolean {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const start = (e: Event) => {
      const types = (e as { dataTransfer?: { types?: ReadonlyArray<string> } }).dataTransfer?.types;
      if (carriesThread(types)) setDragging(true);
    };
    const stop = () => setDragging(false);
    document.addEventListener("dragstart", start);
    document.addEventListener("dragend", stop);
    document.addEventListener("drop", stop);
    return () => {
      document.removeEventListener("dragstart", start);
      document.removeEventListener("dragend", stop);
      document.removeEventListener("drop", stop);
    };
  }, []);
  return dragging;
}

function TaskTarget({
  task,
  onDropThread,
}: {
  task: TodayTask;
  onDropThread: TodayPanelProps["onDropThread"];
}) {
  const zone = useDropZone((id) =>
    onDropThread(id, { kind: "task", taskId: task.id, label: task.title }),
  );
  return (
    <li
      {...zone.props}
      data-drop-task={task.id}
      className={cn(
        "truncate rounded-md px-2 py-1 text-sm text-foreground",
        zone.over && "bg-state-active",
      )}
    >
      {task.title}
    </li>
  );
}

const timeOf = (ms: number) =>
  new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

/** "Fri 6 Nov" for `2026-11-06`. */
export function todayHeading(date: string): string {
  const d = new Date(`${date}T12:00:00`);
  if (Number.isNaN(d.getTime())) return "Today";
  const day = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  return `Today · ${day.replace(",", "")}`;
}

function EventList({ events, nowMs }: { events: readonly TodayEvent[]; nowMs: number | null }) {
  return (
    <ul aria-label="Today's events" className="flex flex-col gap-0.5">
      {events.map((e) => {
        const past = nowMs !== null && !e.allDay && e.endMs <= nowMs;
        return (
          <li
            key={e.id}
            data-past={past || undefined}
            className="flex items-baseline gap-2 px-2 py-1 text-sm"
          >
            <span className="w-14 shrink-0 text-xs text-muted-foreground tabular-nums">
              {e.allDay ? "All day" : timeOf(e.startMs)}
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                past ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {e.title}
            </span>
            {past ? <span className="sr-only">, over</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export function TodayPanel({
  tasks,
  events = [],
  date,
  nowMs,
  onDropThread,
  onCreateEvent,
}: TodayPanelProps) {
  const day = useDropZone((id) => onDropThread(id, { kind: "day", date }));
  const dragging = useThreadDragging();
  return (
    <div className="flex flex-col gap-3 py-1" data-panel-view="today">
      <section className="flex flex-col gap-1">
        <h3 className="flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
          {todayHeading(date)}
        </h3>
        {events.length > 0 ? (
          <EventList events={events} nowMs={nowMs ?? null} />
        ) : (
          <p className="px-2 text-xs text-muted-foreground">No events today.</p>
        )}
      </section>
      <section className="flex flex-col gap-1">
        <h3 className="flex items-center gap-1.5 px-2 text-xs font-medium text-muted-foreground">
          Due today
          <span className="tabular-nums" data-due-count={tasks.length}>
            {tasks.length}
          </span>
        </h3>
        {tasks.length > 0 ? (
          <ul className="flex flex-col gap-0.5">
            {tasks.map((t) => (
              <TaskTarget key={t.id} task={t} onDropThread={onDropThread} />
            ))}
          </ul>
        ) : null}
        {dragging || tasks.length === 0 ? (
          <div
            {...day.props}
            data-drop-day={date}
            className={cn(
              "flex items-center gap-1.5 rounded-md border border-dashed border-border px-2 py-2 text-xs text-muted-foreground",
              day.over && "bg-state-active text-foreground",
            )}
          >
            <Hand className="size-icon-sm shrink-0" aria-hidden />
            Drop a thread here to do it today
          </div>
        ) : null}
      </section>
      {onCreateEvent ? (
        <Button size="sm" variant="ghost" className="justify-start" onClick={onCreateEvent}>
          <CalendarPlus className="size-icon-sm" aria-hidden />
          Create event from this email
        </Button>
      ) : null}
    </div>
  );
}
