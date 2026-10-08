import { CircleDashed, ListChecks } from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import type { Task } from "../model";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The blocked task the user just tried to queue. */
  task: Task | null;
  /** Its unblocked frontier — "what's actually next" (spec §5c). */
  frontier: Task[];
  bucketNameById: (id: string) => string;
  /** Queue a frontier task instead (it is unblocked — goes straight through). */
  onQueueTask: (id: string) => void;
  /** The escape hatch — queue the blocked task as asked (never a wall). */
  onQueueAnyway: () => void;
};

/**
 * Offered when queuing a blocked task (spec §5c): list the unblocked
 * frontier so the user can start with what actually unblocks the work — with
 * "Queue anyway" as a first-class escape hatch (mirrors, never walls;
 * principle 5). Quiet and factual; removing from the queue never lands here.
 */
export function FrontierOfferDialog({
  open,
  onOpenChange,
  task,
  frontier,
  bucketNameById,
  onQueueTask,
  onQueueAnyway,
}: Props) {
  if (!task) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CircleDashed className="size-4 text-muted-foreground" aria-hidden />
            Blocked by {frontier.length === 1 ? "another task" : "other tasks"}
          </DialogTitle>
          <DialogDescription>
            “{task.title || "Untitled"}” is waiting on{" "}
            {frontier.length === 1 ? "an open task" : `${frontier.length} open tasks`}. Start with
            what unblocks it?
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {frontier.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/60"
            >
              <span className="min-w-0 flex-1 truncate font-sans text-sm text-foreground">
                {t.title || "Untitled"}
              </span>
              <span className="shrink-0 font-sans text-xs text-muted-foreground">
                {bucketNameById(t.bucketId)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                className="shrink-0"
                onClick={() => {
                  onQueueTask(t.id);
                  onOpenChange(false);
                }}
              >
                <ListChecks aria-hidden />
                Queue
              </Button>
            </div>
          ))}
        </div>

        <DialogFooter className="sm:justify-between">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onQueueAnyway();
              onOpenChange(false);
            }}
          >
            Queue anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
