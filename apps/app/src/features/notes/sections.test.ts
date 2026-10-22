import { describe, expect, it } from "@rstest/core";

import type { Note, NoteFavorite } from "./model";
import { buildSidebarSections } from "./sections";

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
    createdAt: `2026-10-${String((seq % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    updatedAt: "2026-10-13T00:00:00.000Z",
    deletedAt: null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: false,
    fullWidth: false,
    ...partial,
  };
}

function fav(noteId: string, position: string): NoteFavorite {
  return { noteId, position, createdAt: "2026-10-01T00:00:00.000Z" };
}

const ids = (nodes: { note: Note }[]) => nodes.map((n) => n.note.id);

describe("buildSidebarSections — stable sections (NR-1, AC2)", () => {
  it("keeps an Inbox note in Inbox when it gains a child, nesting the child there", () => {
    const notes = [
      note({ id: "capture", inInbox: true }),
      note({ id: "child", parentId: "capture" }),
      note({ id: "page", inInbox: false }),
    ];
    const s = buildSidebarSections({ notes, favorites: [] });
    expect(ids(s.inbox)).toEqual(["capture"]);
    expect(ids(s.inbox[0].children)).toEqual(["child"]);
    expect(ids(s.pages)).toEqual(["page"]);
  });

  it("keeps a childless page in Pages (no jump to Inbox when its last child is trashed)", () => {
    const notes = [
      note({ id: "page", inInbox: false }),
      note({ id: "gone", parentId: "page", deletedAt: "2026-10-12T00:00:00.000Z" }),
    ];
    const s = buildSidebarSections({ notes, favorites: [] });
    expect(ids(s.pages)).toEqual(["page"]);
    expect(s.inbox).toEqual([]);
  });

  it("orders Inbox newest capture first and Pages by authored position", () => {
    const notes = [
      note({ id: "old", inInbox: true, createdAt: "2026-10-01T00:00:00.000Z" }),
      note({ id: "new", inInbox: true, createdAt: "2026-10-10T00:00:00.000Z" }),
      note({ id: "p2", position: "b" }),
      note({ id: "p1", position: "a" }),
    ];
    const s = buildSidebarSections({ notes, favorites: [] });
    expect(ids(s.inbox)).toEqual(["new", "old"]);
    expect(ids(s.pages)).toEqual(["p1", "p2"]);
  });

  it("derives Inbox like classic while the column is undeployed (inInbox null)", () => {
    const notes = [
      note({ id: "loose", inInbox: null }),
      note({ id: "parent", inInbox: null }),
      note({ id: "kid", parentId: "parent", inInbox: null }),
    ];
    const s = buildSidebarSections({ notes, favorites: [] });
    expect(ids(s.inbox)).toEqual(["loose"]);
    expect(ids(s.pages)).toEqual(["parent"]);
  });

  it("puts a re-rooted orphan (parent trashed) in Pages, never Inbox", () => {
    const notes = [
      note({ id: "parent", deletedAt: "2026-10-12T00:00:00.000Z" }),
      note({ id: "orphan", parentId: "parent", inInbox: false }),
    ];
    const s = buildSidebarSections({ notes, favorites: [] });
    expect(ids(s.pages)).toEqual(["orphan"]);
    expect(ids(s.footer.trash)).toEqual(["parent"]);
  });

  it("lists favorites in the user's own order, nested notes included", () => {
    const notes = [note({ id: "a" }), note({ id: "b" }), note({ id: "deep", parentId: "a" })];
    const s = buildSidebarSections({
      notes,
      favorites: [fav("b", "c"), fav("deep", "a"), fav("a", "b")],
    });
    expect(s.favorites.map((n) => n.id)).toEqual(["deep", "a", "b"]);
  });

  it("drops archived (at any ancestor), trashed and unknown favorites", () => {
    const notes = [
      note({ id: "arch", isArchived: true }),
      note({ id: "underArch", parentId: "arch" }),
      note({ id: "trashed", deletedAt: "2026-10-12T00:00:00.000Z" }),
      note({ id: "ok" }),
    ];
    const s = buildSidebarSections({
      notes,
      favorites: [
        fav("arch", "a"),
        fav("underArch", "b"),
        fav("trashed", "c"),
        fav("ghost", "d"),
        fav("ok", "e"),
      ],
    });
    expect(s.favorites.map((n) => n.id)).toEqual(["ok"]);
  });

  it("archived and trashed notes leave Inbox and Pages for the footer", () => {
    const notes = [
      note({ id: "arch", inInbox: true, isArchived: true }),
      note({ id: "bin", inInbox: true, deletedAt: "2026-10-12T00:00:00.000Z" }),
      note({ id: "pub", publishedAt: "2026-10-01T00:00:00.000Z", publishToken: "t" }),
    ];
    const s = buildSidebarSections({ notes, favorites: [] });
    expect(s.inbox).toEqual([]);
    expect(ids(s.pages)).toEqual(["pub"]);
    expect(ids(s.footer.archive)).toEqual(["arch"]);
    expect(ids(s.footer.trash)).toEqual(["bin"]);
    expect(s.footer.published.map((n) => n.id)).toEqual(["pub"]);
  });
});
