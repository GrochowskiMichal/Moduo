/**
 * The note breadcrumb (specs/notes-refresh.md NR-2, AC5) — pure.
 *
 * `Pages › Clients › Acme`: the note's section, then its ancestors, then the
 * note itself. A note in the stored Inbox (or nested under one) starts with
 * `Inbox`; an archived or trashed note starts with `Archive` / `Trash`.
 */

import type { Note } from "../model";
import { displayTitle } from "../title";

export type CrumbSection = "inbox" | "pages" | "archive" | "trash";

export type Crumb =
  | { kind: "section"; section: CrumbSection; label: string }
  | { kind: "note"; id: string; label: string; current: boolean };

const SECTION_LABEL: Record<CrumbSection, string> = {
  inbox: "Inbox",
  pages: "Pages",
  archive: "Archived",
  trash: "Recently deleted",
};

const MAX_DEPTH = 100;

export function buildBreadcrumb(
  notes: Note[],
  noteId: string,
  /** A local draft not yet in `notes` (lazy create): shown as an Untitled leaf. */
  draft?: { id: string; parentId: string | null; toPages?: boolean } | null,
): Crumb[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const self = byId.get(noteId);
  const isDraft = !self && draft?.id === noteId;
  if (!self && !isDraft) return [];

  // Walk up through parents that exist (an orphan's missing parent ends it).
  const chain: Note[] = [];
  let parentId = self ? self.parentId : (draft?.parentId ?? null);
  while (parentId && chain.length < MAX_DEPTH) {
    const parent = byId.get(parentId);
    if (!parent) break;
    // A trashed ancestor of a live note re-roots it (the sidebar shows it so).
    if (parent.deletedAt && !self?.deletedAt) break;
    chain.unshift(parent);
    parentId = parent.parentId;
  }

  const root = chain[0] ?? self ?? null;
  const archived = [...chain, ...(self ? [self] : [])].some((n) => n.isArchived);
  const section: CrumbSection = self?.deletedAt
    ? "trash"
    : archived
      ? "archive"
      : root
        ? root.inInbox
          ? "inbox"
          : "pages"
        : draft?.toPages
          ? "pages" // "+ New page"
          : "inbox"; // a root draft is a capture

  const crumbs: Crumb[] = [{ kind: "section", section, label: SECTION_LABEL[section] }];
  for (const n of chain) {
    crumbs.push({ kind: "note", id: n.id, label: displayTitle(n.title), current: false });
  }
  crumbs.push({
    kind: "note",
    id: noteId,
    label: displayTitle(self?.title ?? ""),
    current: true,
  });
  return crumbs;
}
