import { STARTER_TEMPLATES } from "@contracts/vocabularies";
import { describe, expect, it } from "@rstest/core";

import { tasksDisplayDefaults, tasksViewDefaults } from "./display";
import {
  defaultRowsFor,
  firstViewFor,
  ROLE_DEFAULTS,
  shouldSeedWorkspace,
  TASKS_ROLES,
  teachingTaskTitles,
  welcomeDecision,
} from "./onboarding";

describe("ROLE_DEFAULTS (REPLAN §3: per role, only defaults)", () => {
  it("opens each role where the re-plan says", () => {
    const opens = Object.fromEntries(TASKS_ROLES.map((r) => [r, ROLE_DEFAULTS[r].firstView]));
    expect(opens).toEqual({
      student: { kind: "scope", scope: "upcoming" },
      developer: { kind: "scope", scope: "inbox" },
      pm: { kind: "project-board" },
      founder: { kind: "scope", scope: "inbox" },
      client_work: { kind: "scope", scope: "all" },
      creator: { kind: "project-board" },
    });
  });

  it("starts developers on Detailed rows, everyone else on Standard", () => {
    for (const role of TASKS_ROLES) {
      expect(defaultRowsFor(role)).toBe(role === "developer" ? "detailed" : "standard");
    }
    expect(defaultRowsFor(null)).toBe("standard");
  });

  it("offers a starter only where the re-plan names one, and only ones the server ships", () => {
    expect(TASKS_ROLES.map((r) => ROLE_DEFAULTS[r].starter)).toEqual([
      null,
      null,
      "kickoff",
      "monthly_close",
      "client_onboarding",
      "episode",
    ]);
    for (const role of TASKS_ROLES) {
      const starter = ROLE_DEFAULTS[role].starter;
      if (starter) expect(STARTER_TEMPLATES).toContain(starter);
    }
  });
});

describe("firstViewFor", () => {
  it("is a sidebar place, or the first project as its Board", () => {
    expect(firstViewFor("student", ["p1"])).toEqual({ selection: "upcoming", board: false });
    expect(firstViewFor("pm", ["p1", "p2"])).toEqual({ selection: "p1", board: true });
    expect(firstViewFor("creator", ["p9"])).toEqual({ selection: "p9", board: true });
  });

  it("a project's Board with no project is All; no role is the Inbox", () => {
    expect(firstViewFor("pm", [])).toEqual({ selection: "all", board: false });
    expect(firstViewFor(null, ["p1"])).toEqual({ selection: "inbox", board: false });
  });
});

describe("welcomeDecision (once per person, never a flash)", () => {
  const ready = { prefsReady: true, tasksReady: true, welcomeSeen: false, hasOwnTasks: false };

  it("shows for someone new once everything is read", () => {
    expect(welcomeDecision(ready)).toBe("show");
  });

  it("waits for the person's preferences, then for the server's tasks", () => {
    expect(welcomeDecision({ ...ready, prefsReady: false })).toBe("wait");
    expect(welcomeDecision({ ...ready, tasksReady: false })).toBe("wait");
  });

  it("never again once seen, even before the tasks are read", () => {
    expect(welcomeDecision({ ...ready, welcomeSeen: true, tasksReady: false })).toBe("none");
  });

  it("stays out of the way of someone who already made tasks here", () => {
    expect(welcomeDecision({ ...ready, hasOwnTasks: true })).toBe("skip-experienced");
  });
});

describe("shouldSeedWorkspace (seeded once, for whoever creates the workspace)", () => {
  const fresh = {
    isOwner: true,
    canEdit: true,
    tasksReady: true,
    seededAlready: false,
    taskCount: 0,
    projectCount: 0,
  };

  it("seeds a new owner's empty workspace", () => {
    expect(shouldSeedWorkspace(fresh)).toBe(true);
  });

  it("never a prepared or shared workspace, or twice", () => {
    expect(shouldSeedWorkspace({ ...fresh, isOwner: false })).toBe(false);
    expect(shouldSeedWorkspace({ ...fresh, taskCount: 3 })).toBe(false);
    expect(shouldSeedWorkspace({ ...fresh, projectCount: 1 })).toBe(false);
    expect(shouldSeedWorkspace({ ...fresh, seededAlready: true })).toBe(false);
    expect(shouldSeedWorkspace({ ...fresh, canEdit: false })).toBe(false);
    expect(shouldSeedWorkspace({ ...fresh, tasksReady: false })).toBe(false);
  });
});

describe("teachingTaskTitles", () => {
  it("is three gestures to try, with this device's capture keys", () => {
    const titles = teachingTaskTitles("Ctrl Shift K");
    expect(titles).toHaveLength(3);
    expect(titles[0]).toContain("Ctrl Shift K");
    expect(titles.join(" ")).toMatch(/@, # or \//);
    expect(titles[2]).toMatch(/Q .*Focus/);
  });
});

describe("the role's rows in Display (TV-U17)", () => {
  it("a view starts on the role's rows; its other defaults stay the scope's", () => {
    expect(tasksDisplayDefaults("inbox", "detailed").rows).toBe("detailed");
    expect(tasksDisplayDefaults("mine", "detailed")).toMatchObject({
      rows: "detailed",
      group: "status",
    });
    expect(tasksDisplayDefaults("inbox").rows).toBe("standard");
    expect(tasksViewDefaults("upcoming", "list", "detailed")).toMatchObject({
      rows: "detailed",
      group: "date",
      layout: "list",
      filters: [],
    });
  });
});
