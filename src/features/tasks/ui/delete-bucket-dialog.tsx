// The confirms a project's ⋯ opens (TV-U6, REPLAN 78): Delete project… and
// Archive… when it still has open work ("4 open tasks — Won't do · Move ·
// Keep"). Both need Full access to the project; each asks the server first
// and says so when you don't have it, instead of offering a button that fails.

import { useEffect, useState } from "react";

import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import type { ArchiveOpenTasks } from "../hooks/use-tasks-module";
import type { Bucket } from "../model";
import type { ProjectDeleteSummary } from "../sidebar";

const tasksWord = (n: number) => (n === 1 ? "1 task" : `${n} tasks`);

/**
 * What the delete confirm says (REPLAN 78): where the open work goes, that the
 * finished work goes with the project, and that it can come back.
 */
export function projectDeleteLines(summary: ProjectDeleteSummary): string[] {
  const { moving, toYou, finished } = summary;
  const lines: string[] = [];
  if (moving === 0 && finished === 0) return ["It has no tasks."];
  if (moving > 0) {
    const open = moving === 1 ? "Its open task goes" : `Its ${moving} open tasks go`;
    if (toYou === moving) lines.push(`${open} to your Inbox.`);
    else if (toYou === 0)
      lines.push(`${open} to ${moving === 1 ? "its assignee’s" : "their assignees’"} Inbox.`);
    else lines.push(`${open} to their assignees’ Inboxes (${tasksWord(toYou)} to yours).`);
  }
  if (finished > 0) {
    lines.push(
      finished === 1
        ? "Its finished task goes with it to Recently deleted."
        : `Its ${finished} finished tasks go with it to Recently deleted.`,
    );
  }
  return lines;
}

/** Whether you may delete or archive `bucket`: asked when a confirm opens. */
function useCanManage(
  bucket: Bucket | null,
  open: boolean,
  checkAccess: ((projectId: string) => Promise<boolean>) | undefined,
): boolean | null {
  const [canManage, setCanManage] = useState<boolean | null>(null);
  const id = bucket?.id ?? null;
  useEffect(() => {
    if (!open || !id) return;
    if (!checkAccess) {
      setCanManage(true);
      return;
    }
    let live = true;
    setCanManage(null);
    checkAccess(id)
      .then((ok) => live && setCanManage(ok))
      // Unknown: let the server decide (it refuses with a clear message).
      .catch(() => live && setCanManage(true));
    return () => {
      live = false;
    };
  }, [open, id, checkAccess]);
  return canManage;
}

const NO_ACCESS = (name: string, verb: string) =>
  `Only people with full access to “${name}” can ${verb} it.`;

/**
 * Asks before a project is deleted (REPLAN 78, replacing tasks-v2's "Move to
 * Inbox / Delete the tasks too" choice): names it, says where its tasks go,
 * and that Undo and Recently deleted bring it back for 30 days.
 */
export function DeleteBucketDialog({
  bucket,
  open,
  summary,
  checkAccess,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: {
  /** Kept while the dialog closes, so its title doesn't blank mid-exit. */
  bucket: Bucket | null;
  open: boolean;
  summary: ProjectDeleteSummary;
  /** Whether you have Full access (absent: assume yes, the server decides). */
  checkAccess?: (projectId: string) => Promise<boolean>;
  onConfirm: (bucket: Bucket) => void;
  onClose: () => void;
  /** Where focus goes on close: the dialog has no trigger to return to (the sidebar). */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const canManage = useCanManage(bucket, open, checkAccess);
  const name = bucket?.name ?? "";
  return (
    <Dialog open={open && bucket !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Delete “{name}”?</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-1">
              {canManage === false ? (
                <span>{NO_ACCESS(name, "delete")}</span>
              ) : (
                projectDeleteLines(summary).map((line) => <span key={line}>{line}</span>)
              )}
            </div>
          </DialogDescription>
        </DialogHeader>
        {canManage === false ? null : (
          <p className="font-sans text-xs text-muted-foreground">
            Each assignee gets one quiet notice. Restore it from Recently deleted within 30 days.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {canManage === false ? "Close" : "Cancel"}
          </Button>
          {canManage === false ? null : (
            <Button
              variant="destructive"
              disabled={canManage === null}
              onClick={() => {
                if (bucket) onConfirm(bucket);
                onClose();
              }}
            >
              Delete project
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Asks before archiving a project that still has open work (REPLAN 78): "4 open
 * tasks — Won't do · Move · Keep". Won't do marks each open task; Move sends
 * them (with their subtasks) to a project you pick; Keep leaves them open in
 * the archived project. A project with nothing open archives without asking.
 */
export function ArchiveProjectDialog({
  bucket,
  open,
  openCount,
  projects,
  checkAccess,
  onConfirm,
  onClose,
  onCloseAutoFocus,
}: {
  bucket: Bucket | null;
  open: boolean;
  /** Open tasks in it (Backlog too: everything not finished). */
  openCount: number;
  /** Where Move can send them: the other live projects. */
  projects: Bucket[];
  checkAccess?: (projectId: string) => Promise<boolean>;
  onConfirm: (bucket: Bucket, openTasks: ArchiveOpenTasks) => void;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const canManage = useCanManage(bucket, open, checkAccess);
  const [moving, setMoving] = useState(false);
  const [target, setTarget] = useState<string>("");
  useEffect(() => {
    if (open) {
      setMoving(false);
      setTarget("");
    }
  }, [open]);
  const name = bucket?.name ?? "";
  const others = projects.filter((p) => p.id !== bucket?.id && !p.isSystem);
  const choose = (openTasks: ArchiveOpenTasks) => {
    if (bucket) onConfirm(bucket, openTasks);
    onClose();
  };
  return (
    <Dialog open={open && bucket !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Archive “{name}”?</DialogTitle>
          <DialogDescription>
            {canManage === false
              ? NO_ACCESS(name, "archive")
              : `${openCount === 1 ? "1 open task" : `${openCount} open tasks`} — Won’t do · Move · Keep`}
          </DialogDescription>
        </DialogHeader>
        {canManage === false ? null : (
          <p className="font-sans text-xs text-muted-foreground">
            Archived projects leave the sidebar and never remind; search still finds their tasks.
          </p>
        )}
        {canManage !== false && moving ? (
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger aria-label="Move them to" size="sm">
              <SelectValue placeholder="Move them to…" />
            </SelectTrigger>
            <SelectContent>
              {others.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            {canManage === false ? "Close" : "Cancel"}
          </Button>
          {canManage === false ? null : moving ? (
            <Button disabled={!target} onClick={() => choose({ kind: "move", projectId: target })}>
              Move and archive
            </Button>
          ) : (
            <>
              <Button
                variant="secondary"
                disabled={canManage === null}
                onClick={() => choose({ kind: "wont_do" })}
              >
                Won’t do
              </Button>
              <Button
                variant="secondary"
                disabled={canManage === null || others.length === 0}
                onClick={() => setMoving(true)}
              >
                Move…
              </Button>
              <Button disabled={canManage === null} onClick={() => choose({ kind: "keep" })}>
                Keep
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
