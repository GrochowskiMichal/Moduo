// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field (regression test): the
// Mail Today panel lists "tasks due today" by the derived local day `dueOn`, falling
// back to the local day of the instant `dueDate` (`isDueOn`, panels/panel-wiring.ts),
// never by comparing the instant with the day "YYYY-MM-DD" or by its UTC day. The
// hunt's proof failed only because its mock lacked `useTaskCommands` (added by MI-*);
// the panel already read `dueOn`. Zone-independent: the fallback cases use 00:30 and
// 23:30 local, so a UTC-day reading fails in any zone but UTC.
// Run: bun run --cwd apps/app test src/features/email/hooks/use-mail-page-wiring.509-4.test.ts

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { renderHook } from "@testing-library/react";

import { dueOnToLocalInstant } from "../../../lib/task-rows";
import { makeTask } from "../../tasks/helpers";
import type { Task } from "../../tasks/model";
import { localDate } from "../ui/mail-page-wiring";

const fake = rs.hoisted(() => ({
  auth: { runtime: null, userId: null },
  workspace: { selectedWorkspaceId: "w", modulePermissions: { calendar: "none" } },
  calendar: { events: [] },
  tissue: { tissueRefs: [] },
  commands: { patchTask: async () => {} },
  data: { inbox: null, liveTasks: [] as unknown[] },
}));

rs.mock("@/providers/auth-provider", () => ({ useAuth: () => fake.auth }));
rs.mock("@/providers/workspace-provider", () => ({ useWorkspace: () => fake.workspace }));
rs.mock("../../calendar/hooks/use-calendar-module", () => ({
  useCalendarModule: () => fake.calendar,
}));
rs.mock("../../tasks/tasks-context", () => ({
  useTasksSelector: (pick: (d: typeof fake.data) => unknown) => pick(fake.data),
  useTaskCommands: () => fake.commands,
}));
rs.mock("./use-email-tissue", () => ({ useEmailTissue: () => fake.tissue }));

import { useMailPageWiring } from "./use-mail-page-wiring";

const task = (id: string, fields: Partial<Task>): Task => ({
  ...makeTask({ workspaceId: "w", bucketId: "inbox", title: id, position: "a" }),
  id,
  ...fields,
});

/** Today's local wall clock at h:m, as an instant. */
const todayAt = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const listed = () => {
  const { result } = renderHook(() => useMailPageWiring());
  return (result.current.todayTasks ?? []).map((t) => t.id);
};

afterEach(() => {
  fake.data.liveTasks = [];
});

describe("HV-15 variant 509-4: Mail's Today panel lists the tasks due today", () => {
  it("a task due today (as the store holds it) is in todayTasks", () => {
    const today = localDate(Date.now());
    // As the Tasks store reads a row (rowToTask): the instant of local midnight + the day.
    fake.data.liveTasks = [
      {
        ...task("t1", { title: "Reply to Anna" }),
        dueDate: dueOnToLocalInstant(today),
        dueOn: today,
      },
    ];
    const { result } = renderHook(() => useMailPageWiring());
    expect(result.current.todayTasks).toEqual([{ id: "t1", title: "Reply to Anna" }]);
  });

  // Hardening: wrong readings that pass the case above in some zone.

  it("the derived day wins over a stale instant, both ways", () => {
    const today = localDate(Date.now());
    const tomorrow = localDate(Date.now() + 36 * 3_600_000);
    fake.data.liveTasks = [
      // dueOn moved to today, dueDate still last week's instant.
      task("moved-here", { dueOn: today, dueDate: "2020-01-01T12:00:00.000Z" }),
      // dueOn moved away, dueDate still today's instant.
      task("moved-away", { dueOn: tomorrow, dueDate: todayAt(12, 0) }),
    ];
    expect(listed()).toEqual(["moved-here"]);
  });

  it("without dueOn, the instant's local day counts (not its UTC day)", () => {
    fake.data.liveTasks = [
      task("early", { dueOn: null, dueDate: todayAt(0, 30) }),
      task("late", { dueOn: null, dueDate: todayAt(23, 30) }),
    ];
    expect(listed()).toEqual(["early", "late"]);
  });

  it("a task done today is not listed", () => {
    const today = localDate(Date.now());
    fake.data.liveTasks = [task("done", { dueOn: today, status: "done" })];
    expect(listed()).toEqual([]);
  });
});
