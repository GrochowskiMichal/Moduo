import { describe, expect, it } from "@rstest/core";

import { bodyOnlyHits, bodySnippet, findByTitle, queryWords } from "./find";
import type { Note } from "./model";

function note(p: Partial<Note> & { id: string }): Note {
  return {
    id: p.id,
    workspaceId: "w",
    createdBy: null,
    parentId: null,
    title: p.title ?? p.id,
    icon: null,
    isPinned: false,
    position: p.position ?? p.id,
    isArchived: p.isArchived ?? false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: "2026-07-04T00:00:00Z",
    updatedAt: "2026-07-04T00:00:00Z",
    deletedAt: p.deletedAt ?? null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: null,
    fullWidth: false,
  };
}

describe("findByTitle", () => {
  const notes = [
    note({ id: "a", title: "Weekly sync, 21 October", position: "a" }),
    note({ id: "b", title: "Pricing thinking", position: "b" }),
    note({ id: "c", title: "Old pricing", position: "c", isArchived: true }),
    note({ id: "d", title: "Pricing draft", position: "d", deletedAt: "2026-07-05T00:00:00Z" }),
    note({ id: "e", title: "Żółw notes", position: "e" }),
  ];

  it("matches every word, case and accents aside", () => {
    expect(findByTitle(notes, "SYNC october").map((n) => n.id)).toEqual(["a"]);
    expect(findByTitle(notes, "zolw").map((n) => n.id)).toEqual(["e"]);
  });

  it("lists live notes before archived ones and never trashed ones", () => {
    expect(findByTitle(notes, "pricing").map((n) => n.id)).toEqual(["b", "c"]);
  });

  it("finds nothing for an empty or one-letter query", () => {
    expect(findByTitle(notes, "  ")).toEqual([]);
    expect(findByTitle(notes, "a")).toEqual([]);
    expect(queryWords("a 21")).toEqual(["21"]);
  });
});

describe("bodySnippet", () => {
  it("cuts around the first matched word and marks it", () => {
    const text = `# Decisions\n\n- Notes ships with sub-pages.\n- Meet moves to beta. The recording pipeline isn't ready.`;
    const s = bodySnippet(text, "recording", 30);
    expect(s?.match).toBe("recording");
    expect(s?.before.startsWith("…")).toBe(true);
    expect(s?.after.endsWith("…")).toBe(false);
    // Blocks are separated, not run together.
    expect(bodySnippet(text, "decisions", 60)?.after).toContain(" · Notes ships");
  });

  it("matches accents the way the title search does", () => {
    expect(bodySnippet("Spotkanie o żółwiach", "zolwiach")?.match).toBe("żółwiach");
  });

  it("falls back to the start when the server matched a form the client can't see", () => {
    expect(bodySnippet("Runs every week", "running")).toEqual({
      before: "",
      match: "",
      after: "Runs every week",
    });
    expect(bodySnippet("", "x")).toBeNull();
  });
});

describe("bodyOnlyHits", () => {
  it("drops notes already found by title and trashed ones", () => {
    const hits = [
      { id: "a", deletedAt: null },
      { id: "b", deletedAt: null },
      { id: "c", deletedAt: "2026-07-05T00:00:00Z" },
    ];
    expect(bodyOnlyHits(hits, [note({ id: "a" })]).map((h) => h.id)).toEqual(["b"]);
  });
});
