// /tasks URL search params (DF-1, mirrors notes NO-3 / contacts FX-1).
// Selection is URL-held so reload/back/forward and `moduo:entity:open` deep
// links (dashboard widget rows, contact-hub rollups, note /task chips) land on
// the right task instead of whatever the page last showed.

import { descriptionPlainText } from "../../../../../supabase/functions/_shared/description-markdown";
import { taskHandle } from "../../lib/task-handle";
import { findSigilWords } from "../spine/grammar";
import type { Bucket, Task } from "./model";

export type TasksSearch = {
  id?: string;
  /** A saved view's link (TV-U8): `/tasks?view=<id>`. */
  view?: string;
  /**
   * The place open in the centre (DF-1): a sidebar scope, a project's id or a
   * saved view's `view:<id>`. The URL is its only source; writes replace, so
   * Back and Forward never walk through places.
   */
  place?: string;
};

/** The sidebar scopes a place may name besides a project or a saved view. */
export const TASKS_SCOPES = [
  "inbox",
  "today",
  "upcoming",
  "mine",
  "all",
  "wontdo",
  "archived",
  "trash",
  "templates",
  "new-view",
] as const;

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const VIEW_ID = new RegExp(`^${UUID}$`, "i");
// A project (a `tmp-` one only just made, too) or a saved view (`view:<id>`).
const PLACE_ID = new RegExp(`^(?:(?:tmp-)?${UUID}|view:${UUID})$`, "i");

/** A place the URL may hold; anything else is dropped, never looked up. */
export function isTasksPlace(value: unknown): value is string {
  return (
    typeof value === "string" &&
    ((TASKS_SCOPES as readonly string[]).includes(value) || PLACE_ID.test(value))
  );
}

export function validateTasksSearch(search: Record<string, unknown>): TasksSearch {
  const id = typeof search.id === "string" && search.id.length > 0 ? search.id : undefined;
  // Only a view id: anything else is dropped, never looked up.
  const view =
    typeof search.view === "string" && VIEW_ID.test(search.view) ? search.view : undefined;
  const place = isTasksPlace(search.place) ? search.place : undefined;
  // `place` before `id`: the address bar ends with the task (MOD-28).
  return { ...(place ? { place } : {}), ...(view ? { view } : {}), ...(id ? { id } : {}) };
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

/**
 * A handle deep link (`?id=MOD-142`, RF-1) resolved against the loaded tasks:
 * the task whose number it names under the workspace's current key, or null
 * (not loaded, an old key, someone else's: the server answers those). The ⌘K
 * palette asks it too (MOD-144), where people type "mod 99" as often as
 * "MOD-99": a space reads as the hyphen, as in `taskMatchesQuery`.
 */
export function taskIdForHandle(
  handle: string,
  tasks: ReadonlyArray<Pick<Task, "id" | "number">>,
  taskKey: string | null,
): string | null {
  const m = /^([A-Za-z]{2,5})(?:-|\s+)(\d{1,9})$/.exec(handle.trim());
  if (!m || !taskKey || m[1].toUpperCase() !== taskKey.toUpperCase()) return null;
  const number = Number(m[2]);
  return tasks.find((t) => t.number === number)?.id ?? null;
}

/**
 * What a handle link does next (MOD-28: refresh, back and forward all arrive
 * as `?id=MOD-142` now): open a loaded task (archived projects' too), wait
 * while Done, Won't do and Backlog tasks are still loading (the shared store,
 * TV-D11a), or only then ask the server (an old key, a task not loaded).
 */
export type HandleLinkStep =
  { kind: "task"; taskId: string } | { kind: "wait" } | { kind: "lookup" };

export function handleLinkStep(
  handle: string,
  ctx: {
    tasks: ReadonlyArray<Pick<Task, "id" | "number">>;
    taskKey: string | null;
    restLoaded: boolean;
  },
): HandleLinkStep {
  const local = taskIdForHandle(handle, ctx.tasks, ctx.taskKey);
  if (local) return { kind: "task", taskId: local };
  return ctx.restLoaded ? { kind: "lookup" } : { kind: "wait" };
}

/**
 * The server's answer for a handle: its task; "gone" only when the server
 * said there's none the reader can open; "failed" when it couldn't answer
 * (offline, an error), which a link must never read as gone (MOD-28).
 */
export async function lookupHandleLink(
  handle: string,
  lookup: (handle: string) => Promise<string | null>,
): Promise<{ kind: "task"; taskId: string } | { kind: "gone" } | { kind: "failed" }> {
  try {
    const id = await lookup(handle);
    return id ? { kind: "task", taskId: id } : { kind: "gone" };
  } catch {
    return { kind: "failed" };
  }
}

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

// ── Live search (`/`, tasks-v2 §7, U2-4) ────────────────────────────────────

/** A description's text, lower-cased, cached by its source (they're long and
 *  searched on every keystroke). */
const textCache = new Map<string, string>();

/**
 * The words a description shows, lower-cased, for search: from its Markdown,
 * or from an older one's HTML (call #15 stores Markdown; nothing converts the
 * old ones in bulk), never their markup, so "pre", "span" or "**" match
 * nothing (TV-U2 review). A reference's stored text is left out (RF-1).
 */
export function descriptionText(description: string | null | undefined): string {
  if (!description) return "";
  const cached = textCache.get(description);
  if (cached !== undefined) return cached;
  const text = descriptionWords(description).toLowerCase();
  if (textCache.size > 2000) textCache.clear();
  textCache.set(description, text);
  return text;
}

/** A description's words, cached by its source (every Board card reads them on each render). */
const wordsCache = new Map<string, string>();

/**
 * A description's words as it shows them (case kept), for a Board card's
 * preview (AC7.4): no Markdown symbols or HTML tags, a link as its words, a
 * date chip as its date, and a reference left out (it may name an item the
 * reader can't see, RF-1). Either stored form (Markdown, or the old HTML).
 */
export function descriptionWords(description: string | null | undefined): string {
  if (!description) return "";
  const cached = wordsCache.get(description);
  if (cached !== undefined) return cached;
  const words = descriptionPlainText(description);
  if (wordsCache.size > 2000) wordsCache.clear();
  wordsCache.set(description, words);
  return words;
}

/**
 * Whether a task matches the search box: every word of the query appears in
 * its title, the text of its description or the key it was imported under
 * ("ENG-123", TV-D16, AC3.6), ignoring case. The server's `tasks_search`
 * reads the same fields but not quite the same text: it strips the old HTML
 * and reads Markdown as stored, so a word the editor escapes (`a\*b`) or a
 * reference's `moduo://` address can match differently there (call #15; the
 * editor escapes only what Markdown would read, so `file_name` is stored
 * as written). Its own handle under the workspace's `taskKey` counts too
 * (MOD-126), but only whole: "MOD-99", or "mod 99" as two words. Read as
 * text, "mod" would find every task and "7" every number with a 7 in it.
 * An empty query matches everything.
 */
export function taskMatchesQuery(
  task: Pick<Task, "title" | "description" | "importedFrom" | "number">,
  query: string,
  taskKey: string | null = null,
): boolean {
  let words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const handle = taskHandle(taskKey, task.number)?.toLowerCase() ?? null;
  if (handle && taskKey) {
    // The words naming this task's handle are met; the rest read as text.
    const keyWord = taskKey.toLowerCase();
    const numberWord = String(task.number);
    const rest: string[] = [];
    for (let i = 0; i < words.length; i++) {
      if (words[i] === handle) continue;
      if (words[i] === keyWord && words[i + 1] === numberWord) {
        i++;
        continue;
      }
      rest.push(words[i]);
    }
    words = rest;
  }
  const key = task.importedFrom?.key?.toLowerCase() ?? "";
  const haystack = `${task.title.toLowerCase()}\n${descriptionText(task.description)}\n${key}`;
  return words.every((word) => haystack.includes(word));
}

/** What a `#tag` or `@name` in the search box became. */
export type SearchToken = { dimension: "tag" | "assignee"; value: string };

export type SearchTokenContext = {
  tags: ReadonlyArray<{ id: string; name: string }>;
  /** Members in picker order; you are named "You" there (SELF_NAME) and found by `@me`. */
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
  // The app's one tokenizer (spine/grammar.ts, RF-1): the same `#` and `@`
  // words capture and prose read.
  const words = findSigilWords(query, { sigils: ["#", "@"], final });
  let rest = "";
  let last = 0;
  for (const w of words) {
    let value: SearchToken | null = null;
    if (w.sigil === "#") {
      const tag = resolveName(w.word, ctx.tags, (t) => [t.name]);
      if (tag) value = { dimension: "tag", value: tag.id };
    } else {
      const person = resolveName(w.word, ctx.people, (p) =>
        p.isMe ? ["me"] : [p.name, p.name.split(/\s+/)[0] ?? p.name],
      );
      if (person) value = { dimension: "assignee", value: person.userId };
    }
    if (!value) continue;
    tokens.push(value);
    rest += query.slice(last, w.start);
    last = w.end;
  }
  rest += query.slice(last);
  if (final) rest += " ";
  if (tokens.length === 0) return { query, tokens };
  const cleaned = rest.replace(/\s{2,}/g, " ").replace(/^\s+/, "");
  return { query: final ? cleaned.trimEnd() : cleaned, tokens };
}
