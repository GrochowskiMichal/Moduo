import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { Bucket } from "../model";

/**
 * What the confirm says about the bucket's tasks (tasks-v2 Q1-4). The count is
 * every task the bucket's list shows; the rail counts only open ones, so the
 * open share is named whenever the two differ.
 */
export function bucketTasksLine(taskCount: number, openCount: number): string {
  if (taskCount === 0) return "It has no tasks.";
  const tasks = taskCount === 1 ? "1 task" : `${taskCount} tasks`;
  const open =
    openCount === taskCount
      ? ""
      : openCount === 0
        ? taskCount === 1
          ? " (done)"
          : " (all done)"
        : ` (${openCount} open)`;
  return `It has ${tasks}${open}, which will move to Inbox.`;
}

/**
 * Asks before a bucket is deleted (tasks-v2 Q1-4): names it and says where its
 * tasks go. The Undo toast that follows comes from `deleteBucket`. "Delete the
 * tasks too" joins as a second choice together with Recently deleted (TV-U6).
 */
export function DeleteBucketDialog({
  bucket,
  open,
  taskCount,
  openCount,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: {
  /** Kept while the dialog closes, so its title doesn't blank mid-exit. */
  bucket: Bucket | null;
  open: boolean;
  /** The tasks the bucket's own list shows (open + done). */
  taskCount: number;
  /** Of those, the open ones — the number the rail shows. */
  openCount: number;
  onConfirm: (bucket: Bucket) => void;
  onClose: () => void;
  /** Where focus goes on close: the dialog has no trigger to return to (the rail). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  return (
    <Dialog open={open && bucket !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Delete “{bucket?.name}”?</DialogTitle>
          <DialogDescription>{bucketTasksLine(taskCount, openCount)}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (bucket) onConfirm(bucket);
              onClose();
            }}
          >
            Delete bucket
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
