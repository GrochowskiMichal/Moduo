// Notes spine tail (NO-7b) — the pure logic behind the "Notes" right-panel rail
// variant that Contacts + Calendar mount for a focused entity.
//
// Given the spine hub roll-up for some entity (a contact/company/event/task),
// pull the notes linked to it, and shape the create-and-link args for the
// "New linked note" action. Runtime-free so it unit-tests cleanly
// (linked-notes.test.ts, AC8).

import type { EntityLink, EntityRef } from "../../lib/entity-links";
import type { HubSection } from "../spine/rollup";
import { displayTitle } from "./title";

/** One linked-note row in the rail. */
export type LinkedNoteRow = {
  noteId: string;
  /** Registry label, already display-normalized ("Untitled" for a blank note). */
  title: string;
  icon: string | null;
  /** A trashed/purged note renders dimmed and non-navigable. */
  tombstoned: boolean;
  /** The spine link that surfaced this note (for unlink, if ever exposed). */
  link: EntityLink;
};

/**
 * The notes linked to the focus entity, newest-first, de-duplicated by note id.
 *
 * A pair can hold more than one link kind (e.g. `references` + `mentions`), which
 * would list the same note twice; we keep the first occurrence (hub rows arrive
 * recency-ordered, so that's the most recent edge). Reads from the already-shaped
 * hub sections — no extra query.
 */
export function selectLinkedNotes(sections: HubSection[]): LinkedNoteRow[] {
  const rows: LinkedNoteRow[] = [];
  const seen = new Set<string>();
  for (const section of sections) {
    for (const row of section.rows) {
      if (row.other.type !== "note") continue;
      if (seen.has(row.other.id)) continue;
      seen.add(row.other.id);
      rows.push({
        noteId: row.other.id,
        // The hub roll-up already titled the row ("Deleted note" when tombstoned,
        // else the registry label); display-normalize a blank live label.
        title: row.tombstoned ? row.title : displayTitle(row.title),
        icon: row.icon,
        tombstoned: row.tombstoned,
        link: row.link,
      });
    }
  }
  return rows;
}

/** Args for `spine.createLink` to link a freshly-created note to the focus entity. */
export type NewLinkedNoteLinkArgs = {
  source: EntityRef;
  target: EntityRef;
  relationKind: "references";
  origin: "manual";
  targetLabel: string;
};

/**
 * Build the create-link args for "New linked note": the focus entity references
 * the new note. `references` is the generic, always-allowed kind (kind-constraints
 * permits it for every pair); `manual` records the deliberate gesture.
 */
export function newLinkedNoteLinkArgs(
  focus: EntityRef,
  note: { id: string; title?: string | null },
): NewLinkedNoteLinkArgs {
  return {
    source: { type: focus.type, id: focus.id },
    target: { type: "note", id: note.id },
    relationKind: "references",
    origin: "manual",
    targetLabel: displayTitle(note.title ?? ""),
  };
}
