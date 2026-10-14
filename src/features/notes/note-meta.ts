/**
 * The note header's meta line and the "Linked from" footer (specs/notes-refresh.md
 * NR-3, AC6). Pure: shaped from the spine hub roll-up the Detail panel already
 * reads, so the header costs no new query and can't disagree with the panel.
 *
 *   Acme · 2 tasks · Thu call · Edited 2 hours ago by Maciej
 *
 * Chips cover every linked non-note entity, in either direction (notes are the
 * footer's job). One entity of a type is named; several collapse to a count
 * that opens the Detail panel.
 */

import type { EntityRef, RelationKind } from "../../lib/entity-links";
import { RELATION_KIND_LABELS } from "../../lib/entity-links";
import { type HubSection, PRIVATE_ITEM_TITLE } from "../spine/rollup";
import { relativeTimeAgo } from "../spine/snippet-format";

/** One meta-line chip: a named entity (opens it) or a count (opens Detail). */
export type MetaChip =
  | { kind: "entity"; key: string; label: string; ref: EntityRef }
  | { kind: "count"; key: string; label: string };

export type NoteMetaLine = {
  chips: MetaChip[];
  /** "Edited 2 hours ago by Maciej", or null when the note has no edit time. */
  edited: string | null;
};

/** At most this many chips; the rest fold into "+N more". */
export const META_CHIP_CAP = 3;

/** Chip order: who it's about, then the work, then the time, then the mail. */
const TYPE_ORDER = ["company", "contact", "task", "project", "event", "email_thread", "email"];

const PLURALS: Record<string, string> = {
  company: "companies",
  contact: "contacts",
  task: "tasks",
  project: "projects",
  event: "events",
  email_thread: "emails",
  email: "emails",
};

function plural(type: string, n: number): string {
  return `${n} ${PLURALS[type] ?? `${type.replace(/_/g, " ")}s`}`;
}

function typeRank(type: string): number {
  const i = TYPE_ORDER.indexOf(type);
  return i === -1 ? TYPE_ORDER.length : i;
}

export function shapeNoteMetaLine(input: {
  sections: HubSection[];
  updatedAt: string | null;
  /** Display name of whoever made the last edit, when known. */
  editedBy?: string | null;
  now: Date;
}): NoteMetaLine {
  const byType = new Map<string, { ref: EntityRef; title: string }[]>();
  const seen = new Set<string>();
  for (const section of input.sections) {
    for (const row of section.rows) {
      if (row.other.type === "note" || row.tombstoned || row.title === PRIVATE_ITEM_TITLE) continue;
      const key = `${row.other.type}:${row.other.id}`;
      if (seen.has(key)) continue; // a pair can hold several link kinds
      seen.add(key);
      const list = byType.get(row.other.type) ?? [];
      list.push({ ref: row.other, title: row.title });
      byType.set(row.other.type, list);
    }
  }

  const all: MetaChip[] = [...byType.entries()]
    .sort(([a], [b]) => typeRank(a) - typeRank(b))
    .map(([type, items]): MetaChip => {
      if (items.length === 1) {
        const only = items[0]!;
        return { kind: "entity", key: `${type}:${only.ref.id}`, label: only.title, ref: only.ref };
      }
      return { kind: "count", key: type, label: plural(type, items.length) };
    });

  const chips = all.slice(0, META_CHIP_CAP);
  if (all.length > META_CHIP_CAP) {
    chips.push({ kind: "count", key: "more", label: `+${all.length - META_CHIP_CAP} more` });
  }

  let edited: string | null = null;
  if (input.updatedAt) {
    const ago = relativeTimeAgo(input.updatedAt, input.now);
    if (ago) {
      const by = input.editedBy?.trim();
      edited = by ? `Edited ${ago} by ${by}` : `Edited ${ago}`;
    }
  }
  return { chips, edited };
}

/** One backlink row in the footer. */
export type BacklinkRow = {
  key: string;
  ref: EntityRef;
  title: string;
  snippet: string | null;
};

/** Backlinks grouped by the relationship they carry, in a stable order. */
export type BacklinkGroup = {
  kind: RelationKind;
  label: string;
  rows: BacklinkRow[];
};

/**
 * "Linked from (n)": everything that links TO this note (the note is the
 * link's target), grouped by relation kind. Deleted sources are left out —
 * the footer is a way out to live things, not an audit trail.
 */
export function shapeBacklinks(noteId: string, sections: HubSection[]): BacklinkGroup[] {
  const groups = new Map<RelationKind, BacklinkRow[]>();
  const seen = new Set<string>();
  for (const section of sections) {
    for (const row of section.rows) {
      const { link } = row;
      if (link.targetType !== "note" || link.targetId !== noteId) continue;
      if (row.tombstoned || row.title === PRIVATE_ITEM_TITLE) continue;
      const key = `${link.relationKind}:${row.other.type}:${row.other.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = groups.get(link.relationKind) ?? [];
      list.push({ key, ref: row.other, title: row.title, snippet: row.snippet });
      groups.set(link.relationKind, list);
    }
  }
  const order = Object.keys(RELATION_KIND_LABELS) as RelationKind[];
  return [...groups.entries()]
    .sort(([a], [b]) => order.indexOf(a) - order.indexOf(b))
    .map(([kind, rows]) => ({ kind, label: RELATION_KIND_LABELS[kind], rows }));
}

/** Total backlinks across groups (the footer's "(n)"). */
export function backlinkCount(groups: BacklinkGroup[]): number {
  return groups.reduce((sum, g) => sum + g.rows.length, 0);
}
