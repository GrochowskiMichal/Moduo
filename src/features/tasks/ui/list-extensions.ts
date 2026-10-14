// The List's seams for the views built on it (TV-U15): Upcoming groups by
// day its own way, My tasks puts its team block on top, the Inbox folds its
// snoozed tasks at the end. Each view hands the List what differs; the rows,
// groups, keys, drops, folds and states stay the List's (TV-U10's "reuse
// them, don't fork them"). Types only.

import type { ReactNode } from "react";
import type { TaskGroup } from "../helpers";
import type { GroupAddState } from "../list-group-add";
import type { Task } from "../model";

/**
 * A view that groups its own way (Upcoming's days): the List draws these
 * groups in this order, empty ones included (an empty day keeps its header
 * and takes drops), and asks the view what a drop into one does.
 */
export type ListGrouping = {
  /** The groups, ordered inside (the view orders its own rows). */
  groups: (tasks: readonly Task[], now: Date) => TaskGroup[];
  /** The group a task's own fields put it in (where a drag starts). */
  keyOf: (task: Task, now: Date) => string;
  /** A header's words: the quiet line after the name, or a count. */
  header: (group: TaskGroup, now: Date) => { sub?: ReactNode; count?: ReactNode };
  /** Something the header always offers before its "+" (Earlier's "Move all…"). */
  headerAction?: (group: TaskGroup) => ReactNode;
  /** Whether a dragged task may land in a group. */
  accepts: (groupKey: string, task: Task) => boolean;
  /** It landed there: the view writes what that means. */
  onDrop: (groupKey: string, task: Task) => void;
  /** Each header's "+". */
  addState: (groupKey: string) => GroupAddState;
  /** What a row's date column says in this view ("3:00 PM · 45m", "missed 2:00 PM"). */
  whenOf?: (task: Task, now: Date) => string | null;
};

/**
 * A group the view adds around the List's own (My tasks' "For Design · 2
 * unclaimed" on top, the Inbox's "Snoozed · 3" at the end). Its tasks are in
 * the List's `tasks` (so filters, search and the selection see them) but in
 * none of its own groups. A drag never starts or lands in one.
 */
export type ListExtraGroup = {
  /** Unique among the List's group keys ("team:…", "snoozed"). */
  key: string;
  place: "lead" | "trail";
  label: string;
  leading?: ReactNode;
  sub?: ReactNode;
  /** Its count; absent: how many tasks it holds; null: none shown. */
  count?: ReactNode | null;
  /** Its tasks, in order (ids of tasks in the List's `tasks`). */
  taskIds: readonly string[];
  /** Rows shown before "Show n more" (absent: all). */
  limit?: number;
  /** Starts folded until the person opens it (remembered like any group). */
  folded?: boolean;
  /** Its header's "+". */
  add?: GroupAddState;
  /** What a row's date column says here ("until Fri"). */
  whenOf?: (task: Task) => string | null;
};
