// "Pause notifications from this workspace" (CV-18, spec §15, CH46): the
// workspaces whose notifications you paused. Read with
// `workspace_notice_pauses()`; changed only through
// `workspace_op_pause_notices(ws, paused)`. Your pauses are yours alone (a
// table only you read, not your membership row). The server
// does the pausing (its notice gate and the email job); this copy only draws
// the switcher. A sign-out forgets it.

import { useEffect, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { supabaseClient } from "@/lib/runtime.web.client";

let paused: ReadonlySet<string> = new Set();
let loadedFor: string | null = null;
/** Bumped by every pause or resume: a read that started before one is stale. */
let changes = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** What `workspace_notice_pauses()` answers: a list of workspace ids. */
export function pausesFromRow(raw: unknown): Set<string> {
  return new Set(Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : []);
}

async function load(userId: string): Promise<void> {
  const at = changes;
  const { data, error } = await supabaseClient.rpc("workspace_notice_pauses");
  if (error || loadedFor !== userId || at !== changes) return;
  paused = pausesFromRow(data);
  emit();
}

/** Your paused workspaces, read once per signed-in person (null: signed out). */
export function usePausedWorkspaces(userId: string | null): ReadonlySet<string> {
  useEffect(() => {
    if (!userId) {
      if (loadedFor) forgetPauses();
      return;
    }
    if (loadedFor === userId) return;
    loadedFor = userId;
    paused = new Set();
    emit();
    void load(userId);
  }, [userId]);
  return useSyncExternalStore(
    subscribe,
    () => paused,
    () => paused,
  );
}

/** Pause or resume one workspace: shown at once, put back when refused. */
export async function setWorkspacePaused(workspaceId: string, on: boolean): Promise<void> {
  changes += 1;
  const before = paused;
  const next = new Set(paused);
  if (on) next.add(workspaceId);
  else next.delete(workspaceId);
  paused = next;
  emit();
  const { error } = await supabaseClient.rpc("workspace_op_pause_notices", {
    p_workspace_id: workspaceId,
    p_paused: on,
  });
  if (error) {
    if (paused === next) {
      paused = before;
      emit();
    }
    toast("Couldn't change this workspace's notifications. Try again.");
    return;
  }
  toast(
    on
      ? "Notifications from this workspace are paused. Catch up still fills."
      : "Notifications from this workspace are back on.",
  );
}

/** Signing out. */
export function forgetPauses(): void {
  loadedFor = null;
  paused = new Set();
  emit();
}
