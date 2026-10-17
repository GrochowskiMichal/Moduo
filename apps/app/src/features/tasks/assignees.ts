// Assignee hook and the access preview. A task's assignee is `assigneeId`
// (null = Unassigned); `creatorId` is who made it. The pure rules the pickers
// share live in assignee-options.ts.

import { useMemo } from "react";

import { supabaseClient } from "../../lib/runtime.web";
import { pickerSuffix } from "../../lib/statuses/model";
import { usePeopleNow } from "../../lib/statuses/store";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../workspaces/workspace-context";
import { type Assignee, toAssignees } from "./assignee-options";

export { initialsOf } from "../../lib/initials";
export type { Assignee } from "./assignee-options";

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
  const { members, selectedWorkspaceId } = useWorkspace();
  const { userId } = useAuth();
  // Statuses come from Chat's people-now (CV-17); the app chrome holds it.
  const now = usePeopleNow(userId, selectedWorkspaceId ?? null);
  return useMemo(() => {
    const at = new Date();
    const list = toAssignees(members, userId, (id) => pickerSuffix(now.people.get(id), at));
    const map = new Map(list.map((a) => [a.userId, a]));
    return {
      assignees: list,
      currentUserId: userId,
      byId: (id) => (id ? (map.get(id) ?? null) : null),
    };
  }, [members, userId, now.people]);
}
