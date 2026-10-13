// The run rules, app-wide (TV-F6; #323's use-queue-run ran only while Tasks
// was open). Mounted once by the app shell, it reads the selected workspace's
// shared store and keeps the session on my Up next wherever I am:
//  - Now done or Won't do (by me or anyone), deleted, unshared, or taken out of
//    Up next → the session moves to the next open task with its rhythm, or
//    ends by itself when Up next runs out (62);
//  - someone else finishing Now, or Now going away, says so quietly;
//  - Now finished by me counts in the session's "n done".
// It also keeps teammates' "<name> is on this" fresh (claims.ts). Renders
// nothing; it's a component so its once-a-second session reads never redraw
// the shell.

import { isClosedTask } from "@contracts/vocabularies";
import { useEffect, useRef } from "react";
import { toast } from "sonner";

import { useStoreSnapshot, useWorkspaceStore } from "../../lib/sync/react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { queueEntriesOf } from "../tasks/queue";
import { useRunClaimsPoll } from "./claims";
import { bindFocusTask, focusClockIsHere, useFocusSession } from "./engine";
import { noteRunTitle, recordRunDone, setRunNotice, useFocusRunState } from "./run";
import { followStep } from "./run-model";

export function FocusRunFollower() {
  const { runtime, userId } = useAuth();
  const { selectedWorkspaceId, modulePermissions, members } = useWorkspace();
  const store = useWorkspaceStore(
    runtime,
    userId,
    selectedWorkspaceId,
    modulePermissions.tasks !== "none",
  );
  const snap = useStoreSnapshot(store);
  const session = useFocusSession();
  const { run } = useFocusRunState();
  const claimsLoad = runtime?.focus.listClaims ?? null;
  // Only a workspace with someone else in it can have a claim to show.
  const hasTeammates = members.some((m) => m.userId !== userId && !m.removedAt);
  useRunClaimsPoll(
    claimsLoad,
    modulePermissions.tasks !== "none" && hasTeammates ? selectedWorkspaceId : null,
    userId,
  );

  /** Tasks that were in my Up next while they were Now. */
  const wasQueued = useRef(new Set<string>());
  const membersRef = useRef(members);
  membersRef.current = members;
  const titleRef = useRef(session.taskTitle);
  titleRef.current = session.taskTitle;

  const nowId = session.tracking ? session.taskId : null;
  const sessionWs = session.workspaceId;
  useEffect(() => {
    if (!nowId || !userId || !snap.loaded || snap.workspaceId !== sessionWs) return;
    if (!focusClockIsHere()) return;
    const mine = queueEntriesOf(snap.queue, userId).map((e) => e.taskId);
    if (mine.includes(nowId)) wasQueued.current.add(nowId);
    const byId = new Map(snap.bundle.tasks.map((t) => [t.id, t]));
    const step = followStep({
      nowTaskId: nowId,
      myQueue: mine,
      task: (id) => {
        const t = byId.get(id);
        if (!t || t.deletedAt) return undefined;
        return { id, open: !isClosedTask(t), completedBy: t.completedBy ?? null };
      },
      selfId: userId,
      // A cut read can't tell a missing task from one it didn't bring.
      complete: snap.restLoaded && snap.bundle.truncated.length === 0,
      wasQueued: wasQueued.current.has(nowId),
    });
    if (step.kind === "stay") return;
    wasQueued.current.delete(nowId);
    const left = byId.get(step.leftTaskId);
    const title = left?.title?.trim() || titleRef.current.trim() || "Untitled";
    if (left && isClosedTask(left) && (left.completedBy ?? userId) === userId) {
      recordRunDone(step.leftTaskId);
    }
    if (step.left) {
      const who =
        step.left === "completed"
          ? (membersRef.current.find((m) => m.userId === left?.completedBy)?.displayName ??
            "Someone")
          : null;
      const notice =
        step.left === "completed"
          ? `${who} completed “${title}”.`
          : `“${title}” was deleted or is no longer shared with you.`;
      setRunNotice(notice);
      toast(notice, {
        description: step.kind === "move" ? "Focus moved on to the next task." : "Focus ended.",
      });
    }
    if (step.kind === "end") {
      bindFocusTask(null);
      return;
    }
    const next = byId.get(step.taskId);
    if (!next) return;
    const project = snap.bundle.buckets.find((b) => b.id === next.bucketId);
    bindFocusTask({
      id: next.id,
      title: next.title || "Untitled",
      bucketName: project?.name ?? null,
      workspaceId: snap.workspaceId,
    });
  }, [nowId, sessionWs, snap, userId]);

  // Titles: the server never sends them, and a takeover from the top bar or
  // Home has no task list at hand. Keep the clock's label and the run's (a
  // session on another device) as the store has them.
  const runTaskId = run?.workspaceId === snap.workspaceId ? (run?.nowTaskId ?? null) : null;
  useEffect(() => {
    if (!snap.loaded) return;
    const find = (id: string | null) =>
      id ? snap.bundle.tasks.find((t) => t.id === id) : undefined;
    const now = nowId && snap.workspaceId === sessionWs ? find(nowId) : undefined;
    if (now && focusClockIsHere() && (now.title || "Untitled") !== titleRef.current) {
      bindFocusTask({
        id: now.id,
        title: now.title || "Untitled",
        bucketName: snap.bundle.buckets.find((b) => b.id === now.bucketId)?.name ?? null,
        workspaceId: snap.workspaceId,
      });
    }
    const theirs = find(runTaskId);
    if (theirs) noteRunTitle(theirs.id, theirs.title || "Untitled");
  }, [nowId, sessionWs, runTaskId, snap]);

  return null;
}
