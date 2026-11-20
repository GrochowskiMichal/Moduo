// TV-U13b — the panel follow-ups TV-D12 asked for: a repeat's due date moved
// in the panel asks "Just this one · Change the pattern" (Upcoming's dialog);
// a paused reminder says so, with Restore once the task is open again; and a
// repeat's cycles open from a quiet "n done" beside its rule.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

const PEOPLE = {
  u1: {
    userId: "u1",
    name: "You",
    fullName: "Alex Rivera",
    avatarUrl: null,
    isMe: true,
    canTakeTasks: true,
  },
  u2: { userId: "u2", name: "Mike Grochowski", avatarUrl: null, isMe: false, canTakeTasks: true },
} as const;

rs.mock("../assignees", () => ({
  useAssignees: () => ({
    assignees: Object.values(PEOPLE),
    currentUserId: "u1",
    byId: (id: string | null) => (id ? (PEOPLE[id as keyof typeof PEOPLE] ?? null) : null),
  }),
  previewAssign: async () => null,
  initialsOf: (name: string) => name.slice(0, 2).toUpperCase(),
}));

rs.mock("../../spine/hooks/use-comment-people", () => ({
  useCommentPeople: () => ({
    currentUserId: "u1",
    mentionable: [],
    names: ["Alex Rivera", "Mike"],
    nameOf: () => null,
    personOf: () => null,
  }),
}));

import { TooltipProvider } from "../../../components/ui/tooltip";
import { localDayOf } from "../../../lib/task-rows";
import type { TaskCommands } from "../commands";
import { makeTask } from "../helpers";
import type { Bucket, Task, TaskCompletion, TaskCycle, TaskReminder } from "../model";
import type { FakeTasksSeed } from "../testing/fake-tasks";
import { renderWithTasks } from "../testing/render-with-tasks";
import { TaskDetailPanel } from "./task-detail-panel";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

const INBOX: Bucket = {
  id: "inbox",
  workspaceId: "w",
  ownerId: "u1",
  name: "Inbox",
  isSystem: true,
  group: null,
  position: "a",
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
};
const APP: Bucket = { ...INBOX, id: "b-app", name: "Moduo App", isSystem: false, position: "b" };

const today = new Date();
today.setHours(0, 0, 0, 0);
const tomorrow = new Date(today);
tomorrow.setDate(today.getDate() + 1);

const WEEKLY = {
  rrule: "FREQ=WEEKLY;INTERVAL=1",
  dtstart: today.toISOString(),
  nextOccurrence: today.toISOString(),
};

function task(over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w", bucketId: "b-app", title: "Water the plants", position: "a" }),
    id: "t1",
    creatorId: "u1",
    assigneeId: "u1",
    dueDate: today.toISOString(),
    dueOn: localDayOf(today.toISOString()),
    ...over,
  };
}

function reminder(over: Partial<TaskReminder> = {}): TaskReminder {
  return {
    id: "r1",
    workspaceId: "w",
    taskId: "t1",
    userId: "u1",
    kind: "day_before",
    at: null,
    firedAt: null,
    suspendedAt: null,
    updatedAt: "",
    ...over,
  };
}

/** The commands the panel calls here, as spies. */
function spies() {
  return {
    loadActivity: rs.fn(async () => []),
    patchTask: rs.fn(),
    moveOccurrence: rs.fn(),
    restoreReminders: rs.fn(),
    taskHistory: rs.fn(async (): Promise<TaskCycle[]> => []),
    addReminder: rs.fn(),
    removeReminder: rs.fn(),
  };
}

type Setup = ReturnType<typeof spies> & { seed: FakeTasksSeed };

/** The task in the store (with `seed`'s rows), and spies for what the panel calls. */
function api(t: Task, over: Partial<TaskCommands> & { seed?: FakeTasksSeed } = {}): Setup {
  const { seed = {}, ...commands } = over;
  return {
    ...spies(),
    ...commands,
    seed: { buckets: [INBOX, APP], tasks: [t], ...seed },
  } as Setup;
}

function renderPanel(t: Task, a: Setup) {
  const { seed, ...commands } = a;
  return renderWithTasks(
    <TooltipProvider>
      <TaskDetailPanel task={t} canEdit onRequestCapture={() => {}} onSelectTask={() => {}} />
    </TooltipProvider>,
    { seed, commands, workspaceId: "w" },
  );
}

describe("a repeat's due date moved in the panel asks first (TV-U13b)", () => {
  it("Just this one moves this occurrence; the rule stays", async () => {
    const t = task({ recurrence: WEEKLY });
    const a = api(t);
    await renderPanel(t, a);
    fireEvent.click(screen.getByRole("button", { name: /^Due/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(a.patchTask).not.toHaveBeenCalled();
    expect(screen.getByText(/It repeats\./)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Just this one" }));
    expect(a.moveOccurrence).toHaveBeenCalledWith("t1", {
      dueOn: localDayOf(tomorrow.toISOString()),
    });
    expect(a.patchTask).not.toHaveBeenCalled();
  });

  it("Change the pattern saves the new rule with the new date", async () => {
    const t = task({ recurrence: WEEKLY });
    const a = api(t);
    await renderPanel(t, a);
    fireEvent.click(screen.getByRole("button", { name: /^Due/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    fireEvent.click(screen.getByRole("button", { name: "Change the pattern" }));
    expect(a.moveOccurrence).not.toHaveBeenCalled();
    const [id, patch] = (a.patchTask as ReturnType<typeof rs.fn>).mock.calls[0] as [
      string,
      Partial<Task>,
    ];
    expect(id).toBe("t1");
    expect(patch.dueDate).toBe(tomorrow.toISOString());
    expect(patch.recurrence?.rrule).toContain("FREQ=WEEKLY");
  });

  it("a one-off task's date saves at once, no question", async () => {
    const t = task({ recurrence: null });
    const a = api(t);
    await renderPanel(t, a);
    fireEvent.click(screen.getByRole("button", { name: /^Due/ }));
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(screen.queryByRole("button", { name: "Just this one" })).toBeNull();
    expect(a.patchTask).toHaveBeenCalledWith("t1", { dueDate: tomorrow.toISOString() });
  });
});

describe("a paused reminder (TV-U13b)", () => {
  it("reads Paused, and offers Restore once the task is To do again", async () => {
    const t = task({ status: "todo", statusCategory: "todo" });
    const a = api(t, { seed: { reminders: [reminder({ suspendedAt: "2026-10-12T10:00:00Z" })] } });
    await renderPanel(t, a);
    fireEvent.click(screen.getByRole("button", { name: /^Reminder: 1 day before due · paused/ }));
    expect(screen.getByText(/· Paused/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restore the reminder" }));
    expect(a.restoreReminders).toHaveBeenCalledWith("t1");
  });

  it("a paused reminder whose time went by offers no Restore that can't work", async () => {
    const t = task({ status: "todo", statusCategory: "todo" });
    const a = api(t, {
      seed: {
        reminders: [
          reminder({ kind: "at", at: "2026-01-02T09:00:00Z", suspendedAt: "2026-01-01T10:00:00Z" }),
        ],
      },
    });
    await renderPanel(t, a);
    fireEvent.click(screen.getByRole("button", { name: /^Reminder:/ }));
    expect(screen.queryByRole("button", { name: "Restore the reminder" })).toBeNull();
    expect(
      screen.getByText("Its time went by while it was paused. Remove it, or add a new one."),
    ).toBeTruthy();
  });

  it("while the task sits in Backlog it says why, with no Restore", async () => {
    const t = task({ status: "todo", statusCategory: "backlog" });
    const a = api(t, { seed: { reminders: [reminder({ suspendedAt: "2026-10-12T10:00:00Z" })] } });
    await renderPanel(t, a);
    fireEvent.click(screen.getByRole("button", { name: /^Reminder:/ }));
    expect(screen.queryByRole("button", { name: "Restore the reminder" })).toBeNull();
    expect(
      screen.getByText("Paused while it’s in Backlog. Move it to To do to restore it."),
    ).toBeTruthy();
  });
});

describe("a repeat's cycles (TV-U13b)", () => {
  const completion = (id: string, by: string, at: string): TaskCompletion => ({
    id,
    workspaceId: "w",
    taskId: "t1",
    userId: by,
    completedAt: at,
    cycleKey: at,
    updatedAt: at,
    deletedAt: null,
  });

  it("counts them beside the rule and lists each with who closed it and only your time", async () => {
    const t = task({ recurrence: WEEKLY });
    const cycles: TaskCycle[] = [
      { kind: "done", at: "2026-10-06T10:00:00Z", cycle: null, by: "u2", mySeconds: 0 },
      { kind: "skipped", at: "2026-09-29T10:00:00Z", cycle: null, by: "u1", mySeconds: 0 },
      { kind: "done", at: "2026-09-22T10:00:00Z", cycle: null, by: "u1", mySeconds: 1500 },
    ];
    const a = api(t, {
      seed: {
        completions: [
          completion("c1", "u2", "2026-10-06T10:00:00Z"),
          completion("c2", "u1", "2026-09-22T10:00:00Z"),
        ],
      },
      taskHistory: rs.fn(async () => cycles),
    });
    await renderPanel(t, a);
    const trigger = screen.getByRole("button", { name: /^Repeat history: 2 done · last / });
    fireEvent.click(trigger);
    expect(a.taskHistory).toHaveBeenCalledWith("t1");
    await waitFor(() => expect(screen.getByText("Done by Mike")).toBeTruthy());
    expect(screen.getByText("Skipped by you")).toBeTruthy();
    expect(screen.getByText(/your time 25m/)).toBeTruthy();
  });

  it("isn't offered for a one-off task", async () => {
    const t = task({ recurrence: null, energyLevel: "high" });
    await renderPanel(t, api(t));
    expect(screen.queryByRole("button", { name: /^Repeat history/ })).toBeNull();
  });
});
