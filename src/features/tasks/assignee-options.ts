// Who a task can be assigned to, and how an assignee reads. Pure, so the
// pickers' rules are tested without the runtime (assignees.ts holds the hook
// and the RPC). The creator reads in the feed's first line since the "Created
// by" line went (MOD-129).
//
// One way to name you (MOD-137, call #27): as a value on its own you read
// "You" (a chip, a cell, a column), in a people list your name plus "(you)",
// and inside a sentence "you" ("Waiting on you"). Never "Me".

import { canBeAssignee } from "../sharing/rules";
import type { WorkspaceMember } from "../workspaces/types";

export type Assignee = {
  userId: string;
  /** How they read as a value on its own: "You" for you (MOD-137). People
   *  lists use `assigneeListName`, sentences `assigneeInSentence`. */
  name: string;
  /** Their own name, for initials ("You" must never become "Y", call 43);
   *  empty when they haven't set one (the avatar then shows "?"). */
  fullName: string;
  avatarUrl: string | null;
  isMe: boolean;
  /** Viewers can't complete tasks, so they can't be assigned. */
  canTakeTasks: boolean;
};

/** The picker's value for "nobody" (Radix items can't use an empty string). */
export const UNASSIGNED = "__unassigned__";

/** You, as a value on its own: a chip, a cell, a column (MOD-137). */
export const SELF_NAME = "You";

/** Words that find you in a people picker's search, so typing "me" still
 *  works (MOD-137 keeps "me" as input, never as copy). */
export const SELF_KEYWORDS: readonly string[] = ["me", "mine", "you"];

/** How a person reads in a people list (an assignee picker, a menu, the
 *  members): "Maciej Grzywacz (you)" for you, "You" while you have no name
 *  (MOD-137). */
export function assigneeListName(a: Pick<Assignee, "name" | "fullName" | "isMe">): string {
  if (!a.isMe) return a.name;
  return a.fullName ? `${a.fullName} (you)` : SELF_NAME;
}

/** How a person reads inside a sentence: "you" for you ("Waiting on you"),
 *  their own name for anyone else (MOD-137). */
export function assigneeInSentence(a: Pick<Assignee, "name" | "fullName" | "isMe">): string {
  return a.isMe ? "you" : a.fullName || a.name;
}

/** Active workspace members as assignable people, current user first. */
export function toAssignees(members: WorkspaceMember[], userId: string | null): Assignee[] {
  return members
    .filter((m) => m.isActive && !m.removedAt)
    .map((m) => ({
      userId: m.userId,
      name: m.userId === userId ? SELF_NAME : m.displayName?.trim() || "Member",
      fullName: m.displayName?.trim() || "",
      avatarUrl: m.avatarUrl,
      isMe: m.userId === userId,
      canTakeTasks: canBeAssignee(m.perms),
    }))
    .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name));
}

export type AssigneeOption = {
  value: string;
  label: string;
  /** null for Unassigned. */
  assignee: Assignee | null;
  disabled: boolean;
};

/**
 * Every assignee picker offers the same choices: Unassigned, then the
 * workspace's members, you as "Name (you)" (MOD-137). People who can only
 * view are listed but can't be picked (the server refuses them too).
 */
export function assigneeOptions(assignees: Assignee[]): AssigneeOption[] {
  return [
    { value: UNASSIGNED, label: "Unassigned", assignee: null, disabled: false },
    ...assignees.map((a) => ({
      value: a.userId,
      label: a.canTakeTasks ? assigneeListName(a) : `${assigneeListName(a)} (view only)`,
      assignee: a,
      disabled: !a.canTakeTasks,
    })),
  ];
}

export function toAssigneeValue(assigneeId: string | null): string {
  return assigneeId ?? UNASSIGNED;
}

export function fromAssigneeValue(value: string): string | null {
  return value === UNASSIGNED ? null : value;
}

/**
 * How a task's assignee reads as a value: their name, "You", "Unassigned", or
 * "Former member" for someone no longer in the workspace (the task stays
 * assigned to them).
 */
export function assigneeLabel(
  assigneeId: string | null,
  byId: (id: string | null | undefined) => Assignee | null,
): string {
  if (!assigneeId) return "Unassigned";
  return byId(assigneeId)?.name ?? "Former member";
}
