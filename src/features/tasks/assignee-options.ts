// Who a task can be assigned to, and how an assignee reads. Pure, so the
// pickers' rules are tested without the runtime (assignees.ts holds the hook
// and the RPC). The creator reads in the feed's first line since the "Created
// by" line went (MOD-129).

import { canBeAssignee } from "../sharing/rules";
import type { WorkspaceMember } from "../workspaces/types";

export type Assignee = {
  userId: string;
  /** How pickers name them: "Me" for you. */
  name: string;
  /** Their own name, for initials ("Me" must never become "M", call 43);
   *  empty when they haven't set one (the avatar then shows "?"). */
  fullName: string;
  avatarUrl: string | null;
  isMe: boolean;
  /** Viewers can't complete tasks, so they can't be assigned. */
  canTakeTasks: boolean;
};

/** The picker's value for "nobody" (Radix items can't use an empty string). */
export const UNASSIGNED = "__unassigned__";

/** Active workspace members as assignable people, current user first. */
export function toAssignees(members: WorkspaceMember[], userId: string | null): Assignee[] {
  return members
    .filter((m) => m.isActive && !m.removedAt)
    .map((m) => ({
      userId: m.userId,
      name: m.userId === userId ? "Me" : m.displayName?.trim() || "Member",
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
 * workspace's members. People who can only view are listed but can't be
 * picked (the server refuses them too).
 */
export function assigneeOptions(assignees: Assignee[]): AssigneeOption[] {
  return [
    { value: UNASSIGNED, label: "Unassigned", assignee: null, disabled: false },
    ...assignees.map((a) => ({
      value: a.userId,
      label: a.canTakeTasks ? a.name : `${a.name} (view only)`,
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
 * How a task's assignee reads: their name, "Unassigned", or "Former member"
 * for someone no longer in the workspace (the task stays assigned to them).
 */
export function assigneeLabel(
  assigneeId: string | null,
  byId: (id: string | null | undefined) => Assignee | null,
): string {
  if (!assigneeId) return "Unassigned";
  return byId(assigneeId)?.name ?? "Former member";
}
