// Who a task can be assigned to, and how an assignee or creator reads. Pure,
// so the pickers' rules are tested without the runtime (assignees.ts holds the
// hook and the RPC).

import { canBeAssignee } from "../sharing/rules";
import type { WorkspaceMember } from "../workspaces/types";
import type { Task } from "./model";

export type Assignee = {
  userId: string;
  name: string;
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
      name: m.userId === userId ? "Me" : (m.displayName?.trim() ?? "Member"),
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

/**
 * Who goes after "Created by", or null when the creator isn't known (tasks
 * reassigned before the creator was kept, TV-D1) and the line leaves it out.
 */
export function createdByLabel(
  task: Pick<Task, "creatorId" | "creatorUnknown">,
  byId: (id: string | null | undefined) => Assignee | null,
): string | null {
  if (task.creatorUnknown || !task.creatorId) return null;
  const creator = byId(task.creatorId);
  if (!creator) return "a former member";
  return creator.isMe ? "you" : creator.name;
}
