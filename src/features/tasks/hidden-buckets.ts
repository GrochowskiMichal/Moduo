// Buckets the user deleted in this app session (tasks-v2 Q1-4).
//
// A bucket delete reaches the server only when its Undo toast closes (see
// `deleteBucket` in use-tasks-module.ts), and every surface that loads tasks
// runs its own `useTasksModule` (Tasks, Calendar, Notes, Email). So "this
// bucket is gone" can't live in one hook's bundle: a reload before the server
// delete, another pending delete committing, or a remount would bring it back.
// It lives here instead, shared by every instance: hidden buckets drop out of
// the bucket lists and their tasks show in Inbox until the server has moved
// them there; Undo un-hides. A committed delete stays hidden for the session —
// the server no longer has the bucket, so hiding it is then a no-op.

import { useSyncExternalStore } from "react";

let hidden: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function hideBucket(id: string): void {
  if (hidden.has(id)) return;
  hidden = new Set(hidden).add(id);
  emit();
}

export function unhideBucket(id: string): void {
  if (!hidden.has(id)) return;
  const next = new Set(hidden);
  next.delete(id);
  hidden = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Same Set until it changes — a fresh one per read would loop useSyncExternalStore.
function getSnapshot(): ReadonlySet<string> {
  return hidden;
}

/** The ids of buckets deleted this session (still pending or committed). */
export function useHiddenBuckets(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
