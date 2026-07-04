/**
 * Pure publish-subtree selection for Notes v2 (Wave-3 NO-9, AC10).
 *
 * Publishing a note exposes it AND its live descendant pages under one public
 * token link (DESIGN_BRIEF §3e — "subtree included, child pages navigable").
 * These pure selectors give the client the same scope the public edge renderer
 * derives server-side, so the header control can say "includes N nested pages"
 * and a test can pin the invariant without a live DB.
 *
 * Scope rules (mirrored in supabase/functions/notes-public):
 *   - The ROOT must be live (not trashed) AND published (publishedAt +
 *     publishToken). No token → empty scope (revocation empties it).
 *   - Descendants are included only while live AND not archived — a trashed or
 *     archived child leaves the public subtree immediately (edge case in the
 *     spec: "publish a note whose child is later trashed → child disappears").
 *   - Depth-first, position-ordered (the sidebar tree order), depth-capped so
 *     corrupt legacy cycles can never hang the walk.
 */

import type { Note } from "./model";
import { byPosition, type NoteTreeNode } from "./tree";

const MAX_DEPTH = 100;

function liveChildrenMap(notes: Note[]): Map<string | null, Note[]> {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const map = new Map<string | null, Note[]>();
  for (const n of notes) {
    if (n.deletedAt || n.isArchived) continue; // never public
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : null;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(n);
  }
  for (const list of map.values()) list.sort(byPosition);
  return map;
}

/** Is a note eligible to be a published ROOT — live, not archived, and carrying
 * a token? (Archiving clears the token server-side; the `!isArchived` guard is
 * belt-and-suspenders against a stale in-flight state.) */
export function isPublished(note: Note | undefined | null): boolean {
  return Boolean(note && !note.deletedAt && !note.isArchived && note.publishedAt && note.publishToken);
}

/**
 * The published subtree as a flat, depth-first, position-ordered list (root
 * first). Empty when the root isn't found or isn't a live published note — so
 * unpublishing (token cleared) empties the scope.
 */
export function selectPublishSubtree(rootId: string, notes: Note[]): Note[] {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const root = byId.get(rootId);
  if (!isPublished(root)) return [];
  const kids = liveChildrenMap(notes);
  const out: Note[] = [];
  const walk = (note: Note, depth: number) => {
    out.push(note);
    if (depth >= MAX_DEPTH) return;
    for (const child of kids.get(note.id) ?? []) walk(child, depth + 1);
  };
  walk(root!, 0);
  return out;
}

/** The published subtree as a nested nav tree (for the public renderer's
 * sidebar), or null when the root isn't a live published note. */
export function buildPublishTree(rootId: string, notes: Note[]): NoteTreeNode | null {
  const byId = new Map(notes.map((n) => [n.id, n]));
  const root = byId.get(rootId);
  if (!isPublished(root)) return null;
  const kids = liveChildrenMap(notes);
  const build = (note: Note, depth: number): NoteTreeNode => ({
    note,
    children: depth >= MAX_DEPTH ? [] : (kids.get(note.id) ?? []).map((c) => build(c, depth + 1)),
  });
  return build(root!, 0);
}

/** Count of nested pages under a published root (subtree minus the root). */
export function publishedChildCount(rootId: string, notes: Note[]): number {
  return Math.max(0, selectPublishSubtree(rootId, notes).length - 1);
}
