import { Circle, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { EmptyState } from "../../../components/ui/empty-state";
import { NavRowDot } from "../../../components/ui/nav-row";
import { Toolbar } from "../../../components/ui/toolbar";
import type { TrashTarget } from "../hooks/use-tasks-module";
import type { TasksTrash } from "../model";
import { type TrashEntry, trashDaysLeft, trashEntries } from "../trash";

/** The quiet line under a deleted bucket or task. */
export function trashEntryMeta(entry: TrashEntry): string {
  if (entry.kind === "task") return entry.bucketName ? `Task · ${entry.bucketName}` : "Task";
  const n = (count: number) => (count === 1 ? "1 task" : `${count} tasks`);
  if (entry.deletedTasks > 0) return `Bucket · ${n(entry.deletedTasks)} deleted with it`;
  if (entry.movedTasks > 0) return `Bucket · ${n(entry.movedTasks)} moved to Inbox`;
  return "Bucket";
}

/** "27 days left", "1 day left", "Last day". */
export function trashLeftLabel(deletedAt: string, now?: Date): string {
  const days = trashDaysLeft(deletedAt, now);
  if (days === 0) return "Last day";
  return days === 1 ? "1 day left" : `${days} days left`;
}

/**
 * Recently deleted (tasks-v2 §11, U6-3): every task and bucket deleted in the
 * last 30 days, newest first, each with Restore and Delete forever. A bucket
 * deleted with its tasks is one row; Restore brings the whole batch back,
 * files and subtasks too. After 30 days the daily purge removes them.
 */
export function RecentlyDeletedView({
  trash,
  bucketName,
  canEdit,
  onRestore,
  onDeleteForever,
}: {
  trash: TasksTrash | null;
  /** Names a live bucket, for "Task · Marketing". */
  bucketName: (id: string) => string | null;
  canEdit: boolean;
  onRestore: (target: TrashTarget, label: string) => void;
  onDeleteForever: (target: TrashTarget) => void;
}) {
  const entries = useMemo(() => trashEntries(trash, { bucketName }), [trash, bucketName]);
  const [confirming, setConfirming] = useState<{ entry: TrashEntry; open: boolean } | null>(null);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 shrink-0 space-y-1">
        <Toolbar>
          <h1 className="truncate font-display text-lg text-foreground">Recently deleted</h1>
        </Toolbar>
        <p className="font-sans text-xs text-muted-foreground">
          Deleted tasks and buckets stay here for 30 days. After that they’re gone for good, with
          their files.
        </p>
      </div>
      {entries.length === 0 ? (
        <EmptyState
          icon={Trash2}
          title="Nothing here"
          description="Deleted tasks and buckets show up here for 30 days."
        />
      ) : (
        <ul aria-label="Recently deleted" className="pane-scroll min-h-0 flex-1 overflow-auto">
          {entries.map((entry) => {
            const label = entry.kind === "bucket" ? entry.name : entry.title;
            const target: TrashTarget = { kind: entry.kind, id: entry.id };
            return (
              <li
                key={`${entry.kind}:${entry.id}`}
                className="group/trash flex h-(--row-h) min-w-0 items-center gap-2.5 rounded-md px-2 hover:bg-state-hover"
              >
                <span className="flex w-icon shrink-0 items-center justify-center text-muted-foreground">
                  {entry.kind === "bucket" ? (
                    <NavRowDot color={entry.color} />
                  ) : (
                    <Circle className="size-icon-sm" aria-hidden />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span className="truncate font-sans text-base text-foreground">{label}</span>
                  <span className="shrink-0 truncate font-sans text-xs text-muted-foreground">
                    {trashEntryMeta(entry)}
                  </span>
                </span>
                {canEdit ? (
                  // Revealed on hover or keyboard focus; the space is always
                  // reserved, so nothing reflows (R6).
                  <span className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/trash:opacity-100 group-focus-within/trash:opacity-100">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Restore ${label}`}
                      onClick={() => onRestore(target, label)}
                    >
                      Restore
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      aria-label={`Delete ${label} forever`}
                      onClick={() => setConfirming({ entry, open: true })}
                    >
                      Delete forever
                    </Button>
                  </span>
                ) : null}
                <span className="w-20 shrink-0 text-right font-sans text-xs text-muted-foreground tabular-nums">
                  {trashLeftLabel(entry.deletedAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <DeleteForeverDialog
        entry={confirming?.entry ?? null}
        open={confirming?.open ?? false}
        onConfirm={(entry) => onDeleteForever({ kind: entry.kind, id: entry.id })}
        onClose={() => setConfirming((prev) => (prev ? { ...prev, open: false } : prev))}
      />
    </div>
  );
}

/** Delete forever asks first: it can't be undone. */
function DeleteForeverDialog({
  entry,
  open,
  onConfirm,
  onClose,
}: {
  /** Kept while the dialog closes, so its title doesn't blank mid-exit. */
  entry: TrashEntry | null;
  open: boolean;
  onConfirm: (entry: TrashEntry) => void;
  onClose: () => void;
}) {
  const name = entry ? (entry.kind === "bucket" ? entry.name : entry.title) : "";
  const what =
    entry?.kind === "bucket" && entry.deletedTasks > 0
      ? entry.deletedTasks === 1
        ? "It and the task deleted with it are"
        : `It and the ${entry.deletedTasks} tasks deleted with it are`
      : "It’s";
  return (
    <Dialog open={open && entry !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Delete “{name}” forever?</DialogTitle>
          <DialogDescription>
            {`${what} deleted now, files included. This can’t be undone.`}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (entry) onConfirm(entry);
              onClose();
            }}
          >
            Delete forever
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
