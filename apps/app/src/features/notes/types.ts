/**
 * LEGACY notes types. The Wave-3 rebuild's model lives in ./model.ts —
 * these survive only for:
 *   - `NoteMeta` / `NoteKind`: the legacy dashboard notes-preview widget
 *     (untouched until the dashboard rework) + the redb-import read shape.
 *   - `SlashCommand`: the legacy SlashCommandPlugin (reworked in NO-4).
 */

export type NoteKind = "category" | "folder" | "note";

export type NoteMeta = {
  id: string;
  workspaceId: string;
  ownerId: string;
  parentId: string | null;
  title: string;
  icon: string | null;
  kind: NoteKind;
  tags: string[];
  isPinned: boolean;
  position: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};
