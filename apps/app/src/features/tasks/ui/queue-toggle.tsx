import { isClosedTask } from "@contracts/vocabularies";
import { ListChecks } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { onThisLabel, useTaskClaim } from "../../focus/claims";
import { type Assignee, useAssignees } from "../assignees";
import type { Task } from "../model";
import { alsoInLabel, claimLabel } from "../queue";
import { AssigneeAvatar } from "./assignee-avatar";

type ClaimNames = { names: string[]; first: Assignee | null };

function namesOf(byId: (id: string) => Assignee | null, ids: readonly string[]): ClaimNames {
  return {
    names: ids.map((id) => byId(id)?.name || "a teammate"),
    first: ids.length > 0 ? byId(ids[0]) : null,
  };
}

/** The names behind a task's claims (user ids, earliest first). */
export function useClaimNames(ids: readonly string[]): ClaimNames {
  const { byId } = useAssignees();
  return namesOf(byId, ids);
}

/**
 * The small ringed avatar that marks a task in someone else's Focus. `live`
 * adds the quiet dot of "<name> is on this" (TV-F7): their session is on it.
 */
export function ClaimAvatar({
  assignee,
  size = "sm",
  live = false,
  className,
}: {
  assignee: Assignee | null;
  /** `icon` on rows, cards and the panel header, where it sits with icons. */
  size?: "sm" | "icon";
  live?: boolean;
  className?: string;
}) {
  const avatar = (
    <AssigneeAvatar
      assignee={assignee}
      size={size}
      className={cn("ring-1 ring-foreground/35", className)}
    />
  );
  if (!live) return avatar;
  return (
    <span className="relative flex shrink-0" data-slot="claim-live">
      {avatar}
      <span
        aria-hidden
        className="absolute -right-0.5 -bottom-0.5 size-1.5 rounded-full bg-muted-foreground ring-1 ring-background"
      />
    </span>
  );
}

/**
 * Who has the task in their Focus, minus the people whose Focus session is on
 * it right now: those show once, as "<name> is on this", never also as a
 * Focus claim (TV-F7: one avatar per person).
 */
export function withoutPeopleOnIt(
  queueClaims: readonly string[],
  onIt: readonly string[],
): readonly string[] {
  if (onIt.length === 0 || queueClaims.length === 0) return queueClaims;
  const left = queueClaims.filter((id) => !onIt.includes(id));
  return left.length === queueClaims.length ? queueClaims : left;
}

/**
 * Who's on a task and who else has it in their Focus, for one mark: the people
 * on it right now first (their avatar carries the live dot), then the claims
 * of everyone else, each person once (TV-F7).
 */
export function useFocusMarks(
  task: Pick<Task, "id" | "workspaceId">,
  claims: readonly string[],
): {
  /** The avatar the mark shows: someone on it, else the first claim. */
  lead: Assignee | null;
  live: boolean;
  /** "Mike is on this. In Ola's Focus" (empty when nobody). */
  note: string;
  /** Anyone besides me: on it or with it in their Focus. */
  any: boolean;
  /** The claim part alone, for "Also in Ola's Focus" once it's in mine. */
  claimNames: string[];
  onItNames: string[];
} {
  const onIt = useTaskClaim(task.workspaceId, task.id);
  const { byId } = useAssignees();
  const on = namesOf(byId, onIt);
  const claim = namesOf(byId, withoutPeopleOnIt(claims, onIt));
  const live = on.names.length > 0;
  return {
    lead: live ? on.first : claim.first,
    live,
    note: [onThisLabel(on.names), claimLabel(claim.names)].filter(Boolean).join(". "),
    any: live || claim.names.length > 0,
    claimNames: claim.names,
    onItNames: on.names,
  };
}

/**
 * The Focus mark on a row or card (call 61: the Queue is called Focus): my
 * toggle (accent when it's in my Focus), or, when someone else has the task in
 * theirs and I don't, their ringed avatar ("In Mike's Focus"), which still
 * adds it to mine on click. When we both have it, their avatar sits beside my
 * toggle. A teammate whose Focus session is on it right now takes that avatar
 * with a quiet live dot ("Mike is on this", TV-F7), never a second one: the
 * cell keeps its width. View-only members see the marks without the action.
 * Done and Won't do tasks get no mark.
 */
export function QueueToggle({
  task,
  queued,
  claims,
  onToggle,
  canEdit,
  revealOnHover = false,
}: {
  task: Task;
  /** In my Focus (the row's facts, TV-D11b). */
  queued: boolean;
  /** Who else has it in their Focus (user ids, earliest first). */
  claims: readonly string[];
  onToggle: (taskId: string) => void;
  canEdit: boolean;
  /**
   * List rows (TV-U1, the comp): my plain toggle stays invisible until the row
   * is hovered, selected or the toggle is focused. It keeps its space and
   * fades (R6). A queued or claimed mark always shows.
   */
  revealOnHover?: boolean;
}) {
  const marks = useFocusMarks(task, claims);
  const claimed = marks.any;
  const showClaim = claimed && !queued;
  // Backlog can be queued: it moves to To do (TV-D9).
  if (isClosedTask(task)) return null;
  // Both of us: their avatar stays visible next to my toggle (the toggle's
  // label already names them, so the avatar is decoration).
  const besideClaim =
    claimed && queued ? (
      <span aria-hidden className="flex items-center">
        <ClaimAvatar assignee={marks.lead} size="icon" live={marks.live} />
      </span>
    ) : null;

  const mark = showClaim ? (
    <ClaimAvatar assignee={marks.lead} size="icon" live={marks.live} />
  ) : (
    <ListChecks className="size-icon-sm" aria-hidden />
  );
  // Once it's in mine: "Mike is on this. Also in Ola's Focus".
  const inMineNote = [onThisLabel(marks.onItNames), alsoInLabel(marks.claimNames)]
    .filter(Boolean)
    .join(". ");

  if (!canEdit) {
    if (!queued && !claimed) return null;
    const label = queued
      ? inMineNote
        ? `In your Focus. ${inMineNote}`
        : "In your Focus"
      : marks.note;
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

  const action = queued ? "Remove from Focus" : "Add to Focus";
  const note = queued ? inMineNote : marks.note;
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
              onToggle(task.id);
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
              {queued ? action : "Add to your Focus"}
            </>
          ) : (
            action
          )}
        </TooltipContent>
      </Tooltip>
    </>
  );
}
