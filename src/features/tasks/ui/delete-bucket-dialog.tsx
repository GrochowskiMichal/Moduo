import { useEffect, useId, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Label } from "../../../components/ui/label";
import { RadioGroup, RadioGroupItem } from "../../../components/ui/radio-group";
import type { Bucket } from "../model";

/**
 * What the confirm says about the bucket's tasks (tasks-v2 Q1-4). The count is
 * every task the bucket's list shows; the rail counts only open ones, so the
 * open share is named whenever the two differ. Where they go is the choice
 * below it (TV-U6).
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
  return `It has ${tasks}${open}.`;
}

/** The two choices' labels: "Move the 12 tasks to Inbox" / "Delete the 12 tasks too". */
export function bucketTaskChoices(taskCount: number): { move: string; delete: string } {
  const the = taskCount === 1 ? "the task" : `the ${taskCount} tasks`;
  return { move: `Move ${the} to Inbox`, delete: `Delete ${the} too` };
}

/**
 * Asks before a bucket is deleted (tasks-v2 §11, Q1-4, TV-U6): names it, counts
 * its tasks, and asks where they go: to Inbox (the default) or into the trash
 * with the bucket. Either way the Undo toast that follows, and Recently
 * deleted for 30 days, bring everything back.
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
  onConfirm: (bucket: Bucket, withTasks: boolean) => void;
  onClose: () => void;
  /** Where focus goes on close: the dialog has no trigger to return to (the rail). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [choice, setChoice] = useState<"move" | "delete">("move");
  const ids = useId();
  // Every confirm starts on the safe default.
  useEffect(() => {
    if (open) setChoice("move");
  }, [open]);
  const labels = bucketTaskChoices(taskCount);

  return (
    <Dialog open={open && bucket !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Delete “{bucket?.name}”?</DialogTitle>
          <DialogDescription>{bucketTasksLine(taskCount, openCount)}</DialogDescription>
        </DialogHeader>
        {taskCount > 0 ? (
          <RadioGroup
            aria-label="Its tasks"
            value={choice}
            onValueChange={(value) => setChoice(value === "delete" ? "delete" : "move")}
            className="gap-2"
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem value="move" id={`${ids}-move`} />
              <Label htmlFor={`${ids}-move`} className="font-normal">
                {labels.move}
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <RadioGroupItem value="delete" id={`${ids}-delete`} />
              <Label htmlFor={`${ids}-delete`} className="font-normal">
                {labels.delete}
              </Label>
            </div>
          </RadioGroup>
        ) : null}
        <p className="font-sans text-xs text-muted-foreground">
          You can restore it from Recently deleted for 30 days.
        </p>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (bucket) onConfirm(bucket, taskCount > 0 && choice === "delete");
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
