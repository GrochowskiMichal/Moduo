// `planTaskWrite` (Track A3): the one set of rules a single edit, a drop and
// a selection's change follow. Table tests per rule, and the parity a single
// patch and a one-item bulk write must keep.

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import type { BulkWrite } from "./bulk";
import { subtasksByParentOf } from "./derived";
import { makeTask } from "./helpers";
import type { Bucket, ProjectStatus, RecurrenceRule, Task, TaskQueueEntry } from "./model";
import {
  childrenByParentOf,
  handedOutOfSight,
  patchOfWrite,
  planTaskWrite,
  type TaskWrite,
  type WritePatch,
  type WritePlan,
  type WritePlanContext,
} from "./write-plan";

const ME = "u1";
const NOW = new Date("2026-10-20T10:00:00.000Z");

const bucket = (id: string, over: Partial<Bucket> = {}): Bucket => ({
  id,
  workspaceId: "w1",
  ownerId: ME,
  name: id.toUpperCase(),
  isSystem: false,
  group: null,
  position: id,
  createdAt: "",
  updatedAt: "",
  deletedAt: null,
  ...over,
});

const status = (
  id: string,
  category: ProjectStatus["category"],
  projectId: string | null = "p1",
  position = 1,
): ProjectStatus => ({
  id,
  workspaceId: "w1",
  projectId,
  category,
  name: id,
  position,
  hidden: false,
  createdAt: "",
  updatedAt: "",
});

const STATUSES = [
  status("s-backlog", "backlog"),
  status("s-todo", "todo"),
  status("s-doing", "in_progress"),
  status("s-review", "in_progress", "p1", 2),
  status("s-done", "done"),
  status("s-wont", "wont_do"),
  status("p2-todo", "todo", "p2"),
  status("p2-done", "done", "p2"),
  status("d-todo", "todo", null),
];

function task(id: string, over: Partial<Task> = {}): Task {
  return {
    ...makeTask({ workspaceId: "w1", bucketId: "p1", title: id, position: id }),
    id,
    creatorId: ME,
    assigneeId: ME,
    statusId: "s-todo",
    statusCategory: "todo",
    createdAt: "2026-10-01T07:00:00.000Z",
    updatedAt: "2026-10-01T07:00:00.000Z",
    ...over,
  };
}

const queueRow = (taskId: string, userId: string): TaskQueueEntry => ({
  id: `q-${taskId}-${userId}`,
  workspaceId: "w1",
  userId,
  taskId,
  position: "a0",
  queuedAt: "",
  updatedAt: "",
});

function ctxOf(
  over: Partial<WritePlanContext> = {},
  live: Task[] = [],
  queue: TaskQueueEntry[] = [],
): WritePlanContext {
  const buckets = [bucket("inbox", { isSystem: true }), bucket("p1"), bucket("p2")];
  return {
    userId: ME,
    canEdit: true,
    archivedTaskIds: new Set<string>(),
    bucketsById: new Map(buckets.map((b) => [b.id, b])),
    statuses: STATUSES,
    subtasksByParent: childrenByParentOf(live),
    queueRows: queue,
    myQueueEntries: queue.filter((e) => e.userId === ME),
    now: NOW,
    zone: "Europe/Warsaw",
    ...over,
  };
}

function written(plan: WritePlan): TaskWrite {
  if (plan.kind !== "write") throw new Error(`expected a write, got ${plan.kind}`);
  return plan;
}

const DAILY: RecurrenceRule = {
  rrule: "FREQ=DAILY",
  dtstart: "2026-10-01T07:00:00.000Z",
  nextOccurrence: "2026-10-20T07:00:00.000Z",
};

describe("planTaskWrite: refusals", () => {
  const cases: Array<{
    name: string;
    before: Task;
    ctx: Partial<WritePlanContext>;
    plan: WritePlan;
  }> = [
    {
      name: "without edit access",
      before: task("t1"),
      ctx: { canEdit: false },
      plan: { kind: "refused", reason: "no-edit" },
    },
    {
      name: "a deleted task",
      before: task("t1", { deletedAt: "2026-10-19T00:00:00.000Z" }),
      ctx: {},
      plan: { kind: "refused", reason: "deleted" },
    },
    {
      name: "a task still saving",
      before: task("tmp-1"),
      ctx: {},
      plan: { kind: "refused", reason: "still-saving" },
    },
    {
      name: "a task of an archived project, naming it",
      before: task("t1"),
      ctx: { archivedTaskIds: new Set(["t1"]) },
      plan: { kind: "refused", reason: "archived", projectName: "P1" },
    },
    {
      name: "no edit access before anything else",
      before: task("tmp-1"),
      ctx: { canEdit: false, archivedTaskIds: new Set(["tmp-1"]) },
      plan: { kind: "refused", reason: "no-edit" },
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(planTaskWrite(c.before, { status: "done" }, ctxOf(c.ctx))).toEqual(c.plan);
    });
  }
});

describe("planTaskWrite: nothing to send", () => {
  const before = task("t1", { scheduledAt: "2026-10-21T08:00:00.000Z" });
  const cases: Array<[string, WritePatch, WritePlan["kind"]]> = [
    ["an empty patch", {}, "noop"],
    ["only fields an edit can't send", { completedAt: "2026-10-20T09:00:00.000Z" }, "noop"],
    ["the scheduled time it already has", { scheduledAt: before.scheduledAt }, "noop"],
    ["the same instant written another way", { scheduledAt: "2026-10-21T08:00:00+00:00" }, "noop"],
    ["a new scheduled time", { scheduledAt: "2026-10-22T08:00:00.000Z" }, "write"],
    ["a title", { title: "x" }, "write"],
  ];
  for (const [name, patch, kind] of cases) {
    it(name, () => expect(planTaskWrite(before, patch, ctxOf()).kind).toBe(kind));
  }
});

describe("planTaskWrite: status mapping (TV-D9)", () => {
  const cases: Array<{
    name: string;
    before?: Task;
    patch: WritePatch;
    shown: Partial<Task>;
    op: string;
    sentStatusId?: string;
  }> = [
    {
      name: "the checkbox's done shows the project's Done",
      patch: { status: "done" },
      shown: { status: "done", statusCategory: "done", statusId: "s-done" },
      op: "done",
    },
    {
      name: "Won't do by its legacy word",
      patch: { status: "archived" },
      shown: { status: "archived", statusCategory: "wont_do", statusId: "s-wont" },
      op: "archived",
    },
    {
      name: "Backlog by category: legacy todo, sent as backlog",
      patch: { statusCategory: "backlog", status: "todo" },
      shown: { status: "todo", statusCategory: "backlog", statusId: "s-backlog" },
      op: "backlog",
    },
    {
      name: "a named status is taken as it is, and sent by id",
      patch: { statusId: "s-review" },
      shown: { status: "in_progress", statusCategory: "in_progress", statusId: "s-review" },
      op: "s-review",
      sentStatusId: "s-review",
    },
    {
      name: "a category the task is already in keeps its own status",
      before: task("t1", {
        status: "in_progress",
        statusCategory: "in_progress",
        statusId: "s-review",
      }),
      patch: { statusCategory: "in_progress", status: "in_progress" },
      shown: { status: "in_progress", statusCategory: "in_progress", statusId: "s-review" },
      op: "in_progress",
    },
    {
      name: "a named status unknown to the set keeps the category it came with",
      patch: { statusId: "s-gone", statusCategory: "done", status: "done" },
      shown: { status: "done", statusCategory: "done", statusId: "s-gone" },
      op: "s-gone",
      sentStatusId: "s-gone",
    },
    {
      name: "moved and finished: the status of the project it ends in",
      patch: { bucketId: "p2", status: "done" },
      shown: { bucketId: "p2", status: "done", statusCategory: "done", statusId: "p2-done" },
      op: "done",
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const plan = written(planTaskWrite(c.before ?? task("t1"), c.patch, ctxOf()));
      expect(plan.shown).toMatchObject(c.shown);
      expect(plan.status?.status).toBe(c.op);
      // The id picked by category only shows; a named one is sent.
      expect(plan.columns.statusId).toBe(c.sentStatusId);
      expect(plan.columns.statusCategory).toBe(c.shown.statusCategory);
      // The status goes by its own op, never in the field-level part.
      expect(plan.fields).not.toHaveProperty("status");
      expect(plan.fields).not.toHaveProperty("statusCategory");
      expect(plan.fields).not.toHaveProperty("statusId");
    });
  }

  it("rescheduling a backlog task to the time it has shows no move to To do", () => {
    const backlog = task("b1", {
      statusCategory: "backlog",
      statusId: "s-backlog",
      scheduledAt: "2026-10-21T08:00:00.000Z",
    });
    const plan = written(
      planTaskWrite(backlog, { scheduledAt: "2026-10-21T08:00:00+00:00", title: "x" }, ctxOf()),
    );
    expect(plan.shown.statusCategory).toBeUndefined();
  });

  describe("into another project, as the server picks (moved: same name, else first)", () => {
    const named = [
      ...STATUSES,
      { ...status("p2-review", "in_progress", "p2", 1), name: " S-REVIEW " },
      status("p2-doing", "in_progress", "p2", 0),
    ];
    const reviewing = task("t1", {
      status: "in_progress",
      statusCategory: "in_progress",
      statusId: "s-review",
    });
    const cases: Array<{ name: string; patch: WritePatch; statuses: ProjectStatus[]; id: string }> =
      [
        {
          name: "a status of the same name there",
          patch: { bucketId: "p2" },
          statuses: named,
          id: "p2-review",
        },
        {
          name: "else the category's first there",
          patch: { bucketId: "p2" },
          statuses: [...STATUSES, status("p2-doing", "in_progress", "p2")],
          id: "p2-doing",
        },
        {
          name: "with the category it already has, the same",
          patch: { bucketId: "p2", statusCategory: "in_progress", status: "in_progress" },
          statuses: named,
          id: "p2-review",
        },
        {
          name: "a project whose statuses I can't read keeps its own",
          patch: { bucketId: "p2" },
          statuses: STATUSES.filter((s) => s.projectId !== "p2"),
          id: "s-review",
        },
      ];
    for (const c of cases) {
      it(c.name, () => {
        const plan = written(planTaskWrite(reviewing, c.patch, ctxOf({ statuses: c.statuses })));
        // The row as it shows.
        expect({ ...reviewing, ...plan.shown }).toMatchObject({
          statusId: c.id,
          statusCategory: "in_progress",
        });
        // Shown only: the server picks it itself.
        expect(plan.columns.statusId).toBeUndefined();
      });
    }

    it("a move without a status change sends no status", () => {
      const plan = written(
        planTaskWrite(reviewing, { bucketId: "p2" }, ctxOf({ statuses: named })),
      );
      expect(plan.status).toBeUndefined();
      expect(plan.columns).toEqual({ bucketId: "p2" });
    });
  });

  it("the place and the rule ride with the status op", () => {
    const plan = written(planTaskWrite(task("t1"), { status: "done", position: "b0" }, ctxOf()));
    expect(plan.status).toEqual({ category: "done", status: "done", position: "b0" });
    expect(plan.fields).toEqual({});
    expect(plan.columns).toMatchObject({ position: "b0", status: "done" });
  });

  it("without a status, the place is a field", () => {
    const plan = written(planTaskWrite(task("t1"), { position: "b0" }, ctxOf()));
    expect(plan.status).toBeUndefined();
    expect(plan.fields).toEqual({ position: "b0" });
  });
});

describe("planTaskWrite: advance-on-done (spec §5d)", () => {
  it("a check-off advances the repeat's pointer past today, and says when", () => {
    const plan = written(
      planTaskWrite(task("t1", { recurrence: DAILY }), { status: "done" }, ctxOf()),
    );
    expect(plan.advancedRecurrence?.nextOccurrence).toBe("2026-10-21T07:00:00.000Z");
    expect(plan.status?.recurrence).toEqual(plan.advancedRecurrence);
    expect(plan.shown.recurrence).toEqual(plan.advancedRecurrence);
    expect(plan.followUps.nextOccurrence).toBe("2026-10-21T07:00:00.000Z");
    // The rule rides the status op, not the field-level part.
    expect(plan.fields).not.toHaveProperty("recurrence");
  });

  it("a rule the change carries itself (catch-up, skip, Undo) isn't advanced", () => {
    const own = { ...DAILY, nextOccurrence: "2026-11-01T07:00:00.000Z" };
    const plan = written(
      planTaskWrite(
        task("t1", { recurrence: DAILY }),
        { status: "done", recurrence: own },
        ctxOf(),
      ),
    );
    expect(plan.advancedRecurrence).toBeUndefined();
    expect(plan.status?.recurrence).toEqual(own);
    expect(plan.followUps.nextOccurrence).toBeUndefined();
  });

  it("counting from completion leaves the next date to the server", () => {
    const rule = { ...DAILY, mode: "after_completion" as const };
    const plan = written(
      planTaskWrite(task("t1", { recurrence: rule }), { status: "done" }, ctxOf()),
    );
    expect(plan.status?.recurrence).toEqual({ ...rule, nextOccurrence: null });
    expect(plan.followUps.nextOccurrence).toBeUndefined();
  });

  it("a task without a repeat carries no rule", () => {
    const plan = written(planTaskWrite(task("t1"), { status: "done" }, ctxOf()));
    expect(plan.status).not.toHaveProperty("recurrence");
    expect(plan.shown).not.toHaveProperty("recurrence");
  });

  it("without a status, a rule is a field", () => {
    const plan = written(planTaskWrite(task("t1"), { recurrence: DAILY }, ctxOf()));
    expect(plan.fields).toEqual({ recurrence: DAILY });
  });
});

describe("planTaskWrite: queue follow (TV-D2, TV-D9)", () => {
  const rows = [queueRow("t1", ME), queueRow("t1", "u2"), queueRow("t9", ME)];
  const cases: Array<{
    name: string;
    patch: WritePatch;
    leaves: string[];
    keep: boolean;
    unkeep: boolean;
  }> = [
    {
      name: "done leaves every queue; mine stays on show",
      patch: { status: "done" },
      leaves: ["q-t1-u1", "q-t1-u2"],
      keep: true,
      unkeep: false,
    },
    {
      name: "Won't do leaves every queue",
      patch: { status: "archived" },
      leaves: ["q-t1-u1", "q-t1-u2"],
      keep: false,
      unkeep: false,
    },
    {
      name: "Backlog leaves every queue",
      patch: { statusCategory: "backlog" },
      leaves: ["q-t1-u1", "q-t1-u2"],
      keep: false,
      unkeep: false,
    },
    {
      name: "reopening drops the one kept on show",
      patch: { status: "todo" },
      leaves: [],
      keep: false,
      unkeep: true,
    },
    {
      name: "in progress stays queued",
      patch: { status: "in_progress" },
      leaves: [],
      keep: false,
      unkeep: true,
    },
    {
      name: "an edit without a status leaves the queues alone",
      patch: { title: "x" },
      leaves: [],
      keep: false,
      unkeep: false,
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const plan = written(planTaskWrite(task("t1"), c.patch, ctxOf({}, [], rows)));
      expect(plan.queue.rowIds).toEqual(c.leaves);
      expect(plan.queue.keep?.id).toBe(c.keep ? "q-t1-u1" : undefined);
      expect(plan.queue.unkeep).toBe(c.unkeep);
      // The same write takes them out of the queues shown.
      const removed = plan.overlay.flatMap((ch) => ("remove" in ch ? [ch.remove] : []));
      expect(removed).toEqual(c.leaves);
      expect(plan.alongside).toEqual(plan.overlay.slice(1));
    });
  }
});

describe("planTaskWrite: subtasks follow a move (TV-P0, TV-D8)", () => {
  const parent = task("p");
  const live = [
    parent,
    task("c-open", { parentId: "p" }),
    task("c-done", { parentId: "p", status: "done", statusCategory: "done" }),
    task("c-wont", { parentId: "p", status: "archived", statusCategory: "wont_do" }),
    task("tmp-c", { parentId: "p" }),
    task("c-there", { parentId: "p", bucketId: "p2" }),
    task("other", { parentId: "x" }),
  ];

  it("moving a parent shows its subtasks there too, done and Won't do ones as well", () => {
    const plan = written(planTaskWrite(parent, { bucketId: "p2" }, ctxOf({}, live)));
    expect(plan.moving).toBe(true);
    // Not one still saving (the server can't carry it), nor one already there.
    expect(plan.movedChildIds).toEqual(["c-open", "c-done", "c-wont"]);
    expect(plan.overlay.slice(1)).toEqual(
      ["c-open", "c-done", "c-wont"].map((id) => ({
        table: "tasks",
        patch: { id, fields: { bucketId: "p2" } },
      })),
    );
    expect(plan.fields).toEqual({ bucketId: "p2" });
  });

  it("an edit that stays in the project takes nothing along", () => {
    const plan = written(planTaskWrite(parent, { bucketId: "p1", title: "x" }, ctxOf({}, live)));
    expect(plan.moving).toBe(false);
    expect(plan.movedChildIds).toEqual([]);
  });

  it("the lists' subtasks leave Won't do out; a move doesn't", () => {
    expect(
      subtasksByParentOf(live)
        .get("p")
        ?.map((t) => t.id),
    ).not.toContain("c-wont");
    expect(
      childrenByParentOf(live)
        .get("p")
        ?.map((t) => t.id),
    ).toContain("c-wont");
    expect(childrenByParentOf(live)).toBe(childrenByParentOf(live));
  });
});

describe("planTaskWrite: due date and its day (TV-D9)", () => {
  it("a due date at Warsaw midnight shows Warsaw's day, not the UTC one", () => {
    const dueDate = "2026-10-19T22:00:00.000Z";
    const plan = written(planTaskWrite(task("t1"), { dueDate }, ctxOf()));
    expect(plan.shown).toMatchObject({ dueDate, dueOn: "2026-10-20" });
    // The day is the server's to derive: only the date is sent.
    expect(plan.fields).toEqual({ dueDate });
    expect(plan.overlay[0]).toMatchObject({
      patch: { id: "t1", fields: { dueDate, dueOn: "2026-10-20" } },
    });
  });

  it("clearing the date clears the day", () => {
    const plan = written(
      planTaskWrite(task("t1", { dueDate: "x", dueOn: "2026-10-20" }), { dueDate: null }, ctxOf()),
    );
    expect(plan.shown).toMatchObject({ dueDate: null, dueOn: null });
  });

  it("a repeat's occurrence shows its day and that day's local midnight, and sends neither field", () => {
    const plan = written(
      planTaskWrite(task("t1", { recurrence: DAILY }), { occurrenceOn: "2026-10-20" }, ctxOf()),
    );
    expect(plan.occurrenceOn).toBe("2026-10-20");
    expect(plan.shown).toMatchObject({ dueOn: "2026-10-20", dueDate: "2026-10-19T22:00:00.000Z" });
    expect(plan.shown).not.toHaveProperty("occurrenceOn");
    expect(plan.fields).toEqual({});
    expect(plan.columns).toEqual({});
  });
});

describe("planTaskWrite: follow-ups", () => {
  const backlog = task("b1", { statusCategory: "backlog", statusId: "s-backlog" });
  const cases: Array<{
    name: string;
    before: Task;
    patch: WritePatch;
    expected: Partial<TaskWrite["followUps"]>;
  }> = [
    {
      name: "assigning a backlog task offers Move to To do",
      before: backlog,
      patch: { assigneeId: "u2" },
      expected: { moveToTodo: true },
    },
    {
      name: "so does giving it a due date",
      before: backlog,
      patch: { dueDate: "2026-11-20T00:00:00.000Z" },
      expected: { moveToTodo: true },
    },
    {
      name: "not when the change sets the status itself",
      before: backlog,
      patch: { assigneeId: "u2", status: "todo" },
      expected: { moveToTodo: false },
    },
    {
      name: "not for an open task",
      before: task("t1"),
      patch: { assigneeId: "u2" },
      expected: { moveToTodo: false },
    },
    {
      name: "not when it keeps its assignee",
      before: backlog,
      patch: { assigneeId: ME },
      expected: { moveToTodo: false },
    },
    {
      name: "out of Won't do into To do: the paused reminders",
      before: task("w", { status: "archived", statusCategory: "wont_do" }),
      patch: { status: "todo" },
      expected: { restoreReminders: true },
    },
    {
      name: "out of Backlog into In progress too",
      before: backlog,
      patch: { status: "in_progress" },
      expected: { restoreReminders: true },
    },
    {
      name: "not out of To do",
      before: task("t1"),
      patch: { status: "in_progress" },
      expected: { restoreReminders: false },
    },
    {
      name: "into Done from an open status finishes the open subtasks",
      before: task("t1"),
      patch: { status: "done" },
      expected: { finishOpenSubtasks: true },
    },
    {
      name: "not from Won't do",
      before: task("w", { status: "archived", statusCategory: "wont_do" }),
      patch: { status: "done" },
      expected: { finishOpenSubtasks: false },
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(written(planTaskWrite(c.before, c.patch, ctxOf())).followUps).toMatchObject(
        c.expected,
      );
    });
  }

  it("scheduling a backlog task shows it in To do at once, and doesn't offer the move", () => {
    const plan = written(
      planTaskWrite(
        backlog,
        { scheduledAt: "2026-11-12T09:00:00.000Z", assigneeId: "u2" },
        ctxOf(),
      ),
    );
    expect(plan.shown).toMatchObject({ statusCategory: "todo", statusId: "s-todo" });
    // The server moves it: no status op, nothing of it sent.
    expect(plan.status).toBeUndefined();
    expect(plan.columns).toEqual({ scheduledAt: "2026-11-12T09:00:00.000Z" });
    expect(plan.followUps.moveToTodo).toBe(false);
  });
});

describe("handedOutOfSight (TV-D13)", () => {
  const before = task("t1", { bucketId: "inbox", creatorId: "u2", assigneeId: "u2" });
  const live = [
    before,
    task("s1", { parentId: "t1", bucketId: "inbox" }),
    task("s2", { parentId: "t1", bucketId: "p1" }),
  ];
  const ctx = ctxOf({}, live);

  it("someone else's task handed into an Inbox I can't see goes, with its steps there", () => {
    const saved = { ...before, bucketId: "their-inbox", assigneeId: "u3" };
    expect(handedOutOfSight(saved, before, ctx)).toEqual(["t1", "s1"]);
  });

  it("one that stays, lands where I can see, or is mine, stays", () => {
    expect(handedOutOfSight({ ...before, assigneeId: "u3" }, before, ctx)).toEqual([]);
    expect(handedOutOfSight({ ...before, bucketId: "p2", assigneeId: "u3" }, before, ctx)).toEqual(
      [],
    );
    expect(
      handedOutOfSight({ ...before, bucketId: "their-inbox", assigneeId: ME }, before, ctx),
    ).toEqual([]);
  });
});

describe("parity: one task's change plans the same, single or bulk", () => {
  const live = [task("t1", { recurrence: DAILY }), task("c1", { parentId: "t1" })];
  const backlog = task("b1", { statusCategory: "backlog", statusId: "s-backlog" });
  const rows = [queueRow("t1", ME), queueRow("t1", "u2")];
  const cases: Array<{ name: string; before: Task; single: Partial<Task>; bulk: BulkWrite }> = [
    {
      name: "a check-off",
      before: live[0]!,
      single: { status: "done" },
      bulk: { taskId: "t1", status: "done" },
    },
    {
      name: "Won't do",
      before: live[0]!,
      single: { status: "archived" },
      bulk: { taskId: "t1", status: "archived" },
    },
    {
      name: "Backlog",
      before: live[0]!,
      single: { statusCategory: "backlog", status: "todo" },
      bulk: { taskId: "t1", status: "backlog" },
    },
    {
      name: "a named status",
      before: live[0]!,
      single: { statusId: "s-review", statusCategory: "in_progress", status: "in_progress" },
      bulk: { taskId: "t1", status: "in_progress", statusId: "s-review" },
    },
    {
      name: "a move with its subtasks",
      before: live[0]!,
      single: { bucketId: "p2", position: "z0" },
      bulk: { taskId: "t1", bucketId: "p2", position: "z0" },
    },
    {
      name: "a due date",
      before: live[0]!,
      single: { dueDate: "2026-10-19T22:00:00.000Z" },
      bulk: { taskId: "t1", dueDate: "2026-10-19T22:00:00.000Z" },
    },
    {
      name: "an assignee on a backlog task",
      before: backlog,
      single: { assigneeId: "u2" },
      bulk: { taskId: "b1", assigneeId: "u2" },
    },
    {
      name: "a reschedule of a backlog task",
      before: backlog,
      single: { scheduledAt: "2026-11-12T09:00:00.000Z" },
      bulk: { taskId: "b1", scheduledAt: "2026-11-12T09:00:00.000Z" },
    },
    {
      name: "priority, section and team",
      before: live[0]!,
      single: { priority: "high", sectionId: "s1", teamId: "team" },
      bulk: { taskId: "t1", priority: "high", sectionId: "s1", teamId: "team" },
    },
    {
      name: "a refused one",
      before: task("tmp-x"),
      single: { status: "done" },
      bulk: { taskId: "tmp-x", status: "done" },
    },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const ctx = ctxOf({}, live, rows);
      expect(planTaskWrite(c.before, patchOfWrite(c.bulk), ctx)).toEqual(
        planTaskWrite(c.before, c.single, ctx),
      );
    });
  }
});
