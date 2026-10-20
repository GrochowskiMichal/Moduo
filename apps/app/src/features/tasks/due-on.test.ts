// A due date edit keeps `dueOn` (the day it stands for on this device, TV-D9)
// in step, and the readers that fall back from `dueOn` to `dueDate` use the
// local day, never the instant's UTC day.

import { describe, expect, it } from "@rstest/core";

import { withDueOn } from "../../lib/task-rows";
import { makeTask } from "./helpers";
import { tasksAsCsv } from "./list-export";
import type { Task } from "./model";

// Local midnight: in any zone east of UTC its UTC day is the day before.
const localMidnight = (y: number, m: number, d: number) => new Date(y, m - 1, d).toISOString();

describe("withDueOn", () => {
  it("a single due-date edit carries the local day", () => {
    const dueDate = localMidnight(2026, 10, 21);
    expect(withDueOn({ dueDate })).toEqual({ dueDate, dueOn: "2026-10-21" });
  });

  it("clearing the date clears the day", () => {
    expect(withDueOn({ dueDate: null, dueTime: null })).toEqual({
      dueDate: null,
      dueTime: null,
      dueOn: null,
    });
  });

  it("leaves a patch without a due date, or with its own day, alone", () => {
    const title: Partial<Task> = { title: "x" };
    expect(withDueOn(title)).toBe(title);
    const occurrence = { dueDate: localMidnight(2026, 10, 21), dueOn: "2026-10-21" };
    expect(withDueOn(occurrence)).toBe(occurrence);
  });
});

describe("list export", () => {
  it("a task without dueOn exports its due date's local day", () => {
    const task: Task = {
      ...makeTask({ workspaceId: "w", bucketId: "p1", title: "Ship", position: "a" }),
      id: "t1",
      dueDate: localMidnight(2026, 10, 21),
      dueOn: null,
      createdAt: localMidnight(2026, 10, 1),
    };
    const csv = tasksAsCsv([task], {
      projectName: () => "Project",
      assigneeName: () => null,
    });
    const row = csv.split("\n")[1] ?? "";
    expect(row).toContain("2026-10-21");
    expect(row).toContain("2026-10-01");
  });
});
