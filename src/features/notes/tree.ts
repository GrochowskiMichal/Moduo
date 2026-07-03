/**
 * Pure sidebar tree shaping for Notes v2 (Wave-3 NO-3, AC2/AC12).
 *
 * Sections (DESIGN_BRIEF §2a): Pinned · Inbox · tree · Published · Archive ·
 * Trash. With no "filed" marker in the schema, membership is DERIVED:
 *   - Inbox = live, unarchived ROOT notes with no live children (loose
 *     captures — global ⌘⇧N lands here).
 *   - tree  = live, unarchived root notes WITH children (the organized
 *     hierarchy), descendants nested.
 *   - Archive = self-archived live notes as roots (descendants follow their
 *     ancestor implicitly — the flag lives on the gesture root, so unarchive
 *     is a clean inverse).
 *   - Trash = trashed roots (a trashed note whose parent is live/absent),
 *     trashed descendants nested.
 * Orphans (parent purged/foreign) are treated as roots — never invisible.
 */

import type { Note } from "./model";

export type NoteTreeNode = {
  note: Note;
  children: NoteTreeNode[];
};

export type NoteSections = {
  pinned: Note[];
  inbox: Note[];
  tree: NoteTreeNode[];
  published: Note[];
  archive: NoteTreeNode[];
  trash: NoteTreeNode[];
};

/** Lexicographic fractional-position order (the tasks convention), stable
 * tiebreak on createdAt then id so equal/legacy positions can't jitter. */
export function byPosition(a: Note, b: Note): number {
  if (a.position !== b.position) return a.position < b.position ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
  return a.id < b.id ? -1 : 1;
}

function childrenMap(notes: Note[]): Map<string | null, Note[]> {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const map = new Map<string | null, Note[]>();
  for (const n of notes) {
    // A parent that isn't in the bundle (purged, foreign) = orphan → root.
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  for (const list of map.values()) list.sort(byPosition);
  return map;
}

function buildSubtree(
  root: Note,
  kids: Map<string | null, Note[]>,
  include: (n: Note) => boolean,
  depth = 0,
): NoteTreeNode {
  const children =
    depth >= 100
      ? []
      : (kids.get(root.id) ?? []).filter(include).map((c) => buildSubtree(c, kids, include, depth + 1));
  return { note: root, children };
}

export function buildNoteSections(notes: Note[]): NoteSections {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const live = notes.filter((n) => !n.deletedAt);
  const liveKids = childrenMap(live);
  const isLive = (n: Note) => !n.deletedAt;

  const parentOf = (n: Note): Note | null =>
    n.parentId ? (byId.get(n.parentId) ?? null) : null;

  // Live roots: no parent, or parent gone/trashed (re-rooted view).
  const liveRoots = live.filter((n) => {
    const p = parentOf(n);
    return !p || Boolean(p.deletedAt);
  });

  // Archived-by-ancestry check within the live set.
  const archivedByAncestry = (n: Note): boolean => {
    let cur: Note | null = n;
    let hops = 0;
    while (cur && hops < 100) {
      if (cur.isArchived) return true;
      cur = parentOf(cur);
      if (cur?.deletedAt) break;
      hops++;
    }
    return false;
  };

  const activeRoots = liveRoots.filter((n) => !n.isArchived);
  const inbox: Note[] = [];
  const tree: NoteTreeNode[] = [];
  for (const root of activeRoots) {
    if (archivedByAncestry(root)) continue; // can't happen for roots, guard anyway
    const liveChildren = (liveKids.get(root.id) ?? []).filter(isLive);
    if (liveChildren.length === 0) {
      inbox.push(root);
    } else {
      tree.push(buildSubtree(root, liveKids, isLive));
    }
  }
  inbox.sort(byPosition);

  const pinned = live
    .filter((n) => n.isPinned && !archivedByAncestry(n))
    .sort(byPosition);

  const published = live
    .filter((n) => n.publishedAt && n.publishToken)
    .sort(byPosition);

  // Archive roots = self-archived live notes whose ancestors aren't archived
  // (the gesture root), full live subtree nested.
  const archive = live
    .filter((n) => {
      if (!n.isArchived) return false;
      const p = parentOf(n);
      return !p || p.deletedAt ? true : !archivedByAncestry(p);
    })
    .sort(byPosition)
    .map((root) => buildSubtree(root, liveKids, isLive));

  // Trash roots = trashed notes whose parent is live or absent.
  const trashed = notes.filter((n) => n.deletedAt);
  const trashedKids = childrenMap(trashed);
  const trash = trashed
    .filter((n) => {
      const p = parentOf(n);
      return !p || !p.deletedAt;
    })
    .sort(byPosition)
    .map((root) => buildSubtree(root, trashedKids, (n) => Boolean(n.deletedAt)));

  return { pinned, inbox, tree, published, archive, trash };
}

/** Would moving `noteId` under `newParentId` create a cycle? Mirrors the
 * server guard (notes_op_move) so the client can quietly no-op instead of
 * surfacing an error toast. */
export function wouldCreateCycle(
  notes: Note[],
  noteId: string,
  newParentId: string | null,
): boolean {
  if (!newParentId) return false;
  if (newParentId === noteId) return true;
  const byId = new Map(notes.map((n) => [n.id, n]));
  let cur = byId.get(newParentId) ?? null;
  let hops = 0;
  while (cur && hops < 100) {
    if (cur.id === noteId) return true;
    cur = cur.parentId ? (byId.get(cur.parentId) ?? null) : null;
    hops++;
  }
  return false;
}

/** All live descendant ids of a note (for the trash toast count). */
export function descendantIds(notes: Note[], noteId: string): string[] {
  const kids = childrenMap(notes.filter((n) => !n.deletedAt));
  const out: string[] = [];
  const walk = (id: string, depth: number) => {
    if (depth >= 100) return;
    for (const child of kids.get(id) ?? []) {
      out.push(child.id);
      walk(child.id, depth + 1);
    }
  };
  walk(noteId, 0);
  return out;
}

export type DropZone = "before" | "after" | "into";

/** Resolve a sidebar drop (dragged row → target row + zone) into the move's
 * (parentId, position), or null for a no-op (self, cycle, unknown target).
 * The position math needs the tasks fractional helpers, injected so this
 * module stays dependency-light for tests. */
export function resolveDrop(
  notes: Note[],
  dragId: string,
  targetId: string,
  zone: DropZone,
  pos: {
    endPosition: (existing: Array<{ position: string }>) => string;
    betweenPositions: (a: string | null, b: string | null) => string;
  },
): { parentId: string | null; position: string } | null {
  if (dragId === targetId) return null;
  const byId = new Map(notes.map((n) => [n.id, n]));
  const target = byId.get(targetId);
  if (!target) return null;

  if (zone === "into") {
    if (wouldCreateCycle(notes, dragId, targetId)) return null;
    const children = siblingsOf(notes, targetId).filter((n) => n.id !== dragId);
    return { parentId: targetId, position: pos.endPosition(children) };
  }

  const parentId =
    target.parentId && byId.has(target.parentId) ? target.parentId : null;
  if (wouldCreateCycle(notes, dragId, parentId)) return null;
  const siblings = siblingsOf(notes, parentId).filter((n) => n.id !== dragId);
  const idx = siblings.findIndex((n) => n.id === targetId);
  if (idx === -1) return null;
  const before = zone === "before" ? siblings[idx - 1] : siblings[idx];
  const after = zone === "before" ? siblings[idx] : siblings[idx + 1];
  return {
    parentId,
    position: pos.betweenPositions(before?.position ?? null, after?.position ?? null),
  };
}

/** Siblings of a prospective (parentId) slot, for fractional positioning. */
export function siblingsOf(notes: Note[], parentId: string | null): Note[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  return notes
    .filter((n) => {
      if (n.deletedAt) return false;
      const effParent = n.parentId && byId.has(n.parentId) ? n.parentId : null;
      return effParent === parentId;
    })
    .sort(byPosition);
}
