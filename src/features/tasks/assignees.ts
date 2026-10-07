// Assignee helpers. A task's assignee IS its `ownerId` (the notification trigger
// and the overdue inbox already read it that way) — there is no separate column.
// Candidates are the workspace's active members.

import { useMemo } from "react";

import { supabaseClient } from "../../lib/runtime.web";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../workspaces/workspace-context";

export type Assignee = {
  userId: string;
  name: string;
  avatarUrl: string | null;
  isMe: boolean;
  /** Viewers can't complete tasks, so they can't be assigned. */
  canTakeTasks: boolean;
};

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + last).toUpperCase();
}

/** Null when they can already see the bucket. Otherwise the picker warning. */
export async function previewAssign(bucketId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabaseClient.rpc("share_assign_preview", {
    p_bucket_id: bucketId,
    p_user_id: userId,
  });
  if (error || typeof data !== "string" || data.length === 0) return null;
  return data;
}

/** Active workspace members as assignable people, current user first. */
export function useAssignees(): {
  assignees: Assignee[];
  currentUserId: string | null;
  byId: (id: string | null | undefined) => Assignee | null;
} {
  const { members } = useWorkspace();
  const { userId } = useAuth();
  return useMemo(() => {
    const list: Assignee[] = members
      .filter((m) => m.isActive && !m.removedAt)
      .map((m) => ({
        userId: m.userId,
        name: m.userId === userId ? "Me" : (m.displayName?.trim() ?? "Member"),
        avatarUrl: m.avatarUrl,
        isMe: m.userId === userId,
        canTakeTasks: m.perms.includes("tasks.edit"),
      }))
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name));
    const map = new Map(list.map((a) => [a.userId, a]));
    return {
      assignees: list,
      currentUserId: userId,
      byId: (id) => (id ? (map.get(id) ?? null) : null),
    };
  }, [members, userId]);
}
