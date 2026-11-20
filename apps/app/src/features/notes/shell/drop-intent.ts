/**
 * Sidebar drop intent (specs/notes-refresh.md NR-2, AC2/AC4) — pure.
 *
 * Turns "this row was released over that row / section header" into the one
 * server op that expresses it, against the STORED sections (NR-1):
 *   - into a row            → move (nest; the server clears `in_inbox`)
 *   - beside a nested row   → move among that parent's children
 *   - beside a Pages root   → move among Pages roots, or file an Inbox note
 *                             into Pages at that spot
 *   - beside an Inbox root  → the whole Inbox is the target (it orders by
 *                             capture time, so there is no slot between rows)
 *   - onto a section header → file / un-file (Pages: to the end)
 *   - in Favorites          → add or reorder the viewer's favorite
 * A drop into the dragged note's own subtree, or onto where it already sits,
 * is a quiet null: the target never lights up and nothing is sent.
 */

import type { Note } from "../model";
import type { SidebarSections } from "../sections";
import { type DropZone, resolveDrop, wouldCreateCycle } from "../tree";

export type SidebarSection = "favorites" | "inbox" | "pages";

export type DropTarget =
  | { kind: "row"; section: SidebarSection; id: string; zone: DropZone }
  | { kind: "section"; section: "inbox" | "pages" };

export type DropIntent =
  | { kind: "move"; noteId: string; parentId: string | null; position: string }
  | { kind: "file"; noteId: string; inInbox: boolean; position?: string }
  | { kind: "favorite"; noteId: string; position: string };

export type PositionMath = {
  endPosition: (existing: Array<{ position: string }>) => string;
  betweenPositions: (a: string | null, b: string | null) => string;
};

type Layout = Pick<SidebarSections, "favorites" | "inbox" | "pages">;

/** Top quarter = before, bottom quarter = after, the middle = into. Rows
 * that can't take children (Favorites) split in half instead. */
export function zoneFromPointer(
  rect: { top: number; height: number },
  y: number,
  allowInto = true,
): DropZone {
  if (!allowInto) return y < rect.top + rect.height / 2 ? "before" : "after";
  const quarter = rect.height / 4;
  if (y < rect.top + quarter) return "before";
  if (y > rect.top + rect.height - quarter) return "after";
  return "into";
}

/** What a drop really aims at. Beside an Inbox root there is no slot (the
 * Inbox sorts newest first), so the target is the Inbox itself: it lights
 * whole instead of drawing a line the note would never land on. */
export function effectiveDropTarget(target: DropTarget, layout: Layout): DropTarget {
  if (target.kind !== "row" || target.section !== "inbox" || target.zone === "into") return target;
  return layout.inbox.some((n) => n.note.id === target.id)
    ? { kind: "section", section: "inbox" }
    : target;
}

export function resolveDropIntent(input: {
  notes: Note[];
  layout: Layout;
  /** Favorite positions, keyed by note id (the viewer's own order). */
  favoritePositions: Map<string, string>;
  dragId: string;
  target: DropTarget;
  pos: PositionMath;
}): DropIntent | null {
  const { notes, layout, favoritePositions, dragId, pos } = input;
  const target = effectiveDropTarget(input.target, layout);
  const byId = new Map(notes.map((n) => [n.id, n]));
  const drag = byId.get(dragId);
  if (!drag || drag.deletedAt) return null;

  const inboxRoots = layout.inbox.map((n) => n.note);
  const pageRoots = layout.pages.map((n) => n.note);
  const isInboxRoot = inboxRoots.some((n) => n.id === dragId);
  const isPageRoot = pageRoots.some((n) => n.id === dragId);

  if (target.kind === "section") {
    if (target.section === "inbox") {
      return isInboxRoot ? null : { kind: "file", noteId: dragId, inInbox: true };
    }
    if (isPageRoot) return null;
    const position = pos.endPosition(pageRoots);
    return isInboxRoot
      ? { kind: "file", noteId: dragId, inInbox: false, position }
      : { kind: "move", noteId: dragId, parentId: null, position };
  }

  if (target.section === "favorites") {
    return favoriteIntent(layout.favorites, favoritePositions, dragId, target, pos);
  }

  if (target.id === dragId) return null;
  const over = byId.get(target.id);
  if (!over || over.deletedAt) return null;

  if (target.zone === "into") {
    if (wouldCreateCycle(notes, dragId, target.id)) return null;
    const drop = resolveDrop(notes, dragId, target.id, "into", pos);
    return drop ? { kind: "move", noteId: dragId, ...drop } : null;
  }

  // Beside a nested row: a sibling move under that row's parent. (Beside an
  // Inbox root never gets here: effectiveDropTarget made it the section.)
  if (!pageRoots.some((n) => n.id === over.id)) {
    const drop = resolveDrop(notes, dragId, target.id, target.zone, pos);
    return drop ? { kind: "move", noteId: dragId, ...drop } : null;
  }

  // Beside a Pages root: a slot among Pages roots only.
  const siblings = pageRoots.filter((n) => n.id !== dragId);
  const idx = siblings.findIndex((n) => n.id === over.id);
  if (idx === -1) return null;
  const before = target.zone === "before" ? siblings[idx - 1] : siblings[idx];
  const after = target.zone === "before" ? siblings[idx] : siblings[idx + 1];
  if (
    isPageRoot &&
    (!before || before.position <= drag.position) &&
    (!after || drag.position <= after.position)
  ) {
    return null; // already sits right there
  }
  const position = pos.betweenPositions(before?.position ?? null, after?.position ?? null);
  return isInboxRoot
    ? { kind: "file", noteId: dragId, inInbox: false, position }
    : { kind: "move", noteId: dragId, parentId: null, position };
}

function favoriteIntent(
  favorites: Note[],
  positions: Map<string, string>,
  dragId: string,
  target: Extract<DropTarget, { kind: "row" }>,
  pos: PositionMath,
): DropIntent | null {
  const others = favorites
    .filter((n) => n.id !== dragId)
    .map((n) => ({ id: n.id, position: positions.get(n.id) ?? "" }));
  const idx = others.findIndex((n) => n.id === target.id);
  if (idx === -1) return null;
  const before = target.zone === "before" ? others[idx - 1] : others[idx];
  const after = target.zone === "before" ? others[idx] : others[idx + 1];
  const current = positions.get(dragId);
  if (
    current !== undefined &&
    (!before || before.position <= current) &&
    (!after || current <= after.position)
  ) {
    return null;
  }
  return {
    kind: "favorite",
    noteId: dragId,
    position: pos.betweenPositions(before?.position ?? null, after?.position ?? null),
  };
}

/** ⌥⇧↑ / ⌥⇧↓ on a focused row: the same op a drag past its neighbour makes. */
export function keyboardReorderIntent(input: {
  notes: Note[];
  layout: Layout;
  favoritePositions: Map<string, string>;
  section: SidebarSection;
  noteId: string;
  /** The ids of the row's siblings as shown, in order (itself included). */
  siblingIds: string[];
  direction: "up" | "down";
  pos: PositionMath;
}): DropIntent | null {
  const { siblingIds, noteId, direction, section } = input;
  if (section === "inbox" && !input.notes.find((n) => n.id === noteId)?.parentId) return null;
  const idx = siblingIds.indexOf(noteId);
  const neighbour = direction === "up" ? siblingIds[idx - 1] : siblingIds[idx + 1];
  if (idx === -1 || !neighbour) return null;
  return resolveDropIntent({
    notes: input.notes,
    layout: input.layout,
    favoritePositions: input.favoritePositions,
    dragId: noteId,
    target: { kind: "row", section, id: neighbour, zone: direction === "up" ? "before" : "after" },
    pos: input.pos,
  });
}
