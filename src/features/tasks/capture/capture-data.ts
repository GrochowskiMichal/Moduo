// What the Task capture needs to know (TV-U14): projects, sections, teams,
// tags and where each project's tasks start (new captures go on top, default
// h). A Tasks screen that is open shares the bundle it already holds; from
// anywhere else (⌘⇧K over Notes) the capture reads it once when it opens.
// The shared task store (TV-D11a) replaces both with one read.

import { useEffect, useState, useSyncExternalStore } from "react";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { Task, TasksModuleBundle } from "../model";

type Snapshot = { workspaceId: string; bundle: TasksModuleBundle };

/** Each sharing screen's latest bundle; the most recent share is the one read. */
const sharing = new Map<symbol, Snapshot>();
let shared: Snapshot | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

/** A Tasks screen shares the bundle it holds (use-tasks-module.ts); null stops. */
export function shareTasksBundle(owner: symbol, snapshot: Snapshot | null): void {
  if (snapshot) {
    sharing.set(owner, snapshot);
    shared = snapshot;
  } else {
    sharing.delete(owner);
    shared = [...sharing.values()].at(-1) ?? null;
  }
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getShared = () => shared;

/** The bundle a capture reads: the shared one, else one read when it opens. */
export function useCaptureBundle(
  runtime: ModuoRuntime | null,
  workspaceId: string | null,
  /** Bumped on every open: a fresh read when nothing is shared. */
  openId: number,
): TasksModuleBundle | null {
  const live = useSyncExternalStore(subscribe, getShared, getShared);
  const fromScreen = live && live.workspaceId === workspaceId ? live.bundle : null;
  const [read, setRead] = useState<Snapshot | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: openId reads again on every open
  useEffect(() => {
    if (fromScreen || !runtime || !workspaceId) return;
    let cancelled = false;
    void runtime.tasks
      .list(workspaceId)
      .then((bundle) => {
        if (!cancelled) setRead({ workspaceId, bundle });
      })
      .catch(() => {
        // The capture still works without it: Inbox, no project list.
      });
    return () => {
      cancelled = true;
    };
  }, [fromScreen, runtime, workspaceId, openId]);

  if (fromScreen) return fromScreen;
  return read && read.workspaceId === workspaceId ? read.bundle : null;
}

// ── created tasks reach the open screens at once ────────────────────────────

export const TASKS_CAPTURED_EVENT = "moduo:tasks:captured";

export type TasksCapturedDetail = {
  workspaceId: string;
  /** Saved rows (created, or deleted by an Undo). */
  tasks: Task[];
};

/** Tell open Tasks screens about rows a capture saved (Realtime catches up too). */
export function announceCaptured(detail: TasksCapturedDetail): void {
  if (typeof window === "undefined" || detail.tasks.length === 0) return;
  window.dispatchEvent(new CustomEvent<TasksCapturedDetail>(TASKS_CAPTURED_EVENT, { detail }));
}

export function onCaptured(handler: (detail: TasksCapturedDetail) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const listener = (event: Event) => handler((event as CustomEvent<TasksCapturedDetail>).detail);
  window.addEventListener(TASKS_CAPTURED_EVENT, listener);
  return () => window.removeEventListener(TASKS_CAPTURED_EVENT, listener);
}
