import { ListChecks } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { LiveDot } from "../../focus/ui/live-dot";
import { type Assignee, useAssignees } from "../assignees";
import { onThisLabel, useRunClaims } from "../claims";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task } from "../model";
import { alsoInLabel, claimLabel } from "../queue";
import { AssigneeAvatar } from "./assignee-avatar";

/**
 * Who else has a task queued, as names and the first of them (claims, TV-D4),
 * and who is on it right now in a running run (`onThis`, TV-F2). Empty when
 * nobody else is.
 */
export function useQueueClaim(
  taskId: string,
  api: Pick<TasksModuleApi, "queueClaims">,
  workspaceId?: string | null,
): { names: string[]; first: Assignee | null; onThis: string[]; onThisFirst: Assignee | null } {
  const { byId } = useAssignees();
  const ids = api.queueClaims.get(taskId) ?? [];
  const onIds = useRunClaims(workspaceId).get(taskId) ?? [];
  return {
    names: ids.map((id) => byId(id)?.name || "a teammate"),
    first: ids.length > 0 ? byId(ids[0]) : null,
    onThis: onIds.map((id) => byId(id)?.name || "A teammate"),
    onThisFirst: onIds.length > 0 ? byId(onIds[0]) : null,
  };
}

/** The small ringed avatar that marks a task in someone else's queue; with
 *  `live`, they're on it right now (a live dot at its corner). */
export function ClaimAvatar({
  assignee,
  live = false,
  className,
}: {
  assignee: Assignee | null;
  live?: boolean;
  className?: string;
}) {
  const avatar = (
    <AssigneeAvatar
      assignee={assignee}
      className={cn("size-4 ring-1 ring-foreground/35", className)}
    />
  );
  if (!live) return avatar;
  return (
    <span className="relative inline-flex">
      {avatar}
      <LiveDot className="absolute -right-0.5 -bottom-0.5" />
    </span>
  );
}

/**
 * The queue mark on a row or card: my queue toggle (accent when queued), or,
 * when someone else has the task queued and I don't, their ringed avatar ("In
 * Mike's queue"), which still adds it to mine on click. When we both have it,
 * their avatar sits beside my toggle. View-only members see the marks without
 * the action. Done and archived tasks can't be queued, so they get no mark.
 */
export function QueueToggle({
  task,
  api,
  canEdit,
}: {
  task: Task;
  api: Pick<TasksModuleApi, "queuedTaskIds" | "queueClaims" | "toggleQueue">;
  canEdit: boolean;
}) {
  const queued = api.queuedTaskIds.has(task.id);
  const claim = useQueueClaim(task.id, api, task.workspaceId);
  // Someone running it right now outranks "in their queue" (TV-F2).
  const live = claim.onThis.length > 0;
  const claimed = claim.names.length > 0 || live;
  const showClaim = claimed && !queued;
  const face = live ? claim.onThisFirst : claim.first;
  const claimText = live ? onThisLabel(claim.onThis) : claimLabel(claim.names);
  const alsoText = live ? onThisLabel(claim.onThis) : alsoInLabel(claim.names);
  if (task.status === "done" || task.status === "archived") return null;
  // Both of us: their claim stays visible next to my toggle (the toggle's
  // label already says "Also in Mike's queue", so the avatar is decoration).
  const besideClaim =
    claimed && queued ? (
      <span aria-hidden className="flex items-center">
        <ClaimAvatar assignee={face} live={live} />
      </span>
    ) : null;

  const mark = showClaim ? (
    <ClaimAvatar assignee={face} live={live} />
  ) : (
    <ListChecks className="size-3.5" aria-hidden />
  );

  if (!canEdit) {
    if (!queued && !claimed) return null;
    const label = queued
      ? claimed
        ? `In your queue. ${alsoText}`
        : "In your queue"
      : claimText;
    return (
      <>
        {besideClaim}
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              role="img"
              className={cn("flex items-center", queued && "text-primary")}
              aria-label={label}
            >
              {mark}
            </span>
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
      </>
    );
  }

  const action = queued ? "Remove from queue" : "Add to queue";
  const note = queued ? alsoText : claimText;
  return (
    <>
      {besideClaim}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={note ? `${action}. ${note}` : action}
            aria-pressed={queued}
            onClick={(e) => {
              e.stopPropagation();
              api.toggleQueue(task.id);
            }}
            className={cn(
              "flex size-icon items-center justify-center rounded transition-colors duration-(--motion-fade) ease-(--ease-out)",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              queued
                ? "text-primary"
                : showClaim
                  ? "text-muted-foreground"
                  : "text-muted-foreground/40 hover:text-foreground",
            )}
          >
            {mark}
          </button>
        </TooltipTrigger>
        <TooltipContent>
          {note ? (
            <>
              {note}
              <br />
              {queued ? action : "Add to your queue"}
            </>
          ) : (
            action
          )}
        </TooltipContent>
      </Tooltip>
    </>
  );
}
