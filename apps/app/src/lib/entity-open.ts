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
  /** A note opened from a body hit: the query to land on and highlight (GS-10). */
  highlight?: string;
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

// ── landing on a search match (GS-10, specs/global-search.md Q16) ────────────
// A note opened from a body hit (⌘K or the Notes sidebar search) carries the
// query; the note's editor scrolls to the first match and highlights it until
// a click or a key. One pending highlight at a time, kept out of the URL (a
// refresh lands at the top, as any reopen does), read by the editor of that
// note only and cleared by it.
let pendingHighlight: { id: string; query: string } | null = null;
const highlightListeners = new Set<() => void>();

function setPendingHighlight(next: { id: string; query: string } | null): void {
  if (next?.id === pendingHighlight?.id && next?.query === pendingHighlight?.query) return;
  pendingHighlight = next;
  for (const listener of highlightListeners) listener();
}

/** Open note `id` at `query`'s first match; a blank query clears the mark. */
export function markEntityOpenHighlight(id: string, query: string): void {
  const q = query.trim();
  setPendingHighlight(id && q ? { id, query: q } : null);
}

/** The query note `id` should land on, or null. Reading never clears it. */
export function entityOpenHighlight(id: string): string | null {
  return pendingHighlight?.id === id ? pendingHighlight.query : null;
}

/** Drop the pending highlight (only note `id`'s, when given). */
export function clearEntityOpenHighlight(id?: string): void {
  if (id === undefined || pendingHighlight?.id === id) setPendingHighlight(null);
}

export function subscribeEntityOpenHighlight(listener: () => void): () => void {
  highlightListeners.add(listener);
  return () => {
    highlightListeners.delete(listener);
  };
}

/** Where in an entity to land, when the link names it (a chat notice names its message). */
export type EntityOpenAt = {
  /** A message in a conversation: the stream loads a window around it. */
  messageId?: string | null;
  /** The chain that message belongs to: it opens beside the stream. */
  chainId?: string | null;
  /** The search that found it: a note lands on its first match (GS-10). */
  query?: string | null;
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
    case "note": {
      const highlight = at.query?.trim();
      return { to: "/notes", search: { id }, intentId: id, ...(highlight ? { highlight } : {}) };
    }
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
