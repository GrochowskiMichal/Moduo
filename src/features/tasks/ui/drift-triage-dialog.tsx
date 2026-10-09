import { Archive, CalendarClock, Clock, EyeOff } from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { formatScheduled } from "../helpers";
import type { Task } from "../model";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bucketName: string;
  /** Drifted tasks in this bucket (scheduled time passed, still open). */
  tasks: Task[];
  canEdit: boolean;
  onReschedule: (id: string, days: number) => void;
  onArchive: (id: string) => void;
  /** Ignore = clear the past scheduled time; the task stays, the drift clears. */
  onIgnore: (id: string) => void;
  /** Where focus goes on close: the dialog has no trigger to return to. */
  onCloseAutoFocus?: (event: Event) => void;
};

/**
 * Batch-triage for a bucket's drifted tasks. Soft and pressure-free (design
 * principles 4 & 5): factual copy, never "overdue", never red. Three escape
 * hatches — reschedule, archive, or ignore — at the batch and per-task level.
 */
export function DriftTriageDialog({
  open,
  onOpenChange,
  bucketName,
  tasks,
  canEdit,
  onReschedule,
  onArchive,
  onIgnore,
  onCloseAutoFocus,
}: Props) {
  const count = tasks.length;
  const applyAll = (fn: (id: string) => void) => {
    for (const t of tasks) fn(t.id);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>
            {bucketName} · {count} drifted
          </DialogTitle>
          <DialogDescription>
            Scheduled times that already passed. Triage at your own pace — nothing here is overdue.
            Ignore keeps the task and just drops the stale time.
          </DialogDescription>
        </DialogHeader>

        {count === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing drifting here.</p>
        ) : (
          <>
            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2">
                <Eyebrow tone="muted">Apply to all</Eyebrow>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline">
                      <CalendarClock className="size-4" aria-hidden />
                      Reschedule
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => applyAll((id) => onReschedule(id, 1))}>
                      To tomorrow
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => applyAll((id) => onReschedule(id, 7))}>
                      To next week
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button size="sm" variant="ghost" onClick={() => applyAll(onArchive)}>
                  <Archive className="size-4" aria-hidden />
                  Archive
                </Button>
                <Button size="sm" variant="ghost" onClick={() => applyAll(onIgnore)}>
                  <EyeOff className="size-4" aria-hidden />
                  Ignore
                </Button>
              </div>
            ) : null}

            <div className="-mx-1 max-h-72 overflow-y-auto">
              {tasks.map((task) => (
                <TriageRow
                  key={task.id}
                  task={task}
                  canEdit={canEdit}
                  onReschedule={onReschedule}
                  onArchive={onArchive}
                  onIgnore={onIgnore}
                />
              ))}
            </div>
          </>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button size="sm" variant="secondary">
              Done
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TriageRow({
  task,
  canEdit,
  onReschedule,
  onArchive,
  onIgnore,
}: {
  task: Task;
  canEdit: boolean;
  onReschedule: (id: string, days: number) => void;
  onArchive: (id: string) => void;
  onIgnore: (id: string) => void;
}) {
  const when = formatScheduled(task.scheduledAt);
  return (
    <div
      className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-accent/60"
      style={{ minHeight: "var(--row-h)" }}
    >
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm text-foreground">{task.title || "Untitled"}</p>
        {when ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" aria-hidden />
            {when}
          </p>
        ) : null}
      </div>
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              Triage
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => onReschedule(task.id, 1)}>
              Reschedule to tomorrow
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onReschedule(task.id, 7)}>
              Reschedule to next week
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onArchive(task.id)}>Archive</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onIgnore(task.id)}>
              Ignore (clear time)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
