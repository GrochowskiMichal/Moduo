// "<name> is on this" (TV-F2, F2-6): which teammate's running run is on which
// task right now. Runs are private; `focus_claims` answers only who is on what,
// for tasks I can see, while their run is live (seen in the last 3 minutes).
// One store per open workspace, polled while Tasks is on screen: Realtime
// can't carry it (each person reads only their own runs).

import { useEffect, useSyncExternalStore } from "react";
import type { FocusClaim } from "../focus/run-model";

/** Refresh claims this often while the page is visible. */
const CLAIMS_POLL_MS = 60_000;
const EMPTY = new Map<string, string[]>();

/** Claims → task id → the teammates on it (in the order the server gave). */
export function runClaimsByTask(claims: FocusClaim[], selfId: string | null): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const c of claims) {
    if (c.userId === selfId) continue;
    const list = map.get(c.taskId);
    if (!list) map.set(c.taskId, [c.userId]);
    else if (!list.includes(c.userId)) list.push(c.userId);
  }
  return map;
}

/** "Mike is on this" / "Mike and Ola are on this". */
export function onThisLabel(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return `${names[0]} is on this`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are on this`;
}

// ── the store ────────────────────────────────────────────────────────────────

let current: { workspaceId: string | null; byTask: Map<string, string[]> } = {
  workspaceId: null,
  byTask: EMPTY,
};
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Replace a workspace's claims (only while it's the one on screen). */
export function setRunClaims(workspaceId: string, byTask: Map<string, string[]>): void {
  current = { workspaceId, byTask };
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Who is on each task in `workspaceId` (empty for any other workspace). */
export function useRunClaims(workspaceId: string | null | undefined): Map<string, string[]> {
  const snap = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  return workspaceId && snap.workspaceId === workspaceId ? snap.byTask : EMPTY;
}

/**
 * Keep the open workspace's claims fresh: now, every minute while visible, and
 * on coming back to the window. Mounted by the Tasks page.
 */
export function useRunClaimsPoll(
  load: ((workspaceId: string) => Promise<FocusClaim[]>) | null,
  workspaceId: string | null,
  selfId: string | null,
): void {
  useEffect(() => {
    if (!load || !workspaceId) return;
    let alive = true;
    let inFlight = false;
    const refresh = () => {
      if (inFlight) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      inFlight = true;
      load(workspaceId)
        .then((claims) => {
          if (alive) setRunClaims(workspaceId, runClaimsByTask(claims, selfId));
        })
        .catch(() => {
          /* keep the last answer */
        })
        .finally(() => {
          inFlight = false;
        });
    };
    // A switch shows nothing from the last workspace while the new one loads.
    if (current.workspaceId !== workspaceId) setRunClaims(workspaceId, EMPTY);
    refresh();
    const id = setInterval(refresh, CLAIMS_POLL_MS);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load, workspaceId, selfId]);
}
