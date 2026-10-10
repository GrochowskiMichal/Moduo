// The detail panel's header (tasks-v2 §9, comp §1): the bucket breadcrumb (a
// picker that moves the task), the queue toggle (it replaced the full-width
// "Commit to Queue" button, U3-3), copy link, and ⋯ (Duplicate, Archive · won't
// do, Delete). A subtask's breadcrumb goes on to its parent.

import {
  Archive,
  ChevronRight,
  Copy,
  Ellipsis,
  Inbox,
  Link2,
  ListChecks,
  RotateCcw,
  Trash2,
  Unlink,
} from "lucide-react";
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
import { taskUrl } from "../../../lib/web-origin";
import { duplicateFields } from "../duplicate";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task } from "../model";
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
  const open = task.status !== "done" && task.status !== "archived";

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
    <div className="flex h-(--ctrl-h) shrink-0 items-center gap-1">
      <nav aria-label="Location" className="flex min-w-0 flex-1 items-center gap-0.5">
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!canEdit}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Bucket: ${bucket?.name ?? "Inbox"}. Move to another bucket`}
              // Content, not chrome: the body face at the meta size. A
              // view-only member sees it at full strength, just not clickable.
              className="-ml-1.5 min-w-0 shrink px-1.5 font-sans text-xs font-normal text-muted-foreground hover:text-foreground aria-expanded:bg-state-active aria-expanded:text-foreground disabled:opacity-100"
            >
              {bucket?.isSystem ? (
                <Inbox className="size-icon-xs shrink-0" aria-hidden />
              ) : (
                <span aria-hidden className="size-2 shrink-0 rounded-full bg-muted-foreground/60" />
              )}
              <span className="truncate">{bucket?.name ?? "Inbox"}</span>
            </Button>
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
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSelectTask(parent.id)}
              aria-label={`Parent task: ${parent.title || "Untitled"}`}
              className="min-w-0 shrink px-1.5 font-sans text-xs font-normal text-muted-foreground hover:text-foreground"
            >
              <span className="truncate">{parent.title || "Untitled"}</span>
            </Button>
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
                <Archive aria-hidden />
                Archive · won’t do
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
