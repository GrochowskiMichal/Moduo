// Connective-tissue spine — per-module snippet projectors (block CT-2).
//
// A hub row's one-line snippet is "projected by the owning module". This is the
// extension seam: each module registers a projector keyed by entity type, so a
// task row can read "in progress · due Fri" while a note row reads its excerpt —
// without EntityHub knowing any module's shape.
//
// At CT-2 every projector reads only the central registry record (label + icon),
// which is all the one-query roll-up read has. Richer projections (live task
// status, payment amount) arrive as each module adopts the spine (CT-7+) and
// supplies a projector that closes over its own data; this registry is where
// they plug in. Pure + runtime-free so rollup.ts stays unit-testable.

import type { EntityRecord, EntityRef } from "@/lib/entity-links";

/** The projected snippet for one hub row. */
export type ProjectedSnippet = {
  /** Primary text (usually the registry label). */
  title: string;
  /** Optional one-line secondary text (status, date, excerpt…). */
  snippet: string | null;
  /** Type-glyph hint passed to {@link resolveEntityIcon}. */
  icon: string | null;
};

/** Turns an entity (its registry record + ref) into a row snippet. */
export type SnippetProjector = (record: EntityRecord | null, other: EntityRef) => ProjectedSnippet;

/** Fallback: registry label (or a humanized type) + the type glyph, no snippet. */
export const defaultProjector: SnippetProjector = (record, other) => ({
  title: record?.label?.trim() || `Untitled ${other.type}`,
  snippet: null,
  icon: record?.icon ?? other.type,
});

const PROJECTORS = new Map<string, SnippetProjector>();

/** Register (or override) the snippet projector for an entity type. */
export function registerSnippetProjector(entityType: string, projector: SnippetProjector): void {
  PROJECTORS.set(entityType, projector);
}

/** Project a row snippet, using the type's registered projector or the default. */
export function projectSnippet(record: EntityRecord | null, other: EntityRef): ProjectedSnippet {
  const projector = PROJECTORS.get(other.type) ?? defaultProjector;
  return projector(record, other);
}
