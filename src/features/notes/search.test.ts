import { describe, expect, it } from "vitest";
import { type NoteSearchRow, searchTerms, shapeNoteSearchResults, snippetFor } from "./search";

const rows: NoteSearchRow[] = [
  {
    id: "a",
    title: "Meeting notes",
    bodyText: "we discussed the budget and the roadmap timeline for Q3",
    isArchived: false,
    deletedAt: null,
  },
  {
    id: "b",
    title: "Budget draft",
    bodyText: "numbers to review",
    isArchived: true,
    deletedAt: null,
  },
  {
    id: "c",
    title: "Trashed",
    bodyText: "budget leftovers",
    isArchived: false,
    deletedAt: "2026-01-01T00:00:00Z",
  },
];

describe("shapeNoteSearchResults (AC8)", () => {
  it("excludes trashed rows", () => {
    expect(shapeNoteSearchResults(rows, "budget").some((r) => r.id === "c")).toBe(false);
  });

  it("flags archived, not others", () => {
    const res = shapeNoteSearchResults(rows, "budget");
    expect(res.find((r) => r.id === "b")?.archived).toBe(true);
    expect(res.find((r) => r.id === "a")?.archived).toBe(false);
  });

  it("marks title matches and floats them above body-only matches", () => {
    // "budget" hits b's TITLE and a's BODY → b sorts first.
    const res = shapeNoteSearchResults(rows, "budget");
    expect(res[0].id).toBe("b");
    expect(res.find((r) => r.id === "b")?.titleMatch).toBe(true);
    expect(res.find((r) => r.id === "a")?.titleMatch).toBe(false);
  });

  it("snippet windows the body match", () => {
    const res = shapeNoteSearchResults(rows, "roadmap");
    expect(res.find((r) => r.id === "a")?.snippet.toLowerCase()).toContain("roadmap");
  });
});

describe("snippetFor / searchTerms", () => {
  it("returns a window around the first hit with ellipses", () => {
    const body = "x".repeat(200) + " needle " + "y".repeat(200);
    const s = snippetFor(body, "needle");
    expect(s).toContain("needle");
    expect(s.startsWith("…")).toBe(true);
    expect(s.endsWith("…")).toBe(true);
  });

  it("falls back to the body head for a title-only match", () => {
    expect(snippetFor("short body here", "notinbody")).toBe("short body here");
  });

  it("searchTerms dedupes + lowercases", () => {
    expect(searchTerms("Budget  BUDGET plan")).toEqual(["budget", "plan"]);
  });
});
