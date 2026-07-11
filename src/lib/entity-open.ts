// Deep-link routing for the spine's `moduo:entity:open` event (contacts-v3
// fix pack FX-1, AC1). Every linked row, entity-ref chip, and dashboard widget
// dispatches the event; the app-chrome host listener resolves it here and
// navigates. Pure so the route map is unit-testable.
//
// Contact/company get full URL selection (/contacts?type&id — the search
// params the contacts route validates); notes too (/notes?id, Wave-3 NO-3);
// tasks/projects too (/tasks?id, DF-1 — the page selects + scrolls + opens
// detail, and a bucket id scopes the rail). Event/email still land on their
// module page (URL selection there is DF-2). Unknown types return null; the
// listener shows a quiet "not available yet" toast, never a crash.

export const ENTITY_OPEN_EVENT = "moduo:entity:open";

export type EntityOpenTarget = {
  to: "/contacts" | "/tasks" | "/notes" | "/email" | "/calendar";
  search?: { type?: "contact" | "company"; id: string };
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

export function entityOpenTarget(type: string, id: string): EntityOpenTarget | null {
  // Email routes to its module page regardless of id — thread selection inside
  // /email isn't URL-held yet (component state, like tasks). So an id-less
  // "open my inbox" (the widget's per-account unread rows) is valid and must be
  // handled BEFORE the id guard below.
  if (type === "email" || type === "email_thread") return { to: "/email" };
  if (!id) return null;
  switch (type) {
    case "contact":
      return { to: "/contacts", search: { type: "contact", id } };
    case "company":
      return { to: "/contacts", search: { type: "company", id } };
    case "task":
    case "project":
      return { to: "/tasks", search: { id } };
    case "note":
      return { to: "/notes", search: { id } };
    case "event":
      return { to: "/calendar" };
    default:
      return null;
  }
}
