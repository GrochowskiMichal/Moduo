// Connective-tissue spine — the EntityHub roll-up reducer (block CT-2).
//
// Pure, runtime-free logic: given a focus entity, its links (from one indexed
// `entity_links` read), and the batched registry records for the other ends,
// group the links into the fixed, ordered hub sections with counts, projected
// snippets, and tombstone flags. The component layer renders the result; this
// file is unit-tested in rollup.test.ts (AC6).

import type { EntityLink, EntityRecord, EntityRef, RelationKind } from "@/lib/entity-links";
import { projectSnippet } from "./snippet-projectors";

/** The entity whose hub is being rendered. */
export type HubFocus = EntityRef;

/**
 * The fixed, ordered hub sections (DESIGN_BRIEF flow 5). Linked entities are
 * grouped into these semantic buckets by the *other* endpoint's type; the
 * relation kind is surfaced per row, not as the section key. Order is fixed.
 */
export const HUB_SECTIONS = [
  { key: "open-work", label: "Open work" },
  { key: "money", label: "Money" },
  { key: "conversations", label: "Conversations" },
  { key: "notes", label: "Notes" },
  { key: "other", label: "Other" },
] as const;

export type HubSectionKey = (typeof HUB_SECTIONS)[number]["key"];

/** Map an entity type → its fixed hub section. */
export function sectionForType(entityType: string): HubSectionKey {
  switch (entityType) {
    case "task":
    case "project":
      return "open-work";
    case "payment":
    case "invoice":
      return "money";
    case "email":
    case "comment":
      return "conversations";
    case "note":
      return "notes";
    default:
      return "other";
  }
}

/** How many rows a section shows before collapsing behind "Show all (N)". */
export const SECTION_ROW_CAP = 8;

/** Stable single-entity key (mirrors the SQL `type || ':' || id`). */
export function entityRefKey(ref: EntityRef): string {
  return `${ref.type}:${ref.id}`;
}

/** One projected row in a hub section. */
export type HubRow = {
  link: EntityLink;
  /** The endpoint that is NOT the focus entity. */
  other: EntityRef;
  relationKind: RelationKind;
  /** Primary text — the registry label, or "Deleted [type]" when tombstoned. */
  title: string;
  /** One-line snippet/meta from the owning module's projector, if any. */
  snippet: string | null;
  /** Type-glyph hint (resolved to a lucide icon by the component). */
  icon: string | null;
  tombstoned: boolean;
};

/** One fixed section: heading + the rows that fell into it + the total count. */
export type HubSection = {
  key: HubSectionKey;
  label: string;
  rows: HubRow[];
  /** Total rows in the section (may exceed the displayed slice). */
  count: number;
};

/** The endpoint of `link` that is not `focus` (or null if the link is unrelated). */
export function otherEndpoint(focus: HubFocus, link: EntityLink): EntityRef | null {
  const source: EntityRef = { type: link.sourceType, id: link.sourceId };
  const target: EntityRef = { type: link.targetType, id: link.targetId };
  if (source.type === focus.type && source.id === focus.id) return target;
  if (target.type === focus.type && target.id === focus.id) return source;
  return null;
}

/**
 * Group a focus entity's links into the fixed, ordered hub sections.
 *
 * - `links` come newest-first from one indexed `entity_links` read.
 * - `records` is the batched registry projection for the other endpoints,
 *   keyed by {@link entityRefKey}. A missing record → not-yet-resolved (rare;
 *   the FK guarantees registration, so this only happens mid-sync).
 * - Tombstoned targets (`deletedAt` set) are flagged and titled "Deleted [type]".
 *
 * Empty sections are omitted. Within a section, input (recency) order is kept.
 */
export function rollupSections(
  focus: HubFocus,
  links: EntityLink[],
  records: Map<string, EntityRecord>,
): HubSection[] {
  const buckets = new Map<HubSectionKey, HubRow[]>();

  for (const link of links) {
    const other = otherEndpoint(focus, link);
    if (!other) continue; // defensive: link not touching the focus entity

    const record = records.get(entityRefKey(other)) ?? null;
    const tombstoned = !!record?.deletedAt;
    const projected = projectSnippet(record, other);
    const title = tombstoned ? `Deleted ${other.type}` : projected.title;

    const row: HubRow = {
      link,
      other,
      relationKind: link.relationKind,
      title,
      snippet: tombstoned ? null : projected.snippet,
      icon: projected.icon,
      tombstoned,
    };

    const key = sectionForType(other.type);
    const existing = buckets.get(key);
    if (existing) existing.push(row);
    else buckets.set(key, [row]);
  }

  return HUB_SECTIONS.filter((s) => buckets.has(s.key)).map((s) => {
    const rows = buckets.get(s.key) ?? [];
    return { key: s.key, label: s.label, rows, count: rows.length };
  });
}

/** The rows to display for a section, capped unless expanded. */
export function visibleRows(section: HubSection, expanded: boolean, cap = SECTION_ROW_CAP): HubRow[] {
  return expanded ? section.rows : section.rows.slice(0, cap);
}

/** Whether a section has more rows than the cap (so "Show all (N)" is shown). */
export function isSectionTruncated(section: HubSection, cap = SECTION_ROW_CAP): boolean {
  return section.count > cap;
}

/** Total live + tombstoned rows across all sections (hub header count). */
export function totalRows(sections: HubSection[]): number {
  return sections.reduce((sum, s) => sum + s.count, 0);
}
