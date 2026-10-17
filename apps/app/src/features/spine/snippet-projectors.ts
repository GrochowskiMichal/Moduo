// Connective-tissue spine — per-module snippet projectors (block CT-2, DF-7).
//
// A hub row's one-line snippet is "projected by the owning module". This is the
// extension seam: each module registers a projector keyed by entity type, so a
// task row can read "In progress · due Fri" while a note row reads "Edited 3 days
// ago" — without EntityHub knowing any module's shape.
//
// The projector reads two inputs: the central registry record (label + icon —
// always present, from the one-query roll-up) and an OPTIONAL per-entity `meta`
// bag the hub hook supplies from a batched live read (a task's status/due, a
// note's touched-at, an event's when). When no meta is supplied — the generic
// `useEntityHub` rail, or a module the hook hasn't enriched — a projector MUST
// degrade to a bare `snippet: null`, so an un-enriched surface renders exactly as
// it did before DF-7. Pure + runtime-free so rollup.ts stays unit-testable
// (snippet-projectors.builtin.ts registers the concrete formatters; snippet-
// format.ts holds their pure formatting).

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

/** Live task state the registry doesn't carry (from `runtime.tasks.list`). */
export type TaskSnippetMeta = {
  kind: "task";
  status: string;
  /** Due timestamp (timestamptz string) or null. */
  dueDate: string | null;
};

/** Live note state (from `runtime.notesV2.listMeta` — the list carries no body). */
export type NoteSnippetMeta = {
  kind: "note";
  updatedAt: string;
  isPinned: boolean;
  isArchived: boolean;
};

/** Live event state (from `runtime.calendar.listModule`). */
export type EventSnippetMeta = {
  kind: "event";
  startsAt: string;
  endsAt: string;
  allDay: boolean;
};

/** Live email state — desktop-only today, so usually absent on web. */
export type EmailSnippetMeta = {
  kind: "email";
  /** A short body preview, when the module can supply one. */
  preview?: string | null;
  /** When the message landed (ISO), for a "Received …" fallback. */
  receivedAt?: string | null;
};

/** The per-entity live bag a hub hook may hand a projector, keyed by type. */
export type HubSnippetMeta =
  | TaskSnippetMeta
  | NoteSnippetMeta
  | EventSnippetMeta
  | EmailSnippetMeta;

/** Context a projector reads beyond the registry record. */
export type SnippetContext = {
  /** The live per-entity bag, or undefined when the surface didn't enrich. */
  meta?: HubSnippetMeta;
  /** Reference "now" for relative phrasing; defaults to the current time. */
  now?: Date;
};

/** Turns an entity (its registry record + ref + optional live meta) into a row snippet. */
export type SnippetProjector = (
  record: EntityRecord | null,
  other: EntityRef,
  ctx?: SnippetContext,
) => ProjectedSnippet;

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
export function projectSnippet(
  record: EntityRecord | null,
  other: EntityRef,
  ctx?: SnippetContext,
): ProjectedSnippet {
  const projector = PROJECTORS.get(other.type) ?? defaultProjector;
  return projector(record, other, ctx);
}
