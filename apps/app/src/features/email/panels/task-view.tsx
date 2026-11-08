// The Task view of Mail's side panel (specs/mail-v3.md §10, prototype
// `taskMade`): the task linked to the open thread through the spine, shown
// after `t` or when its chip is clicked. Title, status, due date, project and
// notes, plus "Open in Tasks"; with no linked task, "No task yet · t makes one".

import { ExternalLink } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Textarea } from "@/components/ui/textarea";

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
  /** The task `t` just made: its title opens editable, text selected (specs/mail-improve.md AC13). */
  editTitleFor?: string | null;
  onRenameTask?: (taskId: string, title: string) => void;
  /** The edit ended (saved or cancelled). */
  onEditTitleDone?: () => void;
};

/** The just-made task's title: an auto-growing field, text selected; Enter saves, Esc cancels. */
function TitleField({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (title: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(initial);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
  }, []);
  return (
    <Textarea
      ref={ref}
      id="task-title"
      aria-label="Task title"
      rows={1}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const next = value.trim();
          if (next && next !== initial) onSave(next);
          else onCancel();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onCancel();
        }
      }}
      onBlur={onCancel}
      className="field-sizing-content min-h-0 resize-none text-sm font-medium"
    />
  );
}

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
  editing,
  onRename,
  onEditDone,
}: {
  link: MailThreadLink;
  detail: MailTaskDetail | null;
  onOpenTask?: (taskId: string) => void;
  editing: boolean;
  onRename?: (taskId: string, title: string) => void;
  onEditDone: () => void;
}) {
  const id = link.entity.id;
  const known = detail?.title ?? link.entity.label ?? "Task";
  // A saved rename shows at once, before the task data catches up.
  const [renamed, setRenamed] = useState<string | null>(null);
  const title = renamed ?? known;
  return (
    <article aria-label={`Task: ${title}`} className="flex flex-col gap-3 px-2">
      {editing && onRename ? (
        <TitleField
          initial={title}
          onSave={(next) => {
            setRenamed(next);
            onRename(id, next);
            onEditDone();
          }}
          onCancel={onEditDone}
        />
      ) : (
        <h3 className="text-sm font-medium break-words text-foreground">{title}</h3>
      )}
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

export function TaskView({
  threadId,
  links,
  taskFor,
  onOpenTask,
  onMakeTask,
  editTitleFor = null,
  onRenameTask,
  onEditTitleDone,
}: TaskViewProps) {
  // Local so Esc or Enter ends the edit even when the page never clears `editTitleFor`.
  const [editing, setEditing] = useState(editTitleFor);
  const [seen, setSeen] = useState(editTitleFor);
  if (editTitleFor !== seen) {
    setSeen(editTitleFor);
    setEditing(editTitleFor);
  }
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
          editing={editing === l.entity.id}
          onRename={onRenameTask}
          onEditDone={() => {
            setEditing(null);
            onEditTitleDone?.();
          }}
        />
      ))}
    </div>
  );
}
