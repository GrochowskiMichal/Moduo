/**
 * Pure sidebar sections for the refreshed Notes shell (NR-1, specs/notes-refresh.md).
 *
 * Favorites · Inbox · Pages, plus the Published / Archive / Trash footer.
 * Unlike the classic `buildNoteSections`, Inbox membership is STORED
 * (`notes.in_inbox`), so a note only changes section when someone moves it:
 * adding a first child to an Inbox note keeps it in Inbox (children nest
 * under it there), and trashing that child doesn't push it anywhere.
 *
 * Archive/Trash/Published and the "what is active" rules (live, not archived
 * at any ancestor, re-rooted orphans) reuse the classic builder so the two
 * UIs never disagree on what exists while the switch is live.
 */

import type { Note, NoteFavorite } from "./model";
import { buildNoteSections, byPosition, type NoteTreeNode } from "./tree";

export type SidebarSections = {
  /** The viewer's favorites, in their own order; active notes only. */
  favorites: Note[];
  /** Stored-Inbox roots, newest capture first, children nested. */
  inbox: NoteTreeNode[];
  /** Every other active root, in authored order, children nested. */
  pages: NoteTreeNode[];
  footer: {
    published: Note[];
    archive: NoteTreeNode[];
    trash: NoteTreeNode[];
  };
};

/** Newest capture first; stable on id. */
function byCreatedDesc(a: NoteTreeNode, b: NoteTreeNode): number {
  if (a.note.createdAt !== b.note.createdAt) return a.note.createdAt < b.note.createdAt ? 1 : -1;
  return a.note.id < b.note.id ? -1 : 1;
}

function byFavoriteOrder(a: NoteFavorite, b: NoteFavorite): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.noteId < b.noteId ? -1 : 1;
}

function collectIds(nodes: NoteTreeNode[], into: Set<string>): void {
  for (const node of nodes) {
    into.add(node.note.id);
    collectIds(node.children, into);
  }
}

export function buildSidebarSections(input: {
  notes: Note[];
  favorites: NoteFavorite[];
}): SidebarSections {
  const classic = buildNoteSections(input.notes);

  // Every active root, whatever the classic derivation called it. Classic
  // Inbox roots have no active children by definition.
  const roots: Array<{ node: NoteTreeNode; derivedInbox: boolean }> = [
    ...classic.inbox.map((note) => ({ node: { note, children: [] }, derivedInbox: true })),
    ...classic.tree.map((node) => ({ node, derivedInbox: false })),
  ];

  const inbox: NoteTreeNode[] = [];
  const pages: NoteTreeNode[] = [];
  for (const { node, derivedInbox } of roots) {
    // Pre-migration (`null`) the classic derivation stands in, so the switch
    // shows the same Inbox the day it ships. A re-rooted orphan (its parent
    // is trashed) keeps its stored flag, which is false: it lands in Pages.
    const inInbox = node.note.inInbox ?? derivedInbox;
    (inInbox ? inbox : pages).push(node);
  }
  inbox.sort(byCreatedDesc);
  pages.sort((a, b) => byPosition(a.note, b.note));

  const activeIds = new Set<string>();
  collectIds(inbox, activeIds);
  collectIds(pages, activeIds);
  const byId = new Map(input.notes.map((n) => [n.id, n]));
  const favorites = [...input.favorites]
    .sort(byFavoriteOrder)
    .filter((f) => activeIds.has(f.noteId))
    .map((f) => byId.get(f.noteId) as Note);

  return {
    favorites,
    inbox,
    pages,
    footer: { published: classic.published, archive: classic.archive, trash: classic.trash },
  };
}
