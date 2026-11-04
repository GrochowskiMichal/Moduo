// The Today panel (MR-14, AC33): today's tasks as drop targets (drop a thread
// on a task to link it), the day itself (drop to make a task due today), and
// "Create event from this email" for the open thread.

import { CalendarPlus } from "lucide-react";
import { type DragEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { cn } from "@/lib/utils";

import type { MailDropTarget } from "../commands/spine";
import { MAIL_THREAD_MIME } from "../ui/mail-page-wiring";

export type TodayTask = { id: string; title: string };

export type TodayPanelProps = {
  tasks: readonly TodayTask[];
  /** Today's local date, `YYYY-MM-DD`. */
  date: string;
  onDropThread: (threadId: string, target: MailDropTarget) => void;
  /** Absent when no thread is open. */
  onCreateEvent?: () => void;
};

function useDropZone(onDrop: (threadId: string) => void) {
  const [over, setOver] = useState(false);
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(MAIL_THREAD_MIME);
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

export function TodayPanel({ tasks, date, onDropThread, onCreateEvent }: TodayPanelProps) {
  const day = useDropZone((id) => onDropThread(id, { kind: "day", date }));
  return (
    <aside aria-label="Today" className="flex flex-col gap-2 p-3">
      <div
        {...day.props}
        data-drop-day={date}
        className={cn("rounded-md px-2 py-1", day.over && "bg-state-active")}
      >
        <Eyebrow as="div">Today</Eyebrow>
      </div>
      {tasks.length > 0 ? (
        <ul className="flex flex-col gap-0.5">
          {tasks.map((t) => (
            <TaskTarget key={t.id} task={t} onDropThread={onDropThread} />
          ))}
        </ul>
      ) : (
        <p className="px-2 text-xs text-muted-foreground">Drop a thread here to do it today.</p>
      )}
      {onCreateEvent ? (
        <Button size="sm" variant="ghost" onClick={onCreateEvent}>
          <CalendarPlus className="size-icon-sm" aria-hidden />
          Create event from this email
        </Button>
      ) : null}
    </aside>
  );
}
