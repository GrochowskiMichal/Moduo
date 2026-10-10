import { ListChecks } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { type Assignee, useAssignees } from "../assignees";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task } from "../model";
import { alsoInLabel, claimLabel } from "../queue";
import { AssigneeAvatar } from "./assignee-avatar";

/**
 * Who else has a task queued, as names and the first of them (claims, TV-D4).
 * Empty when nobody else does.
 */
export function useQueueClaim(
  taskId: string,
  api: Pick<TasksModuleApi, "queueClaims">,
): { names: string[]; first: Assignee | null } {
  const { byId } = useAssignees();
  const ids = api.queueClaims.get(taskId) ?? [];
  return {
    names: ids.map((id) => byId(id)?.name || "a teammate"),
    first: ids.length > 0 ? byId(ids[0]) : null,
  };
}

/** The small ringed avatar that marks a task in someone else's queue. */
export function ClaimAvatar({
  assignee,
  size = "sm",
  className,
}: {
  assignee: Assignee | null;
  /** `icon` on rows, cards and the panel header, where it sits with icons. */
  size?: "sm" | "icon";
  className?: string;
}) {
  return (
    <AssigneeAvatar
      assignee={assignee}
      size={size}
      className={cn("ring-1 ring-foreground/35", className)}
    />
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
  revealOnHover = false,
}: {
  task: Task;
  api: Pick<TasksModuleApi, "queuedTaskIds" | "queueClaims" | "toggleQueue">;
  canEdit: boolean;
  /**
   * List rows (TV-U1, the comp): my plain toggle stays invisible until the row
   * is hovered, selected or the toggle is focused. It keeps its space and
   * fades (R6). A queued or claimed mark always shows.
   */
  revealOnHover?: boolean;
}) {
  const queued = api.queuedTaskIds.has(task.id);
  const claim = useQueueClaim(task.id, api);
  const claimed = claim.names.length > 0;
  const showClaim = claimed && !queued;
  if (task.status === "done" || task.status === "archived") return null;
  // Both of us: their claim stays visible next to my toggle (the toggle's
  // label already says "Also in Mike's queue", so the avatar is decoration).
  const besideClaim =
    claimed && queued ? (
      <span aria-hidden className="flex items-center">
        <ClaimAvatar assignee={claim.first} size="icon" />
      </span>
    ) : null;

  const mark = showClaim ? (
    <ClaimAvatar assignee={claim.first} size="icon" />
  ) : (
    <ListChecks className="size-icon-sm" aria-hidden />
  );

  if (!canEdit) {
    if (!queued && !claimed) return null;
    const label = queued
      ? claimed
        ? `In your queue. ${alsoInLabel(claim.names)}`
        : "In your queue"
      : claimLabel(claim.names);
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
  const note = queued ? alsoInLabel(claim.names) : claimLabel(claim.names);
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
              // hit-min pads the pointer target to 24 px; the glyph stays put.
              "hit-min flex size-icon items-center justify-center rounded transition-[color,opacity] duration-(--motion-fade) ease-(--ease-out)",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              queued
                ? "text-primary"
                : showClaim
                  ? "text-muted-foreground"
                  : "text-muted-foreground/40 hover:text-foreground",
              revealOnHover &&
                !queued &&
                !claimed &&
                "opacity-0 group-hover:opacity-100 group-aria-selected:opacity-100 focus-visible:opacity-100",
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
