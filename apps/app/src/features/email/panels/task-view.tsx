// The Task view of Mail's side panel (specs/mail-v3.md §10, prototype
// `taskMade`): the task linked to the open thread through the spine, shown
// after `t` or when its chip is clicked. Title, status, due date, project and
// notes, plus "Open in Tasks"; with no linked task, "No task yet · t makes one".

import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";

import type { MailThreadLink } from "../commands/spine";
import { NoThread } from "./contact-view";

/** A task as the panel shows it (the route reads it from the Tasks data). */
export type MailTaskDetail = {
  id: string;
  title: string;
  status: string;
  /** "Fri 6 Nov", or null without a date. */
  due: string | null;
  project: string | null;
  notes: string;
};

export type TaskViewProps = {
  threadId: string | null;
  /** The thread's links; the task ones are shown. */
  links: readonly MailThreadLink[];
  taskFor?: (taskId: string) => MailTaskDetail | null;
  onOpenTask?: (taskId: string) => void;
  /** `t` from the panel: make a task from the thread. */
  onMakeTask?: () => void;
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline gap-3">
      <dt className="w-16 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 flex-1 text-sm break-words text-foreground">{value}</dd>
    </div>
  );
}

function TaskCard({
  link,
  detail,
  onOpenTask,
}: {
  link: MailThreadLink;
  detail: MailTaskDetail | null;
  onOpenTask?: (taskId: string) => void;
}) {
  const id = link.entity.id;
  const title = detail?.title ?? link.entity.label ?? "Task";
  return (
    <article aria-label={`Task: ${title}`} className="flex flex-col gap-3 px-2">
      <h3 className="text-sm font-medium break-words text-foreground">{title}</h3>
      <dl className="flex flex-col gap-1.5">
        {detail ? <Field label="Status" value={detail.status} /> : null}
        <Field label="Due" value={detail?.due ?? "No date"} />
        <Field label="Project" value={detail?.project ?? "Inbox"} />
      </dl>
      {detail?.notes ? (
        <p className="line-clamp-6 text-sm whitespace-pre-line text-muted-foreground">
          {detail.notes}
        </p>
      ) : null}
      {onOpenTask ? (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => onOpenTask(id)}>
          <ExternalLink aria-hidden />
          Open in Tasks
        </Button>
      ) : null}
    </article>
  );
}

export function TaskView({ threadId, links, taskFor, onOpenTask, onMakeTask }: TaskViewProps) {
  if (!threadId) {
    return <NoThread what="Pick a conversation to see the task made from it." />;
  }
  const tasks = links.filter((l) => l.entity.type === "task");
  if (tasks.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2 px-4 pt-12 text-center"
        data-panel-view="task"
      >
        <p className="text-sm text-muted-foreground">
          No task yet · <Kbd>t</Kbd> makes one
        </p>
        {onMakeTask ? (
          <Button size="sm" variant="secondary" onClick={onMakeTask}>
            Make a task
          </Button>
        ) : null}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6 py-1" data-panel-view="task">
      {tasks.map((l) => (
        <TaskCard
          key={l.linkId}
          link={l}
          detail={taskFor?.(l.entity.id) ?? null}
          onOpenTask={onOpenTask}
        />
      ))}
    </div>
  );
}
