import { describe, expect, it } from "@rstest/core";
import type { Note } from "./model";
import { selectSubpages } from "./subpages";

function note(partial: Partial<Note> & { id: string }): Note {
  return {
    workspaceId: "ws1",
    createdBy: "u1",
    parentId: null,
    title: partial.id,
    icon: null,
    isPinned: false,
    position: partial.id,
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
    deletedAt: null,
    ...partial,
    shareMode: partial.shareMode ?? "custom",
    workspaceShared: partial.workspaceShared ?? false,
    inInbox: partial.inInbox ?? null,
    fullWidth: partial.fullWidth ?? false,
  };
}

describe("selectSubpages (MOD-81)", () => {
  it("lists every direct child in sidebar order, not just the first two", () => {
    const notes = [
      note({ id: "p" }),
      ...["c3", "c1", "c5", "c2", "c4"].map((id) => note({ id, parentId: "p" })),
    ];
    expect(selectSubpages(notes, "p").map((n) => n.id)).toEqual(["c1", "c2", "c3", "c4", "c5"]);
  });

  it("leaves out trashed and archived children", () => {
    const notes = [
      note({ id: "p" }),
      note({ id: "live", parentId: "p" }),
      note({ id: "trashed", parentId: "p", deletedAt: "2026-07-02T00:00:00.000Z" }),
      note({ id: "archived", parentId: "p", isArchived: true }),
    ];
    expect(selectSubpages(notes, "p").map((n) => n.id)).toEqual(["live"]);
  });

  it("leaves out grandchildren and other parents' children", () => {
    const notes = [
      note({ id: "p" }),
      note({ id: "kid", parentId: "p" }),
      note({ id: "grandkid", parentId: "kid" }),
      note({ id: "other", parentId: "q" }),
    ];
    expect(selectSubpages(notes, "p").map((n) => n.id)).toEqual(["kid"]);
  });

  it("is empty for a leaf note", () => {
    expect(selectSubpages([note({ id: "p" })], "p")).toEqual([]);
  });
});
