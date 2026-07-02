// Deep-link routing for the spine's `moduo:entity:open` event (contacts-v3
// fix pack FX-1, AC1). Every linked row, entity-ref chip, and dashboard widget
// dispatches the event; the app-chrome host listener resolves it here and
// navigates. Pure so the route map is unit-testable.
//
// Contact/company get full URL selection (/contacts?type&id — the search
// params the contacts route validates); task/note/email land on their module
// page (fine-grained selection inside those modules is their own follow-up —
// they hold selection in component state today). Unknown types return null;
// the listener shows a quiet "not available yet" toast, never a crash.

export const ENTITY_OPEN_EVENT = "moduo:entity:open";

export type EntityOpenTarget = {
  to: "/contacts" | "/tasks" | "/notes" | "/email";
  search?: { type: "contact" | "company"; id: string };
};

export function entityOpenTarget(type: string, id: string): EntityOpenTarget | null {
  if (!id) return null;
  switch (type) {
    case "contact":
      return { to: "/contacts", search: { type: "contact", id } };
    case "company":
      return { to: "/contacts", search: { type: "company", id } };
    case "task":
    case "project":
      return { to: "/tasks" };
    case "note":
      return { to: "/notes" };
    case "email":
      return { to: "/email" };
    default:
      return null;
  }
}
