import { describe, expect, it } from "@rstest/core";

import { betweenPositions, endPosition } from "../../tasks/helpers";
import type { Note } from "../model";
import { buildSidebarSections } from "../sections";
import {
  type DropTarget,
  effectiveDropTarget,
  keyboardReorderIntent,
  resolveDropIntent,
  zoneFromPointer,
} from "./drop-intent";

const pos = { endPosition, betweenPositions };

function note(partial: Partial<Note> & { id: string; position: string }): Note {
  return {
    workspaceId: "ws1",
    createdBy: "u1",
    parentId: null,
    title: partial.id,
    icon: null,
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    deletedAt: null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: false,
    fullWidth: false,
    ...partial,
  };
}

// Inbox: cap (root) with capKid nested.  Pages: p1, p2 (p2 has p2a, p2b).
const notes: Note[] = [
  note({ id: "cap", position: "0000001000", inInbox: true }),
  note({ id: "capKid", position: "0000001000", parentId: "cap" }),
  note({ id: "p1", position: "0000002000" }),
  note({ id: "p2", position: "0000003000" }),
  note({ id: "p2a", position: "0000001000", parentId: "p2" }),
  note({ id: "p2b", position: "0000002000", parentId: "p2" }),
];
const favorites = [
  { noteId: "p1", position: "0000001000", createdAt: "2026-10-01T00:00:00.000Z" },
  { noteId: "p2a", position: "0000002000", createdAt: "2026-10-01T00:00:00.000Z" },
];
const layout = buildSidebarSections({ notes, favorites });
const favoritePositions = new Map(favorites.map((f) => [f.noteId, f.position]));

const drop = (dragId: string, target: DropTarget) =>
  resolveDropIntent({ notes, layout, favoritePositions, dragId, target, pos });

describe("drop intent — sidebar drag (NR-2, AC2/AC4)", () => {
  it("picks before / inside / after from the pointer's place on the row", () => {
    const rect = { top: 100, height: 40 };
    expect(zoneFromPointer(rect, 104)).toBe("before");
    expect(zoneFromPointer(rect, 120)).toBe("into");
    expect(zoneFromPointer(rect, 137)).toBe("after");
    // Favorites can't take children: halves only.
    expect(zoneFromPointer(rect, 118, false)).toBe("before");
    expect(zoneFromPointer(rect, 122, false)).toBe("after");
  });

  it("files an Inbox note into Pages when dropped beside a Pages root", () => {
    const intent = drop("cap", { kind: "row", section: "pages", id: "p1", zone: "after" });
    expect(intent?.kind).toBe("file");
    if (intent?.kind !== "file") return;
    expect(intent.inInbox).toBe(false);
    expect(intent.position! > "0000002000" && intent.position! < "0000003000").toBe(true);
  });

  it("files into Pages (at the end) when dropped on the Pages header", () => {
    const intent = drop("cap", { kind: "section", section: "pages" });
    expect(intent).toMatchObject({ kind: "file", noteId: "cap", inInbox: false });
    if (intent?.kind === "file") expect(intent.position! > "0000003000").toBe(true);
  });

  it("un-files a page back into the Inbox, from a row or the header", () => {
    expect(drop("p1", { kind: "row", section: "inbox", id: "cap", zone: "before" })).toEqual({
      kind: "file",
      noteId: "p1",
      inInbox: true,
    });
    expect(drop("p2a", { kind: "section", section: "inbox" })).toEqual({
      kind: "file",
      noteId: "p2a",
      inInbox: true,
    });
  });

  it("never reorders inside the Inbox (it sorts by capture time)", () => {
    expect(drop("cap", { kind: "section", section: "inbox" })).toBeNull();
  });

  it("beside an Inbox root targets the whole Inbox, never a slot between rows", () => {
    expect(
      effectiveDropTarget({ kind: "row", section: "inbox", id: "cap", zone: "after" }, layout),
    ).toEqual({ kind: "section", section: "inbox" });
    // Into an Inbox note still nests; beside a nested row still orders siblings.
    const into: DropTarget = { kind: "row", section: "inbox", id: "cap", zone: "into" };
    expect(effectiveDropTarget(into, layout)).toBe(into);
    const nested: DropTarget = { kind: "row", section: "inbox", id: "capKid", zone: "before" };
    expect(effectiveDropTarget(nested, layout)).toBe(nested);
    const page: DropTarget = { kind: "row", section: "pages", id: "p1", zone: "after" };
    expect(effectiveDropTarget(page, layout)).toBe(page);
  });

  it("nests into a row, including under an Inbox note", () => {
    expect(drop("p1", { kind: "row", section: "inbox", id: "cap", zone: "into" })).toMatchObject({
      kind: "move",
      noteId: "p1",
      parentId: "cap",
    });
    expect(drop("cap", { kind: "row", section: "pages", id: "p2", zone: "into" })).toMatchObject({
      kind: "move",
      noteId: "cap",
      parentId: "p2",
    });
  });

  it("refuses a drop into the note's own descendant, quietly", () => {
    expect(drop("p2", { kind: "row", section: "pages", id: "p2a", zone: "into" })).toBeNull();
    expect(drop("p2", { kind: "row", section: "pages", id: "p2b", zone: "before" })).toBeNull();
    expect(drop("p2", { kind: "row", section: "pages", id: "p2", zone: "into" })).toBeNull();
  });

  it("is a no-op where the note already sits", () => {
    expect(drop("p1", { kind: "row", section: "pages", id: "p2", zone: "before" })).toBeNull();
    expect(drop("p1", { kind: "section", section: "pages" })).toBeNull();
  });

  it("reorders Pages roots among Pages roots only", () => {
    const intent = drop("p2", { kind: "row", section: "pages", id: "p1", zone: "before" });
    expect(intent).toMatchObject({ kind: "move", noteId: "p2", parentId: null });
    if (intent?.kind === "move") expect(intent.position < "0000002000").toBe(true);
  });

  it("moves a nested note to the top of Pages from the header", () => {
    expect(drop("p2b", { kind: "section", section: "pages" })).toMatchObject({
      kind: "move",
      noteId: "p2b",
      parentId: null,
    });
  });

  it("adds or reorders a favorite in the Favorites section", () => {
    const add = drop("p2", { kind: "row", section: "favorites", id: "p1", zone: "before" });
    expect(add).toMatchObject({ kind: "favorite", noteId: "p2" });
    if (add?.kind === "favorite") expect(add.position < "0000001000").toBe(true);
    const reorder = drop("p2a", { kind: "row", section: "favorites", id: "p1", zone: "before" });
    expect(reorder).toMatchObject({ kind: "favorite", noteId: "p2a" });
    expect(drop("p2a", { kind: "row", section: "favorites", id: "p1", zone: "after" })).toBeNull();
  });

  it("reorders from the keyboard the same way a drag past the neighbour does", () => {
    const up = keyboardReorderIntent({
      notes,
      layout,
      favoritePositions,
      section: "pages",
      noteId: "p2b",
      siblingIds: ["p2a", "p2b"],
      direction: "up",
      pos,
    });
    expect(up).toMatchObject({ kind: "move", noteId: "p2b", parentId: "p2" });
    if (up?.kind === "move") expect(up.position < "0000001000").toBe(true);
    // Already last: nothing to do.
    expect(
      keyboardReorderIntent({
        notes,
        layout,
        favoritePositions,
        section: "pages",
        noteId: "p2b",
        siblingIds: ["p2a", "p2b"],
        direction: "down",
        pos,
      }),
    ).toBeNull();
    // Inbox roots have no manual order.
    expect(
      keyboardReorderIntent({
        notes,
        layout,
        favoritePositions,
        section: "inbox",
        noteId: "cap",
        siblingIds: ["cap"],
        direction: "down",
        pos,
      }),
    ).toBeNull();
  });
});
