// The detail panel's header (tasks-v2 §9, comp §1): the bucket breadcrumb (a
// picker that moves the task), the queue toggle (it replaced the full-width
// "Commit to Queue" button, U3-3), copy link, and ⋯ (Duplicate, Won't do /
// Reopen, Delete). A subtask's breadcrumb goes on to its parent.

import {
  Ban,
  ChevronRight,
  Copy,
  Ellipsis,
  Inbox,
  Link2,
  ListChecks,
  Lock,
  RotateCcw,
  Trash2,
  Unlink,
} from "lucide-react";
import { useContext } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { IconButton } from "../../../components/ui/icon-button";
import { Kbd } from "../../../components/ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { taskHandle } from "../../../lib/task-handle";
import { taskUrl } from "../../../lib/web-origin";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { duplicateFields } from "../duplicate";
import { isUnfinished } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { type Bucket, PRIVATE_PROJECT_LABEL, type Task } from "../model";
import { alsoInLabel, claimLabel } from "../queue";
import { ClaimAvatar, useQueueClaim } from "./queue-toggle";

type Props = {
  task: Task;
  parent: Task | null;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  api: TasksModuleApi;
  onSelectTask: (id: string) => void;
};

export function TaskDetailHeader({
  task,
  parent,
  buckets,
  inbox,
  canEdit,
  api,
  onSelectTask,
}: Props) {
  const bucketOptions = inbox ? [inbox, ...buckets.filter((b) => b.id !== inbox.id)] : buckets;
  const bucket = bucketOptions.find((b) => b.id === task.bucketId) ?? null;
  // A project you can't see is never shown as Inbox (TV-P0, AC1.10).
  const bucketLabel = bucket?.name ?? PRIVATE_PROJECT_LABEL;
  const open = isUnfinished(task);
  // The handle, MOD-142 (TV-D8). Read without requiring the provider, so the
  // panel renders in isolation (stories, tests) without one.
  const taskKey = useContext(WorkspaceContext)?.selectedWorkspace?.taskKey ?? null;
  const handle = taskHandle(taskKey, task.number);

  const copyHandle = () => {
    if (!handle) return;
    if (!navigator.clipboard) {
      toast(`Couldn't copy ${handle}.`);
      return;
    }
    void navigator.clipboard
      .writeText(handle)
      .then(() => toast(`Copied ${handle}`))
      .catch(() => toast(`Couldn't copy ${handle}.`));
  };

  const copyLink = () => {
    if (!navigator.clipboard) {
      toast("Couldn't copy the link.");
      return;
    }
    void navigator.clipboard
      .writeText(taskUrl(task.id))
      .then(() => toast("Link copied"))
      .catch(() => toast("Couldn't copy the link."));
  };

  const duplicate = () => {
    const created = api.createTask(duplicateFields(task));
    for (const tag of api.tagsByTask.get(task.id) ?? []) api.createTagForTask(tag.name, created);
    void created.then((copy) => {
      if (!copy) return;
      onSelectTask(copy.id);
      toast("Task duplicated");
    });
  };

  return (
    <div className="flex min-h-(--ctrl-h) shrink-0 items-center gap-1">
      {/* Names wrap, never truncate (TV-P0, AC1.16). The breadcrumbs stay their
          own buttons on the state layer: a Button is one fixed-height line
          (DS-6 kept them for that reason). */}
      <nav aria-label="Location" className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!canEdit}>
            <button
              type="button"
              aria-label={`Project: ${bucketLabel}. Move to another project`}
              className="-ml-1.5 flex min-h-(--ctrl-h-sm) min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 py-0.5 font-sans text-xs text-muted-foreground outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50 aria-expanded:bg-state-active aria-expanded:text-foreground disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
            >
              {bucket?.isSystem ? (
                <Inbox className="size-icon-xs shrink-0" aria-hidden />
              ) : bucket ? (
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted-foreground/60" />
              ) : (
                <Lock className="size-icon-xs shrink-0" aria-hidden />
              )}
              <span className="min-w-0 break-words text-left">{bucketLabel}</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuRadioGroup
              value={task.bucketId}
              onValueChange={(v) => {
                if (v !== task.bucketId) api.patchTask(task.id, { bucketId: v });
              }}
            >
              {bucketOptions.map((b) => (
                <DropdownMenuRadioItem key={b.id} value={b.id}>
                  {b.isSystem ? <Inbox className="text-muted-foreground" aria-hidden /> : null}
                  {b.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {parent ? (
          <>
            <ChevronRight className="size-icon-xs shrink-0 text-muted-foreground/60" aria-hidden />
            <button
              type="button"
              onClick={() => onSelectTask(parent.id)}
              aria-label={`Parent task: ${parent.title || "Untitled"}`}
              className="flex min-h-(--ctrl-h-sm) min-w-0 shrink items-center rounded-md px-1.5 py-0.5 font-sans text-xs text-muted-foreground outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <span className="min-w-0 break-words text-left">{parent.title || "Untitled"}</span>
            </button>
          </>
        ) : null}
        {handle ? (
          <>
            <ChevronRight className="size-icon-xs shrink-0 text-muted-foreground/60" aria-hidden />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={copyHandle}
                  aria-label={`Copy ${handle}`}
                  className="flex min-h-(--ctrl-h-sm) shrink-0 items-center whitespace-nowrap rounded-md px-1.5 py-0.5 font-sans text-xs tabular-nums text-muted-foreground outline-none transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  {handle}
                </button>
              </TooltipTrigger>
              <TooltipContent>Copy {handle}</TooltipContent>
            </Tooltip>
          </>
        ) : null}
      </nav>

      {open ? <QueueButton task={task} api={api} canEdit={canEdit} /> : null}
      <IconButton icon={Link2} label="Copy link" onClick={copyLink} />
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton icon={Ellipsis} label="More actions" tooltip={null} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={duplicate}>
              <Copy aria-hidden />
              Duplicate
            </DropdownMenuItem>
            {parent ? (
              <DropdownMenuItem onSelect={() => api.setTaskParent(task.id, null)}>
                <Unlink aria-hidden />
                Detach from parent
              </DropdownMenuItem>
            ) : null}
            {task.status === "archived" ? (
              <DropdownMenuItem onSelect={() => api.patchTask(task.id, { status: "todo" })}>
                <RotateCcw aria-hidden />
                Reopen
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => api.archiveTask(task.id)}>
                <Ban aria-hidden />
                Won’t do
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => api.deleteTask(task.id)}>
              <Trash2 aria-hidden />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}

/**
 * My queue toggle (TV-D4), plus who else has the task lined up: their ringed
 * avatar beside it, named in the tooltip ("In Mike's queue"). View-only members
 * see the state without the action.
 */
function QueueButton({
  task,
  api,
  canEdit,
}: {
  task: Task;
  api: TasksModuleApi;
  canEdit: boolean;
}) {
  const queued = api.queuedTaskIds.has(task.id);
  const claim = useQueueClaim(task.id, api);
  const claimed = claim.names.length > 0;
  const note = claimed ? (queued ? alsoInLabel(claim.names) : claimLabel(claim.names)) : null;
  const claimMark = claimed ? (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          role="img"
          aria-label={note ?? undefined}
          className="flex shrink-0 items-center px-0.5"
        >
          <ClaimAvatar assignee={claim.first} size="icon" />
        </span>
      </TooltipTrigger>
      <TooltipContent>{note}</TooltipContent>
    </Tooltip>
  ) : null;

  if (!canEdit) {
    if (!queued) return claimMark;
    return (
      <>
        {claimMark}
        <span className="flex h-(--ctrl-h-sm) shrink-0 items-center gap-1.5 px-1.5 font-sans text-xs text-muted-foreground">
          <ListChecks className="size-icon-sm text-primary" aria-hidden />
          In queue
        </span>
      </>
    );
  }

  const action = queued ? "Remove from queue" : "Add to queue";
  return (
    <>
      {claimMark}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant={queued ? "secondary" : "ghost"}
            size="sm"
            // Named by its visible text ("Queue" / "In queue") with the pressed
            // state; the action and any claim are in the tooltip and the avatar.
            aria-pressed={queued}
            onClick={() => api.toggleQueue(task.id)}
            className="shrink-0 px-2"
          >
            <ListChecks className={queued ? "text-primary" : "text-muted-foreground"} aria-hidden />
            {queued ? "In queue" : "Queue"}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {action} <Kbd>Q</Kbd>
        </TooltipContent>
      </Tooltip>
    </>
  );
}
