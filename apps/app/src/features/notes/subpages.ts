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
