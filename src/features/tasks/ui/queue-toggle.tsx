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
    names: ids.map((id) => byId(id)?.name ?? "a teammate"),
    first: ids.length > 0 ? byId(ids[0]) : null,
  };
}

/** The small ringed avatar that marks a task in someone else's queue. */
export function ClaimAvatar({
  assignee,
  className,
}: {
  assignee: Assignee | null;
  className?: string;
}) {
  return (
    <AssigneeAvatar
      assignee={assignee}
      className={cn("size-4 ring-1 ring-foreground/35 ring-offset-1 ring-offset-card", className)}
    />
  );
}

/**
 * The queue mark on a row or card: my queue toggle (accent when queued), or,
 * when someone else has the task queued and I don't, their ringed avatar ("In
 * Mike's queue"), which still adds it to mine on click. View-only members see
 * the marks without the action.
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
  const claim = useQueueClaim(task.id, api);
  const claimed = claim.names.length > 0;
  const showClaim = claimed && !queued;

  const mark = showClaim ? (
    <ClaimAvatar assignee={claim.first} />
  ) : (
    <ListChecks className="size-3.5" aria-hidden />
  );

  if (!canEdit) {
    if (!queued && !claimed) return null;
    const label = queued ? "In your queue" : claimLabel(claim.names);
    return (
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
    );
  }

  const action = queued ? "Remove from queue" : "Add to queue";
  const note = queued ? alsoInLabel(claim.names) : claimLabel(claim.names);
  return (
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
  );
}
