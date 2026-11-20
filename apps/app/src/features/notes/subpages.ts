/**
 * The "Sub-pages" list under a note: its real children from the tree, never
 * hand-made page-rows (MOD-81). Pure so it unit-tests without the shell.
 *
 * Permissions: `notes` is the module's own bundle, which the server already
 * filters per note (`notes_workspace_read` = `can_access('note', id, 'view')`),
 * so a child the viewer cannot see is not in it and cannot appear here. Same
 * rule as the sidebar; no extra query.
 */

import type { Note } from "./model";
import { byPosition } from "./tree";

/** Live, unarchived direct children of `noteId`, in sidebar order. An archived
 * child lives in the Archive section, a trashed one in the Trash. */
export function selectSubpages(notes: readonly Note[], noteId: string): Note[] {
  return notes
    .filter((n) => n.parentId === noteId && !n.deletedAt && !n.isArchived)
    .sort(byPosition);
}

/** A hand-made page row is redundant once the page lists its sub-pages: it
 * points at a child of `ownerId` that the list already shows, or one in the
 * Trash (restoring it brings it back to the list). Rows to anything else (a
 * note moved elsewhere, an archived child, one the viewer can't see) stay as
 * content. */
export function isRedundantPageRow(target: Note | null, ownerId: string): boolean {
  return target?.parentId === ownerId && !target.isArchived;
}
