// A List group header's "+" (tasks-v3 §4, default n, TV-U10): it stays
// visible and adds at the top of the group with the group's value filled in.
// The app's one capture does the adding (U14-1); this says what to open it
// with, or why there's no "+" here. Pure: no React, no IO.

import type { PriorityLevel, TaskStatusCategory } from "@contracts/vocabularies";
import { DATE_GROUPS, type DateGroup, type GroupBy, isProjectScope } from "./helpers";
import { type StatusKey, statusKeyCategory } from "./statuses";

/** What the capture opens with for a group (on top of the view's own "here"). */
export type GroupAdd = {
  /** The project it files into; absent: the view's own (a project) or your Inbox. */
  projectId?: string;
  /** Its section (Section groups); null: No section. */
  sectionId?: string | null;
  seed?: {
    assigneeId?: string | null;
    priority?: PriorityLevel | null;
    teamId?: string | null;
    /** YYYY-MM-DD. */
    dueDay?: string | null;
    status?: TaskStatusCategory | null;
  };
};

export type GroupAddState =
  | { kind: "add"; add: GroupAdd }
  /** Shown but off, with the reason as its tooltip. */
  | { kind: "disabled"; reason: string }
  /** No "+" on this header. */
  | { kind: "none" };

const NONE: GroupAddState = { kind: "none" };

/**
 * The "+" of one group. Rules:
 * - read-only views and ungrouped lists have none;
 * - a new task must land where you're looking: All shows no Inbox, so its
 *   groups other than projects say "Pick a project first" (the spec's rule
 *   for a cross-project board); Upcoming adds only in its days;
 * - Earlier adds nothing (a new task isn't late), Later and No date add with
 *   no date;
 * - My tasks and the Inbox add to your Inbox (assigned to you), a project to
 *   itself.
 */
export function groupAddState(input: {
  scope: string;
  groupBy: GroupBy;
  key: string;
  canEdit: boolean;
  /** Today's local date key ("2026-10-13"): Date groups count from it. */
  today: string;
  inboxId: string | null;
}): GroupAddState {
  const { scope, groupBy, key, canEdit, today, inboxId } = input;
  if (!canEdit || groupBy === "none" || scope === "today") return NONE;
  if (scope === "upcoming" && groupBy !== "date") return NONE;

  const project = isProjectScope(scope) && scope !== inboxId ? scope : undefined;
  if (groupBy === "bucket") {
    // The Inbox's own group adds to your Inbox (the capture's default).
    return { kind: "add", add: key === inboxId ? {} : { projectId: key } };
  }
  if (scope === "all") return { kind: "disabled", reason: "Pick a project first" };

  const base: GroupAdd = project ? { projectId: project } : {};
  switch (groupBy) {
    case "section":
      return { kind: "add", add: { ...base, sectionId: key === NO_KEY ? null : key } };
    case "status":
      return {
        kind: "add",
        add: { ...base, seed: { status: statusKeyCategory(key as StatusKey) } },
      };
    case "priority":
      return {
        kind: "add",
        add: { ...base, seed: { priority: key === "unset" ? null : (key as PriorityLevel) } },
      };
    case "assignee":
      return { kind: "add", add: { ...base, seed: { assigneeId: key === NO_KEY ? null : key } } };
    case "team":
      return { kind: "add", add: { ...base, seed: { teamId: key === NO_KEY ? null : key } } };
    case "date": {
      if (key === "earlier") return NONE;
      const day = dateGroupDay(key as DateGroup, today);
      return { kind: "add", add: day ? { ...base, seed: { dueDay: day } } : base };
    }
    default:
      return NONE;
  }
}

/** The "no value" key of the assignee, team and section groupings (`groupKeyFor`). */
const NO_KEY = "none";

/** A Date group's day as YYYY-MM-DD (Today … the fifth day), else null. */
export function dateGroupDay(group: DateGroup, today: string): string | null {
  const offset =
    group === "today"
      ? 0
      : group === "tomorrow"
        ? 1
        : /^day[2-6]$/.test(group)
          ? Number(group.slice(3))
          : null;
  if (offset === null || !DATE_GROUPS.includes(group)) return null;
  const [y, m, d] = today.split("-").map(Number);
  if (!y || !m || !d) return null;
  const day = new Date(y, m - 1, d + offset);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}
