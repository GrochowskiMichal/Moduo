// TV-U8 · Saved views, the pure rules: a row reads back safely, a view is
// `view:<id>` in the sidebar and looks at its place, its Filter and Display
// go through the place's own sanitiser, "Save changes" shows only for a real
// difference, the Views group's order, and onboarding's seeded views (the
// role's, then "Done last week" for everyone, AC4.8) in shapes the server
// keeps.

import { TASK_VIEW_WORD_DIMENSIONS } from "@contracts/vocabularies";
import { describe, expect, it } from "@rstest/core";

import { tasksViewDefaults } from "./display";
import { sanitizeTaskFilters } from "./filters";
import {
  freeViewName,
  newViewPrefs,
  ROLE_SEED_VIEWS,
  samePrefs,
  seedViewsFor,
  shouldSeedViews,
  sidebarViews,
  type TaskView,
  taskViewFromRow,
  viewIdOf,
  viewPlace,
  viewPrefsOf,
  viewScopeOf,
  viewSelection,
} from "./views";

const ROW = {
  id: "11111111-1111-4111-8111-111111111111",
  workspace_id: "w1",
  owner_id: "u1",
  name: "Due this week",
  scope: "all",
  project_id: null,
  filters: [{ dimension: "due", operator: "is", values: ["week"] }],
  display: { layout: "board", rows: "detailed" },
  shared: false,
  position: 2,
  seed: null,
  created_at: "2026-10-13T09:00:00.000Z",
  updated_at: "2026-10-13T09:00:00.000Z",
  deleted_at: null,
};

function view(over: Partial<TaskView> = {}): TaskView {
  return { ...(taskViewFromRow(ROW) as TaskView), ...over };
}

describe("a view's row", () => {
  it("reads into the model", () => {
    const v = taskViewFromRow(ROW);
    expect(v).toMatchObject({
      id: ROW.id,
      ownerId: "u1",
      scope: "all",
      projectId: null,
      shared: false,
      position: 2,
    });
  });

  it("drops a row it can't read: an unknown place, a project view with no project", () => {
    expect(taskViewFromRow({ ...ROW, scope: "today" })).toBeNull();
    expect(taskViewFromRow({ ...ROW, scope: "project", project_id: null })).toBeNull();
    expect(taskViewFromRow({ ...ROW, name: "" })).toBeNull();
    expect(taskViewFromRow(null)).toBeNull();
    // Only a project view keeps a project.
    expect(taskViewFromRow({ ...ROW, project_id: "p1" })?.projectId).toBeNull();
  });
});

describe("the selection and the place", () => {
  it("a view is view:<id> in the sidebar and in Pinned", () => {
    expect(viewSelection("abc")).toBe("view:abc");
    expect(viewIdOf("view:abc")).toBe("abc");
    expect(viewIdOf("abc")).toBeNull();
    expect(viewIdOf("view:")).toBeNull();
    expect(viewIdOf(null)).toBeNull();
  });

  it("looks at All, My tasks, Upcoming or its project", () => {
    expect(viewPlace(view())).toBe("all");
    expect(viewPlace(view({ scope: "mine" }))).toBe("mine");
    expect(viewPlace(view({ scope: "project", projectId: "p1" }))).toBe("p1");
  });

  it("is saved from All, My tasks, Upcoming and a project, nowhere else", () => {
    expect(viewScopeOf("all", ["p1"])).toEqual({ scope: "all", projectId: null });
    expect(viewScopeOf("upcoming", ["p1"])).toEqual({ scope: "upcoming", projectId: null });
    expect(viewScopeOf("p1", ["p1"])).toEqual({ scope: "project", projectId: "p1" });
    for (const place of ["inbox", "today", "wontdo", "archived", "trash", "templates", "p2"]) {
      expect(viewScopeOf(place, ["p1"])).toBeNull();
    }
  });
});

describe("Filter and Display", () => {
  it("read through the place's own sanitiser", () => {
    const prefs = viewPrefsOf(
      view({
        display: { layout: "board", group: "section", rows: "nonsense", properties: ["date"] },
        filters: [
          { dimension: "due", operator: "is", values: ["week"] },
          { dimension: "gone", operator: "is", values: ["x"] },
        ],
      }),
    );
    expect(prefs.layout).toBe("board");
    // Section grouping is a project's; All falls back to its own default.
    expect(prefs.group).toBe(tasksViewDefaults("all").group);
    expect(prefs.rows).toBe("standard");
    expect(prefs.properties).toEqual(["date"]);
    expect(prefs.filters).toEqual([{ dimension: "due", operator: "is", values: ["week"] }]);
  });

  it("a new view starts blank over All: All's defaults, no filter, the role's rows (MOD-142)", () => {
    const blank = newViewPrefs();
    expect(blank).toEqual({ ...tasksViewDefaults("all"), filters: [] });
    expect(newViewPrefs("detailed").rows).toBe("detailed");
  });

  it("a view that remembers no rows takes the role's", () => {
    expect(viewPrefsOf(view({ display: {} }), "detailed").rows).toBe("detailed");
    expect(viewPrefsOf(view({ display: { rows: "standard" } }), "detailed").rows).toBe("standard");
  });

  it("'Save changes' shows only for a real difference (key order doesn't count)", () => {
    const a = viewPrefsOf(view());
    const b = JSON.parse(JSON.stringify({ ...a })) as typeof a;
    const reordered = Object.fromEntries(Object.entries(b).reverse()) as typeof a;
    expect(samePrefs(a, reordered)).toBe(true);
    expect(samePrefs(a, { ...a, layout: "list" })).toBe(false);
    expect(samePrefs(a, { ...a, filters: [] })).toBe(false);
  });

  it("a view saved before Columns opens with its place's columns, unchanged (MOD-128, MOD-136)", () => {
    // Saved before the field: All's columns (Project on), a project's (off).
    const all = viewPrefsOf(view({ display: { rows: "detailed" } }));
    expect(all.detailedColumns).toEqual(["handle", "project", "status", "time", "waiting"]);
    const project = viewPrefsOf(
      view({ scope: "project", projectId: "p1", display: { rows: "detailed" } }),
    );
    expect(project.detailedColumns).toEqual(["handle", "status", "time", "waiting"]);
    // Opening it is no change; switching a column is "Unsaved changes".
    expect(samePrefs(all, viewPrefsOf(view({ display: { rows: "detailed" } })))).toBe(true);
    expect(samePrefs(all, { ...all, detailedColumns: [...all.detailedColumns, "updated"] })).toBe(
      false,
    );
    // A saved switch comes back.
    const saved = viewPrefsOf(view({ display: { detailedColumns: ["updated", "project"] } }));
    expect(saved.detailedColumns).toEqual(["project", "updated"]);
  });
});

describe("the Views group", () => {
  it("yours in your order, then the ones shared with you by name; deleted ones out", () => {
    const list = sidebarViews(
      [
        view({ id: "b", name: "Beta", position: 2 }),
        view({ id: "s2", name: "Zed", ownerId: "u2", shared: true }),
        view({ id: "a", name: "Alpha", position: 1 }),
        view({ id: "s1", name: "Ann", ownerId: "u3", shared: true }),
        view({ id: "x", name: "Gone", position: 0, deletedAt: "2026-10-13T10:00:00.000Z" }),
      ],
      "u1",
    );
    expect(list.map((v) => v.id)).toEqual(["a", "b", "s1", "s2"]);
  });

  it("a new view's name never repeats one", () => {
    const views = [view({ name: "Waiting" }), view({ name: "waiting 2" })];
    expect(freeViewName("Waiting", views)).toBe("Waiting 3");
    expect(freeViewName("Fresh", views)).toBe("Fresh");
    expect(freeViewName("  ", [])).toBe("Untitled view");
  });
});

describe("seeded views (TV-U17's role defaults, AC4.8)", () => {
  it("the role's views, then Done last week for everyone", () => {
    expect(seedViewsFor("pm").map((s) => s.name)).toEqual([
      "Waiting",
      "Due this week",
      "Done last week",
    ]);
    expect(seedViewsFor(null).map((s) => s.name)).toEqual(["Done last week"]);
    // The sidebar already has Upcoming and My tasks: never seeded as views.
    expect(seedViewsFor("student").map((s) => s.name)).toEqual(["Today", "Done last week"]);
    expect(seedViewsFor("developer").map((s) => s.name)).toEqual(["This week", "Done last week"]);
  });

  it("Done last week lists last week's finished tasks, shown even with Completed hidden", () => {
    const done = seedViewsFor(null)[0];
    expect(done.filters).toEqual([
      { dimension: "status", operator: "is", values: ["done"] },
      { dimension: "completed", operator: "is", values: ["last_week"] },
    ]);
    expect(done.display.completed).toBe("all");
  });

  it("every seed is a shape the server keeps and the app reads back unchanged", () => {
    const word = /^[a-z][a-z_]{0,23}$/;
    const all = (Object.keys(ROLE_SEED_VIEWS) as (keyof typeof ROLE_SEED_VIEWS)[]).flatMap((r) =>
      seedViewsFor(r),
    );
    for (const seed of all) {
      expect(sanitizeTaskFilters(seed.filters)).toEqual(seed.filters);
      for (const c of seed.filters) {
        expect((TASK_VIEW_WORD_DIMENSIONS as readonly string[]).includes(c.dimension)).toBe(true);
        for (const v of c.values) expect(word.test(v)).toBe(true);
      }
      for (const v of Object.values(seed.display)) expect(word.test(String(v))).toBe(true);
      expect(seed.seed).toMatch(word);
    }
  });

  it("once per person and workspace, after the preferences and the server answered", () => {
    const ready = {
      prefsReady: true,
      reachedServer: true,
      onboardingDecided: true,
      seededAlready: false,
    };
    expect(shouldSeedViews(ready)).toBe(true);
    expect(shouldSeedViews({ ...ready, prefsReady: false })).toBe(false);
    expect(shouldSeedViews({ ...ready, reachedServer: false })).toBe(false);
    expect(shouldSeedViews({ ...ready, onboardingDecided: false })).toBe(false);
    expect(shouldSeedViews({ ...ready, seededAlready: true })).toBe(false);
  });
});
