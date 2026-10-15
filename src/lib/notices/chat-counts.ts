// Chat's counts outside Chat (CV-6b, spec §11 "Count"): the workspace
// switcher counts each workspace's open Catch up items, and the dock or
// taskbar badge (the tab title and a favicon dot on the web) shows the sum.
//
// The open workspace's number comes live from its chat store (no query per
// message); every other workspace's from `chat_unread_counts(ws)`, the same
// rule as the Chat tab (Later, muted chains, team mutes and Nothing counted
// out), re-read a moment after your own Catch up rows change.

import { useSyncExternalStore } from "react";
import { supabaseClient } from "../runtime.web";

export type ChatCounts = {
  byWorkspace: Readonly<Record<string, number>>;
  total: number;
};

const EMPTY: ChatCounts = { byWorkspace: {}, total: 0 };
/** Other workspaces read at most this many at a time. */
export const COUNTS_MAX_WORKSPACES = 25;

let fetched: Record<string, number> = {};
let live: { workspaceId: string; count: number } | null = null;
let snapshot: ChatCounts = EMPTY;
const listeners = new Set<() => void>();

function rebuild(): void {
  const byWorkspace: Record<string, number> = { ...fetched };
  if (live) byWorkspace[live.workspaceId] = live.count;
  let total = 0;
  for (const n of Object.values(byWorkspace)) total += n;
  const same =
    total === snapshot.total &&
    Object.keys(byWorkspace).length === Object.keys(snapshot.byWorkspace).length &&
    Object.entries(byWorkspace).every(([ws, n]) => snapshot.byWorkspace[ws] === n);
  if (same) return;
  snapshot = { byWorkspace, total };
  for (const listener of listeners) listener();
}

/** The open workspace's count, from its store (the Chat tab's number). */
export function setLiveChatCount(workspaceId: string | null, count: number): void {
  const next = workspaceId ? { workspaceId, count } : null;
  if (live?.workspaceId === next?.workspaceId && live?.count === next?.count) return;
  live = next;
  rebuild();
}

/** A workspace's open Catch up items, summed over its conversations. */
export async function readWorkspaceChatCount(workspaceId: string): Promise<number | null> {
  try {
    const { data, error } = await supabaseClient.rpc("chat_unread_counts", {
      p_workspace_id: workspaceId,
    });
    if (error || !Array.isArray(data)) return null;
    let n = 0;
    for (const row of data as Array<{ catchup?: unknown }>) {
      if (typeof row.catchup === "number" && row.catchup > 0) n += row.catchup;
    }
    return n;
  } catch {
    return null;
  }
}

/** Re-read the other workspaces' counts (the open one is live). */
export async function refreshChatCounts(
  workspaceIds: readonly string[],
  openWorkspaceId: string | null,
  read: (workspaceId: string) => Promise<number | null> = readWorkspaceChatCount,
): Promise<void> {
  const others = workspaceIds
    .filter((ws) => ws !== openWorkspaceId)
    .slice(0, COUNTS_MAX_WORKSPACES);
  const results = await Promise.all(others.map(async (ws) => [ws, await read(ws)] as const));
  const next: Record<string, number> = {};
  for (const [ws, n] of results) {
    // A failed read keeps the last number rather than dropping to zero.
    const value = n ?? fetched[ws];
    if (typeof value === "number") next[ws] = value;
  }
  fetched = next;
  rebuild();
}

/** Signed out: nothing counts. */
export function resetChatCounts(): void {
  fetched = {};
  live = null;
  rebuild();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getChatCounts(): ChatCounts {
  return snapshot;
}

export function useChatCounts(): ChatCounts {
  return useSyncExternalStore(subscribe, getChatCounts, getChatCounts);
}
