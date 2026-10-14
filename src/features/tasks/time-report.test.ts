// TV-D14 · "Add time…", the time report and getting a list out (spec §14,
// AC6.1–6.3, default f; REPLAN 75). The server decides which rows the reader
// sees (supabase/tests/time_report.test.sql); these check what the app makes
// of them.

import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";

import { applyTimeRegion, EMPTY_TIME_REGION } from "../../lib/time-region";
import { makeTask } from "./helpers";
import { projectOverviewText, tasksAsCsv, tasksAsText } from "./list-export";
import type { Task, TaskTimeEntry, TimeReportRow } from "./model";
import { entryEditChange, entryEditLine, entryLine, parseTimeEntry } from "./time-entries";
import {
  csvCell,
  customRangeProblem,
  rangeLabel,
  reportCsv,
  reportFileName,
  reportRange,
  roundUpToQuarter,
  shapeTimeReport,
} from "./time-report";

const THU = new Date(2026, 9, 8, 15, 0); // Thursday Oct 8 2026

beforeEach(() => applyTimeRegion({ ...EMPTY_TIME_REGION, dateOrder: "month_day" }, null));
afterEach(() => applyTimeRegion(EMPTY_TIME_REGION, null));

describe('"Add time…" reads one quick line (AC6.1)', () => {
  it("2h yesterday with a note", () => {
    expect(parseTimeEntry("2h yesterday call with Anna", THU)).toEqual({
      minutes: 120,
      day: "2026-10-07",
      note: "call with Anna",
    });
  });

  it("the day is optional (today), and so is the note", () => {
    expect(parseTimeEntry("45m", THU)).toEqual({ minutes: 45, day: "2026-10-08", note: null });
    expect(parseTimeEntry("1h 30m · Kickoff", THU)).toEqual({
      minutes: 90,
      day: "2026-10-08",
      note: "Kickoff",
    });
  });

  it("a weekday is the last one; a date is taken as it is", () => {
    expect(parseTimeEntry("1h mon", THU)?.day).toBe("2026-10-05");
    expect(parseTimeEntry("1h thursday", THU)?.day).toBe("2026-10-08");
    expect(parseTimeEntry("30m 2026-10-01 audit", THU)).toEqual({
      minutes: 30,
      day: "2026-10-01",
      note: "audit",
    });
  });

  it("needs a length of up to 24 hours, never a day ahead", () => {
    expect(parseTimeEntry("call with Anna", THU)).toBeNull();
    expect(parseTimeEntry("25h", THU)).toBeNull();
    expect(parseTimeEntry("0m", THU)).toBeNull();
    expect(parseTimeEntry("1h 2026-10-09", THU)).toBeNull();
  });
});

describe("editing an entry sends only what changed", () => {
  const focus: TaskTimeEntry = {
    id: "f1",
    taskId: "t1",
    kind: "focus",
    seconds: 90,
    startedAt: "2026-10-08T08:00:00Z",
    endedAt: "2026-10-08T08:01:30Z",
    entryOn: null,
    note: null,
    reason: null,
    runId: null,
    createdAt: "2026-10-08T08:01:30Z",
  };
  const logged: TaskTimeEntry = {
    ...focus,
    id: "m1",
    kind: "manual",
    seconds: 7200,
    startedAt: null,
    endedAt: null,
    entryOn: "2026-10-07",
    note: "Call",
  };

  it("a note on a Focus stretch keeps its seconds, and its weekday words", () => {
    expect(entryEditLine(focus)).toBe("2m");
    expect(entryEditChange(focus, "2m monday standup", THU)).toEqual({ note: "monday standup" });
    expect(entryEditChange(focus, "2m", THU)).toEqual({});
    expect(entryEditChange(focus, "25m", THU)).toEqual({ seconds: 1500 });
  });

  it("a Focus stretch under a minute can still take a note", () => {
    const short = { ...focus, seconds: 20 };
    expect(entryEditLine(short)).toBe("0m");
    expect(entryEditChange(short, "0m quick check", THU)).toEqual({ note: "quick check" });
  });

  it("a logged entry changes its length, day and note one by one", () => {
    expect(entryEditLine(logged)).toBe("2h 2026-10-07 Call");
    expect(entryEditChange(logged, "2h 2026-10-07 Call", THU)).toEqual({});
    expect(entryEditChange(logged, "2h mon Call", THU)).toEqual({ on: "2026-10-05" });
    expect(entryEditChange(logged, "1h 2026-10-07", THU)).toEqual({ seconds: 3600, note: "" });
    expect(entryEditChange(logged, "call", THU)).toBeNull();
  });
});

describe("your entries read as what they are", () => {
  const base: TaskTimeEntry = {
    id: "e1",
    taskId: "t1",
    kind: "manual",
    seconds: 7200,
    startedAt: null,
    endedAt: null,
    entryOn: "2026-10-07",
    note: "Call",
    reason: null,
    runId: null,
    createdAt: "2026-10-08T09:00:00Z",
  };

  it("logged and Focus entries can change; adjustments and give-backs can't", () => {
    expect(entryLine(base, THU)).toMatchObject({
      day: "Yesterday",
      length: "2h",
      label: "Logged",
      editable: true,
    });
    const focus = {
      ...base,
      kind: "focus" as const,
      entryOn: null,
      startedAt: "2026-10-08T08:00:00Z",
    };
    expect(entryLine(focus, THU)).toMatchObject({ label: "Focus", editable: true });
    const giveBack = {
      ...base,
      kind: "adjustment" as const,
      seconds: -180,
      reason: "give_back" as const,
    };
    expect(entryLine(giveBack, THU)).toMatchObject({
      label: "Given back",
      length: "−3m",
      note: "Counted on two devices at once",
      editable: false,
    });
  });
});

function row(over: Partial<TimeReportRow>): TimeReportRow {
  return {
    entryId: over.entryId ?? Math.random().toString(36).slice(2),
    taskId: "t1",
    taskTitle: "Design the logo",
    projectId: "p1",
    projectName: "Acme",
    projectIsInbox: false,
    userId: "me",
    isMine: true,
    day: "2026-10-06",
    seconds: 3600,
    kind: "manual",
    reason: null,
    note: null,
    ...over,
  };
}
const names: Record<string, string> = { me: "Maciej Grzywacz", anna: "Anna Nowak" };
const nameOf = (id: string) => names[id] ?? "Former member";

describe("the report (AC6.2, AC6.3)", () => {
  it("sums by task, nets a give-back out, never shows a line below zero", () => {
    const report = shapeTimeReport(
      [
        row({ seconds: 3600, note: "Sketches" }),
        row({ seconds: 1800, day: "2026-10-07", note: "Sketches" }),
        row({ seconds: -600, kind: "adjustment", reason: "give_back" }),
        row({ taskId: "t2", taskTitle: "Brief", seconds: -60 }),
      ],
      { groupBy: "task", roundToQuarter: false, nameOf },
    );
    expect(report.sections).toHaveLength(1);
    expect(report.sections[0]?.lines).toEqual([
      expect.objectContaining({ title: "Design the logo", seconds: 4800, notes: ["Sketches"] }),
    ]);
    expect(report.totalSeconds).toBe(4800);
    expect(report.showPeople).toBe(false);
  });

  it("by day, each day its own section, in order", () => {
    const report = shapeTimeReport(
      [row({ day: "2026-10-07" }), row({ day: "2026-10-06", seconds: 900 })],
      { groupBy: "day", roundToQuarter: false, nameOf },
    );
    expect(report.sections.map((s) => [s.key, s.seconds])).toEqual([
      ["2026-10-06", 900],
      ["2026-10-07", 3600],
    ]);
    expect(report.sections[0]?.label).toBe("Tue, Oct 6");
  });

  it("rounds each line up to the quarter hour when asked; the total is their sum", () => {
    expect(roundUpToQuarter(0)).toBe(0);
    expect(roundUpToQuarter(60)).toBe(900);
    expect(roundUpToQuarter(900)).toBe(900);
    const report = shapeTimeReport(
      [row({ seconds: 600 }), row({ taskId: "t2", taskTitle: "Brief", seconds: 1000 })],
      { groupBy: "task", roundToQuarter: true, nameOf },
    );
    expect(report.sections[0]?.lines.map((l) => l.seconds)).toEqual([1800, 900]);
    expect(report.totalSeconds).toBe(2700);
  });

  it("says whose time it is once a teammate shares theirs", () => {
    const report = shapeTimeReport(
      [row({}), row({ userId: "anna", isMine: false, seconds: 1800 })],
      { groupBy: "task", roundToQuarter: false, nameOf },
    );
    expect(report.showPeople).toBe(true);
    expect(report.sections[0]?.lines.map((l) => [l.person, l.seconds])).toEqual([
      ["Anna Nowak", 1800],
      ["Maciej Grzywacz", 3600],
    ]);
  });

  it("names a project the reader can't see only as a private one", () => {
    const report = shapeTimeReport([row({ projectName: null, projectId: "p9" })], {
      groupBy: "task",
      roundToQuarter: false,
      nameOf,
    });
    expect(report.sections[0]?.label).toBe("Private project");
  });

  it("exports the same lines as CSV, spreadsheet-safe", () => {
    const report = shapeTimeReport([row({ taskTitle: '=HYPERLINK("x")', note: "a, b" })], {
      groupBy: "task",
      roundToQuarter: false,
      nameOf,
    });
    expect(reportCsv(report, "task").split("\r\n")).toEqual([
      "Project,Task,Hours,Duration,Notes",
      `Acme,"'=HYPERLINK(""x"")",1.00,1h,"a, b"`,
      "Total,,1.00,1h,",
      "",
    ]);
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("@me")).toBe("'@me");
    expect(reportFileName("Acme Inc.", { from: "2026-10-01", to: "2026-10-31" }, "csv")).toBe(
      "time-report-acme-inc-2026-10-01-2026-10-31.csv",
    );
  });

  it("picked dates the report can't take say why", () => {
    expect(customRangeProblem({ from: "2026-10-01", to: "2026-10-31" })).toBeNull();
    expect(customRangeProblem({ from: "2026-10-31", to: "2026-10-01" })).toMatch(/comes after/);
    expect(customRangeProblem({ from: "2025-01-01", to: "2026-10-01" })).toMatch(/up to a year/);
  });

  it("periods follow the week start", () => {
    expect(reportRange("this_week", THU, 1)).toEqual({ from: "2026-10-05", to: "2026-10-11" });
    expect(reportRange("this_week", THU, 0)).toEqual({ from: "2026-10-04", to: "2026-10-10" });
    expect(reportRange("last_week", THU, 1)).toEqual({ from: "2026-09-28", to: "2026-10-04" });
    expect(reportRange("this_month", THU, 1)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(reportRange("last_month", THU, 1)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(reportRange("last_30", THU, 1)).toEqual({ from: "2026-09-09", to: "2026-10-08" });
    expect(rangeLabel({ from: "2026-10-05", to: "2026-10-11" }, THU)).toBe("Oct 5 – Oct 11");
  });
});

describe("getting a list out (default f)", () => {
  const task = (id: string, over: Partial<Task> = {}): Task => ({
    ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
    id,
    ...over,
  });
  const ctx = {
    projectName: (id: string) => (id === "p1" ? "Acme" : "Private project"),
    assigneeName: (id: string | null) => (id === "u1" ? "Anna" : null),
    handleOf: (t: Task) => (t.number ? `MOD-${t.number}` : null),
    now: THU,
  };

  it("Copy as text pastes cleanly, subtasks under their parent", () => {
    const parent = task("Send the quote", {
      number: 7,
      assigneeId: "u1",
      dueDate: new Date(2026, 9, 16).toISOString(),
    });
    const child = task("Draft numbers", { parentId: parent.id, status: "done" });
    expect(tasksAsText([parent, child], ctx, "Acme")).toBe(
      [
        "Acme",
        "",
        "- [ ] Send the quote (MOD-7) · due Oct 16 · Anna",
        "  - [x] Draft numbers",
      ].join("\n"),
    );
  });

  it("Export view as CSV has one row per task", () => {
    const csv = tasksAsCsv([task("A, the first", { number: 1 })], ctx).split("\r\n");
    expect(csv[0]).toBe(
      "ID,Title,Status,Project,Parent,Assignee,Due,Priority,Estimate,Tracked hours,Created,Completed",
    );
    expect(csv[1]?.startsWith('MOD-1,"A, the first",To do,Acme,')).toBe(true);
  });

  it("a project overview copies its state, progress and open tasks", () => {
    const text = projectOverviewText(
      { name: "Acme", status: "active", startsOn: "2026-10-01", targetOn: "2026-10-31" },
      { done: 3, total: 5, open: 2 },
      [task("Open one")],
      ctx,
    );
    expect(text).toBe(
      ["Acme", "Active · Oct 1 → Oct 31", "3 of 5 done · 2 open", "", "- [ ] Open one"].join("\n"),
    );
  });

  it("with its description and Done this month (TV-U16)", () => {
    const text = projectOverviewText(
      { name: "Acme", status: "done" },
      { done: 5, total: 5, open: 0 },
      [],
      ctx,
      {
        description: "Rebrand for the spring launch.\n",
        doneThisMonth: "Done this month · 14 · 22h",
      },
    );
    expect(text).toBe(
      [
        "Acme",
        "Done",
        "5 of 5 done · 0 open",
        "Done this month · 14 · 22h",
        "",
        "Rebrand for the spring launch.",
      ].join("\n"),
    );
  });
});
