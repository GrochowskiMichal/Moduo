// Assignee hook and the access preview. A task's assignee is `assigneeId`
// (null = Unassigned); `creatorId` is who made it. The pure rules the pickers
// share live in assignee-options.ts.

import { useMemo } from "react";

import { supabaseClient } from "../../lib/runtime.web";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../workspaces/workspace-context";
import { type Assignee, toAssignees } from "./assignee-options";

export type { Assignee } from "./assignee-options";

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
    const list = toAssignees(members, userId);
    const map = new Map(list.map((a) => [a.userId, a]));
    return {
      assignees: list,
      currentUserId: userId,
      byId: (id) => (id ? (map.get(id) ?? null) : null),
    };
  }, [members, userId]);
}
