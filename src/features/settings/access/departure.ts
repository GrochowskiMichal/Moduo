// What someone leaves behind when they're removed, or leave (TV-U16, AC5.6's
// UI half, REPLAN 78). The server hands everything on (`teams_member_removed`,
// `share_member_removed`); the confirm says where it goes, with the numbers
// the reader's own copy of Tasks can show.

import { useMemo } from "react";

import { useStoreSnapshot, useWorkspaceStore } from "../../../lib/sync/react";
import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { type DepartureSummary, departureSummary } from "../../tasks/project-overview";

const NO_ROWS: never[] = [];

/** The departing person's tasks, leads and teams as the reader sees them, or
 *  null when the reader can't read Tasks here (the confirm then says it in
 *  words only). */
export function useDepartureSummary(departingId: string | null): DepartureSummary | null {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId: workspaceId, modulePermissions } = useWorkspace();
  const available = (modulePermissions?.tasks ?? "none") !== "none" && !!departingId;
  const store = useWorkspaceStore(runtime, userId, workspaceId, available);
  const snap = useStoreSnapshot(store);
  return useMemo(() => {
    if (!store || !snap.loaded || !departingId) return null;
    // Archived projects count too: the server unassigns and clears leads there as well.
    const { tasks, buckets, archivedTasks, archivedBuckets } = snap.bundle;
    return departureSummary(departingId, {
      tasks: archivedTasks?.length ? [...tasks, ...archivedTasks] : tasks,
      buckets: archivedBuckets?.length ? [...buckets, ...archivedBuckets] : buckets,
      teams: snap.bundle.teams ?? NO_ROWS,
      teamMembers: snap.bundle.teamMembers ?? NO_ROWS,
    });
  }, [store, snap, departingId]);
}
