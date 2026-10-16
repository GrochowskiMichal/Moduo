// MOD-131 · which view the Tasks right panel shows: the title's ask for the
// project's overview is only a look, so the panel goes back to the view it
// remembers once the ask ends (the cursor or the place moves, a task is
// clicked, a view is picked), never staying on Project for the next task.

import { describe, expect, it } from "@rstest/core";

import {
  activePanelView,
  askedProjectFor,
  IN_FLIGHT_PANEL_VIEW,
  NO_DATE_PANEL_VIEW,
  type ProjectAsk,
  panelTaskOf,
  panelTitleOf,
} from "./panel-views";

const QUIET = {
  asked: false,
  multi: false,
  remembered: "details",
  noDateShown: false,
  projectInstead: false,
};

describe("askedProjectFor: the title's ask stands until the cursor or the place moves", () => {
  const ask: ProjectAsk = { projectId: "p1", taskId: "t1", place: "p1" };

  it("stands while the cursor and the place stay", () => {
    expect(askedProjectFor(ask, "t1", "p1")).toBe("p1");
  });

  it("ends when the cursor moves, or the place does", () => {
    expect(askedProjectFor(ask, "t2", "p1")).toBeNull();
    expect(askedProjectFor(ask, null, "p1")).toBeNull();
    expect(askedProjectFor(ask, "t1", "p2")).toBeNull();
  });

  it("asked with nothing selected, it stands until something is", () => {
    const none: ProjectAsk = { ...ask, taskId: null };
    expect(askedProjectFor(none, null, "p1")).toBe("p1");
    expect(askedProjectFor(none, "t1", "p1")).toBeNull();
  });

  it("no ask, no project", () => {
    expect(askedProjectFor(null, "t1", "p1")).toBeNull();
  });
});

describe("activePanelView", () => {
  it("shows the remembered view by default", () => {
    expect(activePanelView(QUIET)).toBe("details");
    expect(activePanelView({ ...QUIET, remembered: IN_FLIGHT_PANEL_VIEW })).toBe(
      IN_FLIGHT_PANEL_VIEW,
    );
  });

  it("the title's ask shows Project over every other view, a bulk panel too", () => {
    expect(activePanelView({ ...QUIET, asked: true })).toBe("project");
    expect(activePanelView({ ...QUIET, asked: true, multi: true })).toBe("project");
    expect(
      activePanelView({
        ...QUIET,
        asked: true,
        remembered: NO_DATE_PANEL_VIEW,
        noDateShown: true,
      }),
    ).toBe("project");
  });

  it("a multi-selection shows Details (its bulk panel), even over Project", () => {
    expect(activePanelView({ ...QUIET, multi: true, remembered: "project" })).toBe("details");
    expect(activePanelView({ ...QUIET, multi: true, projectInstead: true })).toBe("details");
  });

  it("No date stays open beside the Timeline, and only there", () => {
    const noDate = { ...QUIET, remembered: NO_DATE_PANEL_VIEW };
    expect(activePanelView({ ...noDate, noDateShown: true })).toBe(NO_DATE_PANEL_VIEW);
    expect(activePanelView({ ...noDate, noDateShown: true, projectInstead: true })).toBe(
      NO_DATE_PANEL_VIEW,
    );
  });

  it("nothing selected inside a project (or a task in the centre) shows Project", () => {
    expect(activePanelView({ ...QUIET, projectInstead: true })).toBe("project");
  });
});

// The page's moves, played through the two rules: what the person sees.
describe("the panel after the title's ask (MOD-131)", () => {
  type Page = { ask: ProjectAsk | null; remembered: string; cursor: string | null };
  const place = "p1";
  const shown = (page: Page) =>
    activePanelView({
      ...QUIET,
      asked: askedProjectFor(page.ask, page.cursor, place) !== null,
      remembered: page.remembered,
    });
  // The title: an ask, the remembered view left alone.
  const clickTitle = (page: Page): Page => ({
    ...page,
    ask: { projectId: "p1", taskId: page.cursor, place },
  });
  // A click on a task ends the ask, the selected task's too.
  const clickTask = (page: Page, id: string): Page => ({ ...page, ask: null, cursor: id });
  // A pick from the panel's menu ends the ask and is remembered. The panel
  // reports only a pick of a view other than the one showing, so Project
  // can't be picked while the ask shows it (that pick changes nothing).
  const pick = (page: Page, view: string): Page => {
    if (view === shown(page)) return page;
    return { ...page, ask: null, remembered: view };
  };

  const start: Page = { ask: null, remembered: "details", cursor: "t1" };

  it("the title shows Project; the next task clicked shows its Details", () => {
    const asked = clickTitle(start);
    expect(shown(asked)).toBe("project");
    expect(shown(clickTask(asked, "t2"))).toBe("details");
  });

  it("a click on the task already selected shows its Details again", () => {
    const asked = clickTitle(start);
    expect(shown(clickTask(asked, "t1"))).toBe("details");
  });

  it("the keys moving the cursor end the ask as well", () => {
    const asked = clickTitle(start);
    expect(shown({ ...asked, cursor: "t2" })).toBe("details");
  });

  it("Project picked from the panel's menu is remembered for every task after", () => {
    const picked = pick(start, "project");
    expect(shown(picked)).toBe("project");
    expect(shown(clickTask(picked, "t2"))).toBe("project");
    // The title's ask on top changes nothing about it.
    expect(shown(clickTask(clickTitle(picked), "t1"))).toBe("project");
  });

  it("Project picked while the ask already shows it stays a look", () => {
    const asked = clickTitle(start);
    expect(shown(clickTask(pick(asked, "project"), "t2"))).toBe("details");
  });

  it("another view picked while the ask stands shows at once, and stays", () => {
    const picked = pick(clickTitle(start), IN_FLIGHT_PANEL_VIEW);
    expect(shown(picked)).toBe(IN_FLIGHT_PANEL_VIEW);
    expect(shown(clickTask(picked, "t2"))).toBe(IN_FLIGHT_PANEL_VIEW);
  });
});

describe("the task the panel shows, with every List group folded (MOD-123)", () => {
  const task = { id: "t1" };

  it("is the selected task while the List shows rows, or isn't in the centre", () => {
    expect(panelTaskOf(task, { inCentre: true, showsNothing: false })).toBe(task);
    expect(panelTaskOf(task, { inCentre: false, showsNothing: true })).toBe(task);
  });

  it("is none while the List shows no row, so the panel shows the project", () => {
    const shownTask = panelTaskOf(task, { inCentre: true, showsNothing: true });
    expect(shownTask).toBeNull();
    // Inside a project, nothing in the panel is the project's overview.
    expect(activePanelView({ ...QUIET, projectInstead: shownTask === null })).toBe("project");
  });
});

describe("the title row on a multi-selection (MOD-109)", () => {
  it('reads "4 tasks" on Details while several are selected', () => {
    expect(panelTitleOf("details", 4)).toBe("4 tasks");
    expect(panelTitleOf("details", 2)).toBe("2 tasks");
  });

  it("is the view's own name otherwise", () => {
    expect(panelTitleOf("details", 1)).toBeUndefined();
    expect(panelTitleOf("details", 0)).toBeUndefined();
    // The title's ask shows Project over a selection: it says Project.
    expect(panelTitleOf("project", 4)).toBeUndefined();
  });
});
