// DF-10 — grouping for the ⌘K command palette's entity search.
//
// `runtime.spine.searchEntities` returns a flat, label-sorted list of registry
// records (the same source the @mention/`/ref` pickers use). The palette shows
// them grouped by kind — tasks / notes / contacts / email / events — in a fixed
// order, so a query reads as one cross-module result list. Pure so the grouping
// is unit-testable without a runtime.

import type { EntityRecord } from "./entity-links";

/** A group of same-kind results rendered under one heading in the palette. */
export type PaletteResultGroup = {
  key: string;
  heading: string;
  items: EntityRecord[];
};

// Fixed display order + which registry `entity_type` slugs fold into each group.
// Only navigable kinds appear — a result the entity-open route map can't resolve
// (payment / invoice / comment / file → `entityOpenTarget` null) would deep-link
// into a "nothing to open yet" toast, so it's dropped from search entirely.
const GROUP_DEFS: ReadonlyArray<{ key: string; heading: string; types: readonly string[] }> = [
  { key: "tasks", heading: "Tasks", types: ["task", "project"] },
  { key: "notes", heading: "Notes", types: ["note"] },
  { key: "contacts", heading: "Contacts", types: ["contact", "company"] },
  { key: "email", heading: "Email", types: ["email", "email_thread"] },
  { key: "events", heading: "Events", types: ["event"] },
];

/** The registry types the palette searches — the union of every group's slugs.
 * Passed to `searchEntities({ types })` so the query never fetches un-navigable
 * kinds. */
export const PALETTE_ENTITY_TYPES: string[] = GROUP_DEFS.flatMap((g) => [...g.types]);

/**
 * Fold a flat search result list into ordered, non-empty groups. Within-group
 * order is preserved from the input (label-sorted by the runtime). Types outside
 * {@link PALETTE_ENTITY_TYPES} are dropped.
 */
export function groupPaletteResults(records: EntityRecord[]): PaletteResultGroup[] {
  return GROUP_DEFS.map((def) => ({
    key: def.key,
    heading: def.heading,
    items: records.filter((r) => def.types.includes(r.type)),
  })).filter((group) => group.items.length > 0);
}
