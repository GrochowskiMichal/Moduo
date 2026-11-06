// HV-15 variant of benchmarks/escapes/509-4-stale-derived-field: the Mail Today panel lists
// "tasks due today" by comparing the instant `dueDate` (local midnight as an ISO string)
// with the day "YYYY-MM-DD" instead of reading the derived `dueOn`, so it never matches
// and the panel never shows a task due today (nor offers it as a drop target).
// Fails until the fix lands. Zone-independent.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/email/hooks/use-mail-page-wiring.509-4.variant.test.ts

import { describe, expect, it, rs } from "@rstest/core";
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
  data: { inbox: null, liveTasks: [] as unknown[] },
}));

rs.mock("@/providers/auth-provider", () => ({ useAuth: () => fake.auth }));
rs.mock("@/providers/workspace-provider", () => ({ useWorkspace: () => fake.workspace }));
rs.mock("../../calendar/hooks/use-calendar-module", () => ({
  useCalendarModule: () => fake.calendar,
}));
rs.mock("../../tasks/tasks-context", () => ({
  useTasksSelector: (pick: (d: typeof fake.data) => unknown) => pick(fake.data),
}));
rs.mock("./use-email-tissue", () => ({ useEmailTissue: () => fake.tissue }));

import { useMailPageWiring } from "./use-mail-page-wiring";

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 509-4: Mail's Today panel never lists a task due today", () => {
  it("a task due today (as the store holds it) is in todayTasks", () => {
    const today = localDate(Date.now());
    // As the Tasks store reads a row (rowToTask): the instant of local midnight + the day.
    const task: Task = {
      ...makeTask({ workspaceId: "w", bucketId: "inbox", title: "Reply to Anna", position: "a" }),
      id: "t1",
      dueDate: dueOnToLocalInstant(today),
      dueOn: today,
    };
    fake.data.liveTasks = [task];
    const { result } = renderHook(() => useMailPageWiring());
    expect(result.current.todayTasks).toEqual([{ id: "t1", title: "Reply to Anna" }]);
  });
});
