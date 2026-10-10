// /tasks URL search params (DF-1, mirrors notes NO-3 / contacts FX-1).
// Selection is URL-held so reload/back/forward and `moduo:entity:open` deep
// links (dashboard widget rows, contact-hub rollups, note /task chips) land on
// the right task instead of whatever the page last showed.

import type { Bucket, Task } from "./model";

export type TasksSearch = {
  id?: string;
};

export function validateTasksSearch(search: Record<string, unknown>): TasksSearch {
  const id = typeof search.id === "string" && search.id.length > 0 ? search.id : undefined;
  return id ? { id } : {};
}

// ── inbound-target resolution ────────────────────────────────────────────────
// Pure: an inbound `?id=` is a task id (select it, scoped to its bucket — or
// All when that bucket isn't one you can see), a
// bucket id (a `project` deep link — scope to it), or unknown/stale (degrade
// to the default selection, never crash). The scope value is the plan view's
// bucket-scope selection ("inbox" is the alias the rail uses for the system
// Inbox bucket).

export type TasksDeepLinkTarget =
  | { kind: "task"; taskId: string; scope: string }
  | { kind: "bucket"; scope: string }
  | { kind: "none" };

export function resolveTasksDeepLink(
  id: string,
  ctx: {
    tasks: ReadonlyArray<Pick<Task, "id" | "bucketId">>;
    buckets: ReadonlyArray<Pick<Bucket, "id">>;
    inboxId: string | null;
  },
): TasksDeepLinkTarget {
  // A task in a project you can't see (it was assigned to you there) opens in
  // All, which lists it; scoping to that project would bounce to Inbox and
  // select another task (TV-P0, AC1.10).
  const scopeFor = (bucketId: string) =>
    bucketId === ctx.inboxId
      ? "inbox"
      : ctx.buckets.some((b) => b.id === bucketId)
        ? bucketId
        : "all";
  const task = ctx.tasks.find((t) => t.id === id);
  if (task) return { kind: "task", taskId: task.id, scope: scopeFor(task.bucketId) };
  if (id === ctx.inboxId || ctx.buckets.some((b) => b.id === id)) {
    return { kind: "bucket", scope: scopeFor(id) };
  }
  return { kind: "none" };
}
