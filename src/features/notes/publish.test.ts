import { describe, expect, it } from "vitest";
import type { Note } from "./model";
import {
  buildPublishTree,
  isPublished,
  publishedChildCount,
  selectPublishSubtree,
} from "./publish";

function note(p: Partial<Note> & { id: string }): Note {
  return {
    id: p.id,
    workspaceId: "w",
    createdBy: null,
    parentId: p.parentId ?? null,
    title: p.title ?? p.id,
    icon: null,
    isPinned: false,
    position: p.position ?? p.id,
    isArchived: p.isArchived ?? false,
    publishedAt: p.publishedAt ?? null,
    publishToken: p.publishToken ?? null,
    docVersion: 0,
    createdAt: "2026-07-04T00:00:00Z",
    updatedAt: "2026-07-04T00:00:00Z",
    deletedAt: p.deletedAt ?? null,
  };
}

const published = { publishedAt: "2026-07-04T00:00:00Z", publishToken: "tok" };

describe("publish — subtree selection (AC10)", () => {
  it("scope = the published root + its live descendants, depth-first by position", () => {
    const notes = [
      note({ id: "root", position: "a", ...published }),
      note({ id: "c2", parentId: "root", position: "b" }),
      note({ id: "c1", parentId: "root", position: "a" }),
      note({ id: "g1", parentId: "c1", position: "a" }),
    ];
    const ids = selectPublishSubtree("root", notes).map((n) => n.id);
    expect(ids).toEqual(["root", "c1", "g1", "c2"]);
    expect(publishedChildCount("root", notes)).toBe(3);
  });

  it("excludes a trashed child from the public subtree", () => {
    const notes = [
      note({ id: "root", ...published }),
      note({ id: "live", parentId: "root", position: "a" }),
      note({ id: "gone", parentId: "root", position: "b", deletedAt: "2026-07-04T01:00:00Z" }),
    ];
    expect(selectPublishSubtree("root", notes).map((n) => n.id)).toEqual(["root", "live"]);
  });

  it("excludes an archived child (it has left the tree)", () => {
    const notes = [
      note({ id: "root", ...published }),
      note({ id: "live", parentId: "root", position: "a" }),
      note({ id: "filed", parentId: "root", position: "b", isArchived: true }),
      note({ id: "filed-kid", parentId: "filed", position: "a" }),
    ];
    // The archived branch and everything under it drop out.
    expect(selectPublishSubtree("root", notes).map((n) => n.id)).toEqual(["root", "live"]);
  });

  it("token revocation empties the scope", () => {
    const live = [note({ id: "root", ...published }), note({ id: "c1", parentId: "root" })];
    expect(selectPublishSubtree("root", live)).toHaveLength(2);

    const revoked = [
      note({ id: "root", publishedAt: null, publishToken: null }),
      note({ id: "c1", parentId: "root" }),
    ];
    expect(selectPublishSubtree("root", revoked)).toEqual([]);
    expect(publishedChildCount("root", revoked)).toBe(0);
    expect(buildPublishTree("root", revoked)).toBeNull();
  });

  it("a trashed root is not publishable (empty scope even with a stale token)", () => {
    const notes = [note({ id: "root", ...published, deletedAt: "2026-07-04T02:00:00Z" })];
    expect(isPublished(notes[0])).toBe(false);
    expect(selectPublishSubtree("root", notes)).toEqual([]);
  });

  it("an archived root is not publishable — archiving takes it offline", () => {
    const notes = [note({ id: "root", ...published, isArchived: true })];
    expect(isPublished(notes[0])).toBe(false);
    expect(selectPublishSubtree("root", notes)).toEqual([]);
  });

  it("buildPublishTree nests live descendants for the public nav", () => {
    const notes = [
      note({ id: "root", ...published }),
      note({ id: "c1", parentId: "root", position: "a" }),
      note({ id: "g1", parentId: "c1", position: "a" }),
    ];
    const tree = buildPublishTree("root", notes);
    expect(tree?.note.id).toBe("root");
    expect(tree?.children.map((c) => c.note.id)).toEqual(["c1"]);
    expect(tree?.children[0].children.map((c) => c.note.id)).toEqual(["g1"]);
  });

  it("orphaned deep cycles can't hang the walk (depth-capped)", () => {
    // A pathological self-parent chain shouldn't matter, but guard anyway.
    const notes = [
      note({ id: "root", ...published }),
      note({ id: "loop", parentId: "loop", position: "a" }),
    ];
    expect(() => selectPublishSubtree("root", notes)).not.toThrow();
  });
});
