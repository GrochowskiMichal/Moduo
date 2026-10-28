// GS-3 — the ⌘K palette's pure model over search_all's rows
// (specs/global-search.md AC5, AC6; Q1–Q3, Q8, Q14, Q15): one Top result, then
// fixed groups of 3 with "Show all N", type chips that narrow, and the title's
// matched word-starts.

import type { SearchAllRow } from "@contracts/search";
import { describe, expect, it } from "@rstest/core";

import {
  buildPaletteView,
  chipForGroup,
  chipTypes,
  PALETTE_GROUPS,
  paletteChips,
  SEARCH_ALL_TYPES,
  searchableQuery,
  showAllLabel,
  stepChip,
  titleSegments,
} from "./palette-search";

function row(type: string, id: string, extra: Partial<SearchAllRow> = {}): SearchAllRow {
  return {
    entity_type: type,
    entity_id: id,
    title: id,
    context: null,
    snippet: null,
    icon: null,
    match: "title",
    rank: 0.75,
    updated_at: "2026-10-28T09:00:00Z",
    archived: false,
    score: 0.5,
    type_total: 1,
    top: false,
    ...extra,
  };
}

const ALL = { tasks: "edit", notes: "edit", contacts: "edit", calendar: "edit", chat: "edit" };

describe("top result, groups, show all, chips", () => {
  it("keeps the fixed group order: Tasks, Projects, Notes, Contacts, Events, Messages, Conversations, Email", () => {
    expect(PALETTE_GROUPS.map((g) => g.heading)).toEqual([
      "Tasks",
      "Projects",
      "Notes",
      "Contacts",
      "Events",
      "Messages",
      "Conversations",
      "Email",
    ]);
  });

  it("puts the Top result above the groups and never repeats it in its group", () => {
    const view = buildPaletteView(
      [
        row("note", "n1", { top: true, score: 0.9, type_total: 2 }),
        row("event", "e1", { type_total: 1 }),
        row("task", "t1", { type_total: 1 }),
        row("note", "n2", { type_total: 2 }),
      ],
      { chip: "all" },
    );
    expect(view.top?.entity_id).toBe("n1");
    expect(view.groups.map((g) => g.key)).toEqual(["tasks", "notes", "events"]);
    expect(view.groups[1].rows.map((r) => r.entity_id)).toEqual(["n2"]);
  });

  it("shows 3 rows per group with a Show all N for the rest, counting the type's total", () => {
    const tasks = Array.from({ length: 8 }, (_, i) => row("task", `t${i}`, { type_total: 12 }));
    const view = buildPaletteView([row("note", "n0", { top: true, type_total: 1 }), ...tasks], {
      chip: "all",
    });
    const group = view.groups.find((g) => g.key === "tasks");
    expect(group?.rows.map((r) => r.entity_id)).toEqual(["t0", "t1", "t2"]);
    expect(group?.total).toBe(12);
    expect(group?.more).toBe(true);
    expect(view.groups.find((g) => g.key === "notes")).toBeUndefined();
  });

  it("offers no Show all when the group shows everything (the Top result counts as shown)", () => {
    const view = buildPaletteView(
      [
        row("task", "t0", { top: true, type_total: 3 }),
        row("task", "t1", { type_total: 3 }),
        row("task", "t2", { type_total: 3 }),
      ],
      { chip: "all" },
    );
    expect(view.groups[0]).toMatchObject({ key: "tasks", total: 3, more: false });
    expect(view.groups[0].rows.map((r) => r.entity_id)).toEqual(["t1", "t2"]);
  });

  it("folds types into their groups: projects (bucket), contacts and companies, email threads", () => {
    const view = buildPaletteView(
      [
        row("bucket", "p1", { top: true }),
        row("project", "p2"),
        row("company", "co1"),
        row("contact", "c1"),
        row("email_thread", "m1"),
      ],
      { chip: "all" },
    );
    expect(view.groups.map((g) => [g.key, g.rows.map((r) => r.entity_id)])).toEqual([
      ["projects", ["p2"]],
      ["contacts", ["co1", "c1"]],
      ["email", ["m1"]],
    ]);
    expect(view.groups.find((g) => g.key === "contacts")?.total).toBe(2);
  });

  it("drops types the palette can't open", () => {
    const view = buildPaletteView(
      [row("payment", "x1", { top: true }), row("comment", "x2"), row("note", "n1")],
      { chip: "all" },
    );
    expect(view.top?.entity_id).toBe("n1");
    expect(view.groups).toEqual([]);
  });

  it("with no row marked top, the first row leads", () => {
    const view = buildPaletteView([row("task", "t1"), row("note", "n1")], { chip: "all" });
    expect(view.top?.entity_id).toBe("t1");
  });

  it("a chip narrows to its groups, lists them in full, and has no Top result", () => {
    const hits = [
      row("note", "n1", { top: true, type_total: 5 }),
      ...Array.from({ length: 5 }, (_, i) => row("task", `t${i}`, { type_total: 5 })),
      row("bucket", "p1"),
    ];
    const view = buildPaletteView(hits, { chip: "tasks" });
    expect(view.top).toBeNull();
    expect(view.groups.map((g) => g.key)).toEqual(["tasks", "projects"]);
    expect(view.groups[0].rows).toHaveLength(5);
    expect(view.groups[0].more).toBe(false);
  });

  it("the local task-ID hit leads, once (AC6)", () => {
    const lead = row("task", "t99", { match: "handle", rank: 1, score: 1, title: "Fix the login" });
    const view = buildPaletteView(
      [row("note", "n1", { top: true }), row("task", "t990"), row("task", "t99")],
      { chip: "all", lead },
    );
    expect(view.top?.entity_id).toBe("t99");
    expect(view.groups.find((g) => g.key === "tasks")?.rows.map((r) => r.entity_id)).toEqual([
      "t990",
    ]);
    expect(view.groups.find((g) => g.key === "notes")?.rows.map((r) => r.entity_id)).toEqual([
      "n1",
    ]);
  });

  it("a lead alone, with no server rows (offline), is the whole view", () => {
    const lead = row("task", "t99", { match: "handle" });
    expect(buildPaletteView([], { chip: "all", lead })).toEqual({ top: lead, groups: [] });
  });

  it("nothing in, nothing out", () => {
    expect(buildPaletteView([], { chip: "all" })).toEqual({ top: null, groups: [] });
  });

  it("Show all names the count, and 50+ at the server's cap", () => {
    expect(showAllLabel(12)).toBe("Show all 12");
    expect(showAllLabel(50)).toBe("Show all 50+");
  });
});

describe("type chips", () => {
  it("lists All, Tasks, Notes, Contacts, Events, Chat, Email for someone who reaches every module", () => {
    expect(paletteChips(ALL).map((c) => c.label)).toEqual([
      "All",
      "Tasks",
      "Notes",
      "Contacts",
      "Events",
      "Chat",
      "Email",
    ]);
  });

  it("never offers a module you can't reach", () => {
    const chips = paletteChips({ ...ALL, notes: "none", calendar: "none", chat: "none" });
    expect(chips.map((c) => c.key)).toEqual(["all", "tasks", "contacts", "email"]);
  });

  it("Tab and Shift+Tab step through the chips, wrapping", () => {
    const chips = paletteChips(ALL);
    expect(stepChip(chips, "all", 1)).toBe("tasks");
    expect(stepChip(chips, "email", 1)).toBe("all");
    expect(stepChip(chips, "all", -1)).toBe("email");
    expect(stepChip(chips, "notes", -1)).toBe("tasks");
    // A chip that disappeared (permissions changed) restarts from All.
    expect(stepChip(paletteChips({ ...ALL, notes: "none" }), "notes", 1)).toBe("tasks");
  });

  it("Show all selects the group's chip", () => {
    expect(chipForGroup("projects")).toBe("tasks");
    expect(chipForGroup("conversations")).toBe("chat");
    expect(chipForGroup("contacts")).toBe("contacts");
  });

  it("each chip asks search_all for its types; Chat asks it nothing until GS-6", () => {
    expect(chipTypes("all")).toEqual(SEARCH_ALL_TYPES);
    expect(chipTypes("tasks")).toEqual(["task", "bucket", "project"]);
    expect(chipTypes("contacts")).toEqual(["contact", "company"]);
    expect(chipTypes("chat")).toEqual([]);
    expect(SEARCH_ALL_TYPES).not.toContain("chat_message");
    expect(SEARCH_ALL_TYPES).not.toContain("chat_channel");
  });
});

describe("which queries are searched", () => {
  it("needs two characters and a word that isn't excluded", () => {
    expect(searchableQuery("")).toBe(false);
    expect(searchableQuery(" k ")).toBe(false);
    expect(searchableQuery("-standup")).toBe(false);
    expect(searchableQuery("-a -b")).toBe(false);
    expect(searchableQuery("ok")).toBe(true);
    expect(searchableQuery("plan -draft")).toBe(true);
    expect(searchableQuery('"q4 plan"')).toBe(true);
  });
});

describe("title highlights", () => {
  const marked = (title: string, query: string) =>
    titleSegments(title, query)
      .filter((s) => s.marked)
      .map((s) => s.text);

  it("marks the word-starts each word of 3+ letters matched", () => {
    expect(marked("Quarterly planning review", "plan rev")).toEqual(["plan", "rev"]);
    expect(titleSegments("Quarterly planning", "plan")).toEqual([
      { text: "Quarterly ", marked: false },
      { text: "plan", marked: true },
      { text: "ning", marked: false },
    ]);
  });

  it("ignores accents both ways, keeping the title's own letters", () => {
    expect(marked("Mój żółw", "zolw")).toEqual(["żółw"]);
    expect(marked("Zolw notes", "ŻÓŁW")).toEqual(["Zolw"]);
  });

  it("marks words of 1–2 letters only whole, and never an excluded word", () => {
    expect(marked("Al Green and Alba", "al")).toEqual(["Al"]);
    expect(marked("Weekly meeting notes", "meeting -weekly")).toEqual(["meeting"]);
  });

  it("marks nothing mid-word or for a typo match", () => {
    expect(marked("Replanning", "plan")).toEqual([]);
    expect(marked("Weekly meeting notes", "meetng")).toEqual([]);
    expect(titleSegments("Plain", "")).toEqual([{ text: "Plain", marked: false }]);
  });

  it("reads quoted phrases as their words", () => {
    expect(marked("Q4 planning day", '"planning day"')).toEqual(["planning", "day"]);
  });
});
