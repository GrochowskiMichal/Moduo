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
// Pure: an inbound `?id=` is a task id (select it, scoped to its bucket), a
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
  const scopeFor = (bucketId: string) => (bucketId === ctx.inboxId ? "inbox" : bucketId);
  const task = ctx.tasks.find((t) => t.id === id);
  if (task) return { kind: "task", taskId: task.id, scope: scopeFor(task.bucketId) };
  if (id === ctx.inboxId || ctx.buckets.some((b) => b.id === id)) {
    return { kind: "bucket", scope: scopeFor(id) };
  }
  return { kind: "none" };
}

// ── Live search (`/`, tasks-v2 §7, U2-4) ────────────────────────────────────

/**
 * Whether a task matches the search box: every word of the query appears in
 * its title or description, ignoring case. An empty query matches everything.
 */
export function taskMatchesQuery(
  task: Pick<Task, "title" | "description">,
  query: string,
): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = `${task.title}\n${task.description ?? ""}`.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

/** What a `#tag` or `@name` in the search box became. */
export type SearchToken = { dimension: "tag" | "assignee"; value: string };

export type SearchTokenContext = {
  tags: ReadonlyArray<{ id: string; name: string }>;
  /** Members in picker order; the current user is named "Me" there. */
  people: ReadonlyArray<{ userId: string; name: string; isMe?: boolean }>;
};

/** One name, by exact match (ignoring case) or else a single prefix match. */
function resolveName<T>(
  word: string,
  items: readonly T[],
  namesOf: (item: T) => string[],
): T | null {
  const w = word.toLowerCase();
  const exact = items.filter((item) => namesOf(item).some((n) => n.toLowerCase() === w));
  if (exact.length === 1) return exact[0] ?? null;
  if (exact.length > 1) return null;
  const prefixed = items.filter((item) => namesOf(item).some((n) => n.toLowerCase().startsWith(w)));
  return prefixed.length === 1 ? (prefixed[0] ?? null) : null;
}

const TOKEN = /(^|\s)([#@])([^\s#@]+)(?=\s)/g;

/**
 * Turns finished `#tag` and `@name` words in the search box into filter
 * values (U2-4). A word is finished once a space follows it, or on Enter
 * (`final`), so `#des` doesn't jump to a filter while you're still typing
 * `#design`. `@me` is you; a person matches by their whole name or first
 * name. A word that matches nothing, or more than one tag or person, stays
 * in the query as text (`#123` and `C#` stay text unless a tag has that name).
 */
export function takeSearchTokens(
  query: string,
  ctx: SearchTokenContext,
  final = false,
): { query: string; tokens: SearchToken[] } {
  const tokens: SearchToken[] = [];
  const source = final ? `${query} ` : query;
  const rest = source.replace(TOKEN, (match, lead: string, sigil: string, word: string) => {
    if (sigil === "#") {
      const tag = resolveName(word, ctx.tags, (t) => [t.name]);
      if (!tag) return match;
      tokens.push({ dimension: "tag", value: tag.id });
      return lead;
    }
    const person = resolveName(word, ctx.people, (p) =>
      p.isMe ? ["me"] : [p.name, p.name.split(/\s+/)[0] ?? p.name],
    );
    if (!person) return match;
    tokens.push({ dimension: "assignee", value: person.userId });
    return lead;
  });
  if (tokens.length === 0) return { query, tokens };
  const cleaned = rest.replace(/\s{2,}/g, " ").replace(/^\s+/, "");
  return { query: final ? cleaned.trimEnd() : cleaned, tokens };
}
