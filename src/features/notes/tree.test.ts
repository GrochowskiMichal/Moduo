import { describe, expect, it } from "vitest";
import type { Note } from "./model";
import {
  buildNoteSections,
  byPosition,
  descendantIds,
  siblingsOf,
  wouldCreateCycle,
} from "./tree";

let seq = 0;
function note(partial: Partial<Note> & { id: string }): Note {
  seq += 1;
  return {
    workspaceId: "ws1",
    createdBy: "u1",
    parentId: null,
    title: partial.id,
    icon: null,
    isPinned: false,
    position: String(seq).padStart(10, "0"),
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: `2026-06-0${(seq % 9) + 1}T00:00:00.000Z`,
    updatedAt: "2026-07-01T00:00:00.000Z",
    deletedAt: null,
    ...partial,
  };
}

function chain(depth: number): Note[] {
  const notes: Note[] = [note({ id: "d0" })];
  for (let i = 1; i < depth; i++) {
    notes.push(note({ id: `d${i}`, parentId: `d${i - 1}` }));
  }
  return notes;
}

describe("buildNoteSections (AC2)", () => {
  it("builds an arbitrary-depth tree (7+ levels)", () => {
    const notes = chain(8);
    const { tree, inbox } = buildNoteSections(notes);
    expect(tree).toHaveLength(1);
    let node = tree[0]!;
    let depth = 0;
    while (node.children.length > 0) {
      node = node.children[0]!;
      depth++;
    }
    expect(depth).toBe(7);
    expect(node.note.id).toBe("d7");
    expect(inbox).toHaveLength(0); // the root has children → tree, not inbox
  });

  it("classifies childless roots as Inbox, parented ones under the tree", () => {
    const notes = [
      note({ id: "loose" }),
      note({ id: "org" }),
      note({ id: "child", parentId: "org" }),
    ];
    const s = buildNoteSections(notes);
    expect(s.inbox.map((n) => n.id)).toEqual(["loose"]);
    expect(s.tree.map((t) => t.note.id)).toEqual(["org"]);
  });

  it("keeps sibling order stable under fractional reorder", () => {
    const a = note({ id: "a", position: "0500000000" });
    const b = note({ id: "b", position: "0600000000" });
    const c = note({ id: "c", position: "0700000000" });
    // move c between a and b via a fractional key
    const moved = { ...c, position: "0550000000" };
    const sorted = [b, moved, a].sort(byPosition);
    expect(sorted.map((n) => n.id)).toEqual(["a", "c", "b"]);
  });

  it("treats orphans (purged/foreign parent) as roots, never invisible", () => {
    const s = buildNoteSections([note({ id: "orphan", parentId: "gone" })]);
    expect(s.inbox.map((n) => n.id)).toEqual(["orphan"]);
  });

  it("archive groups the self-archived root with its live subtree", () => {
    const notes = [
      note({ id: "proj", isArchived: true }),
      note({ id: "kid", parentId: "proj" }),
      note({ id: "active" }),
    ];
    const s = buildNoteSections(notes);
    expect(s.archive.map((t) => t.note.id)).toEqual(["proj"]);
    expect(s.archive[0]!.children.map((t) => t.note.id)).toEqual(["kid"]);
    // archived subtree leaves Inbox/tree entirely
    expect(s.inbox.map((n) => n.id)).toEqual(["active"]);
    expect(s.tree).toHaveLength(0);
    // the child follows by ancestry; it is NOT its own archive root
    expect(s.archive.some((t) => t.note.id === "kid")).toBe(false);
  });

  it("trash roots = trashed notes under a live/absent parent, subtree nested (AC12)", () => {
    const notes = [
      note({ id: "keep" }),
      note({ id: "gone", deletedAt: "2026-07-01T00:00:00.000Z" }),
      note({ id: "gone-kid", parentId: "gone", deletedAt: "2026-07-01T00:00:00.000Z" }),
    ];
    const s = buildNoteSections(notes);
    expect(s.trash.map((t) => t.note.id)).toEqual(["gone"]);
    expect(s.trash[0]!.children.map((t) => t.note.id)).toEqual(["gone-kid"]);
    expect(s.inbox.map((n) => n.id)).toEqual(["keep"]);
  });

  it("pinned lists any live pinned note; published lists tokened notes", () => {
    const notes = [
      note({ id: "p", isPinned: true }),
      note({ id: "pub", publishedAt: "2026-07-01T00:00:00.000Z", publishToken: "t" }),
    ];
    const s = buildNoteSections(notes);
    expect(s.pinned.map((n) => n.id)).toEqual(["p"]);
    expect(s.published.map((n) => n.id)).toEqual(["pub"]);
  });
});

describe("wouldCreateCycle (AC2 — the move invariant)", () => {
  const notes = chain(4); // d0 > d1 > d2 > d3

  it("rejects moving a note under its own descendant (any depth)", () => {
    expect(wouldCreateCycle(notes, "d0", "d3")).toBe(true);
    expect(wouldCreateCycle(notes, "d1", "d2")).toBe(true);
    expect(wouldCreateCycle(notes, "d0", "d0")).toBe(true);
  });

  it("allows legal moves", () => {
    expect(wouldCreateCycle(notes, "d3", "d0")).toBe(false);
    expect(wouldCreateCycle(notes, "d2", null)).toBe(false);
  });
});

describe("helpers", () => {
  it("descendantIds walks the live subtree only", () => {
    const notes = [
      ...chain(3),
      note({ id: "trashed-kid", parentId: "d0", deletedAt: "2026-07-01T00:00:00.000Z" }),
    ];
    expect(descendantIds(notes, "d0").sort()).toEqual(["d1", "d2"]);
  });

  it("siblingsOf resolves the effective parent (orphans land at root)", () => {
    const notes = [note({ id: "a" }), note({ id: "orphan", parentId: "gone" })];
    expect(siblingsOf(notes, null).map((n) => n.id)).toEqual(["a", "orphan"]);
  });
});
