// Deep-link routing for the spine's `moduo:entity:open` event (contacts-v3
// fix pack FX-1, AC1). Every linked row, entity-ref chip, and dashboard widget
// dispatches the event; the app-chrome host listener resolves it here and
// navigates. Pure so the route map is unit-testable.
//
// Contact/company get full URL selection (/contacts?type&id — the search
// params the contacts route validates); notes too (/notes?id, Wave-3 NO-3);
// tasks/projects too (/tasks?id, DF-1 — the page selects + scrolls + opens
// detail, and a bucket id scopes the rail). Events carry the id to /calendar
// (?event=, DF-2 — the page navigates to that day + selects + opens detail);
// email threads carry the id to /email (?thread=, DF-2 — desktop selects +
// scrolls the thread list, web scrolls its tissue card). An id-less email open
// (the widget's "open my inbox") still lands on the plain inbox. Unknown types
// return null; the listener shows a quiet "not available yet" toast, never a
// crash.

import type { SpineRuntime } from "./runtime.types.spine";

// Every surface that opens an entity (rows, chips, widgets, the bell in
// notification-center.tsx) dispatches this, never `navigate({ to })`. A test for
// a new target asserts the entity is selected on arrival, not just the route.
export const ENTITY_OPEN_EVENT = "moduo:entity:open";

export type EntityOpenTarget = {
  to: "/contacts" | "/tasks" | "/notes" | "/email" | "/calendar" | "/chat";
  /** URL search params to navigate with (each page's own validated shape). */
  search?: Record<string, string>;
  /** The entity id to mark as an external "take me there" intent, so a page
   * that mirrors its selection into the URL can tell this open apart from its
   * own mirrored id arriving back on refresh/back (DF-1). */
  intentId?: string;
};

// ── deep-link intent (DF-1) ──────────────────────────────────────────────────
// A page that mirrors its selection into the URL can't tell a fresh EXTERNAL
// open (widget row, note chip, notification — "take me there": switch mode,
// clear filters) from its own mirrored id arriving back on refresh or
// back/forward ("restore quietly"). The app-chrome listener marks every
// entity-open navigation here; the target page consumes the mark exactly once.
let pendingIntentId: string | null = null;

export function markEntityOpenIntent(id: string): void {
  pendingIntentId = id || null;
}

/** True when `id` was just navigated to via the entity-open event. One-shot:
 * every call clears the mark, so a stale mark can't outlive the next apply. */
export function takeEntityOpenIntent(id: string): boolean {
  const hit = pendingIntentId !== null && pendingIntentId === id;
  pendingIntentId = null;
  return hit;
}

/** Where in an entity to land, when the link names it (a chat notice names its message). */
export type EntityOpenAt = {
  /** A message in a conversation: the stream loads a window around it. */
  messageId?: string | null;
  /** The chain that message belongs to: it opens beside the stream. */
  chainId?: string | null;
};

export function entityOpenTarget(
  type: string,
  id: string,
  at: EntityOpenAt = {},
): EntityOpenTarget | null {
  // Email: an id-less "open my inbox" (the widget's per-account unread rows) is
  // valid and lands on the plain inbox; an id (a thread's `email_thread` entity
  // id) deep-links to that thread (DF-2). Handled before the id guard so the
  // id-less case isn't swallowed.
  if (type === "email" || type === "email_thread") {
    return id ? { to: "/email", search: { thread: id }, intentId: id } : { to: "/email" };
  }
  if (!id) return null;
  switch (type) {
    case "contact":
      return { to: "/contacts", search: { type: "contact", id }, intentId: id };
    case "company":
      return { to: "/contacts", search: { type: "company", id }, intentId: id };
    case "task":
    case "project":
    case "bucket":
      return { to: "/tasks", search: { id }, intentId: id };
    case "note":
      return { to: "/notes", search: { id }, intentId: id };
    case "event":
      return { to: "/calendar", search: { event: id }, intentId: id };
    // Chat notifications target the conversation (chat.mention / chat.reply / chat.announcement) and
    // land on the message and its chain when the notice names them (AC1.6):
    // `c` the conversation, `m` the message, `t` the chain beside it.
    case "chat_channel": {
      const search: Record<string, string> = { c: id };
      if (at.messageId) search.m = at.messageId;
      if (at.messageId && at.chainId) search.t = at.chainId;
      return { to: "/chat", search, intentId: id };
    }
    default:
      return null;
  }
}

// ── Recent (GS-8) ────────────────────────────────────────────────────────────
// Every entity-open of an item is your open of it: the host listener records it
// for ⌘K's Recent and the personal ranking, under search_all's type names.
// A module's own page (`to`), a settings section and an id-less open are not
// items. Chat joins when it joins search_all (GS-6).
const RECENT_TYPES: Record<string, string> = {
  task: "task",
  project: "bucket",
  bucket: "bucket",
  note: "note",
  contact: "contact",
  company: "company",
  event: "event",
  email: "email_thread",
  email_thread: "email_thread",
};

export function recentRefFor(
  detail: { type?: string; id?: string; to?: string } | null | undefined,
): { type: string; id: string } | null {
  if (!detail || detail.to || !detail.type || !detail.id) return null;
  const type = RECENT_TYPES[detail.type];
  return type ? { type, id: detail.id } : null;
}

/**
 * Record your open of an item (GS-8) from the host listener. Only this app's
 * opens reach the listener, so an agent's never count (Q19). A failed record
 * never gets in the way of the open itself.
 */
export function recordEntityOpen(
  spine: Pick<SpineRuntime, "recordOpen"> | null | undefined,
  workspaceId: string | null | undefined,
  detail: { type?: string; id?: string; to?: string; workspaceId?: string } | null | undefined,
): void {
  const ref = recentRefFor(detail);
  const ws = detail?.workspaceId ?? workspaceId;
  if (!spine || !ref || !ws) return;
  spine.recordOpen({ workspaceId: ws, ...ref }).catch(() => {});
}
