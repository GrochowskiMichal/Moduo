// DB-5 — deep-link helpers for widget bodies + the frame header. Rows open a
// specific entity (`{type,id}` → the FX-1 route map); the frame header opens the
// whole module (`{to}` → the app-chrome listener navigates directly, no id).

import { ENTITY_OPEN_EVENT } from "@/lib/entity-open";

/**
 * Open a specific entity's hub/page (the same gesture EntityRefChip uses);
 * `workspaceId` opens it in that workspace (a storage alert's Settings → Storage).
 */
export function openEntity(type: string, id: string, workspaceId?: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ENTITY_OPEN_EVENT, {
      detail: workspaceId ? { type, id, workspaceId } : { type, id },
    }),
  );
}

/**
 * Open a module page directly (the widget-header "open" affordance); `search`
 * lands on a place in it (Upcoming's "+n more" opens Tasks' Upcoming).
 */
export function openModuleRoute(to: string, search?: Record<string, string>): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent(ENTITY_OPEN_EVENT, { detail: search ? { to, search } : { to } }),
  );
}
