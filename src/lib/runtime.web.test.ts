import { mapKnownRows, requireRow, taskRowSchema } from "@contracts/rows";
import { describe, expect, it } from "@rstest/core";

import { makeTask } from "../features/tasks/helpers";
import {
  editableTaskFields,
  isMissingColumnError,
  isMissingFunctionError,
  isMissingTableError,
  sortQueueEntries,
  taskCreateRow,
  taskCreateRowLegacy,
  taskPatchToColumns,
  taskQueueRowToModel,
  taskRowToModel,
} from "./task-rows";

describe("runtime.web mapper boundary", () => {
  const valid = {
    id: "t1",
    workspace_id: "w1",
    bucket_id: "b1",
    title: "Ok",
    status: "todo",
    created_at: "2026-08-17T00:00:00Z",
    updated_at: "2026-08-17T00:00:00Z",
  };

  it("maps a valid fixture identically", () => {
    const row = requireRow(taskRowSchema, valid, "task");
    expect(row.title).toBe("Ok");
  });

  it("skips a malformed RPC/row fixture in list reads", () => {
    const mapped = mapKnownRows([valid, { status: "nope" }], (row) =>
      requireRow(taskRowSchema, row, "task"),
    );
    expect(mapped).toHaveLength(1);
  });
});

// TV-D1 D1-1: an edit sends only what it changed, so it can't put back a field
// a teammate changed meanwhile (a whole-row save carried every field as this
// device last saw it).
describe("patchTask sends only changed columns", () => {
  const NOW = "2026-10-08T12:00:00.000Z";

  it("maps exactly the patched fields, plus updated_at", () => {
    expect(taskPatchToColumns({ priority: "high" }, NOW)).toEqual({
      priority: "high",
      updated_at: NOW,
    });
    expect(
      taskPatchToColumns({ title: "Renamed", dueDate: null, bucketId: "b2", parentId: null }, NOW),
    ).toEqual({
      title: "Renamed",
      due_date: null,
      bucket_id: "b2",
      parent_id: null,
      updated_at: NOW,
    });
  });

  it("skips undefined keys instead of nulling the column", () => {
    expect(taskPatchToColumns({ title: "A", priority: undefined }, NOW)).toEqual({
      title: "A",
      updated_at: NOW,
    });
  });

  it("never sends the creator, the assignee, the id or the workspace", () => {
    const fields = editableTaskFields({
      id: "t1",
      workspaceId: "w1",
      creatorId: "u1",
      creatorUnknown: false,
      assigneeId: "u2",
      createdAt: NOW,
      updatedAt: NOW,
      energyLevel: "low",
    });
    expect(fields).toEqual({ energyLevel: "low" });
    expect(taskPatchToColumns(fields, NOW)).toEqual({ energy_level: "low", updated_at: NOW });
  });

  it("keeps description NOT NULL (an emptied one is the empty string)", () => {
    expect(taskPatchToColumns({ description: "" }, NOW)).toEqual({
      description: "",
      updated_at: NOW,
    });
  });
});

describe("creating a task", () => {
  const base = {
    ...makeTask({ workspaceId: "w1", bucketId: "b1", title: "T", position: "a" }),
    id: "t1",
  };

  it("sends the assignee explicitly and no owner_id (the server records the creator)", () => {
    const row = taskCreateRow({ ...base, assigneeId: "u2" }, "u1");
    expect(row.assignee_id).toBe("u2");
    expect(row).not.toHaveProperty("owner_id");
  });

  it("an unchosen assignee is the creator; null stays Unassigned", () => {
    expect(taskCreateRow({ ...base, assigneeId: "" }, "u1").assignee_id).toBe("u1");
    expect(taskCreateRow({ ...base, assigneeId: null }, "u1").assignee_id).toBeNull();
  });

  it("makeTask leaves the assignee unchosen unless told", () => {
    expect(
      makeTask({ workspaceId: "w", bucketId: "b", title: "x", position: "a" }).assigneeId,
    ).toBe("");
    expect(
      makeTask({ workspaceId: "w", bucketId: "b", title: "x", position: "a", assigneeId: null })
        .assigneeId,
    ).toBeNull();
  });

  it("before the migration, the assignee goes in owner_id (the old meaning)", () => {
    const row = taskCreateRowLegacy({ ...base, assigneeId: "u2" }, "u1");
    expect(row.owner_id).toBe("u2");
    expect(row).not.toHaveProperty("assignee_id");
  });
});

describe("reading a task row", () => {
  const row = {
    id: "t1",
    workspace_id: "w1",
    bucket_id: "b1",
    status: "todo",
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };

  it("maps creator and assignee separately", () => {
    const t = taskRowToModel({ ...row, owner_id: "u1", assignee_id: "u2", creator_unknown: false });
    expect(t).toMatchObject({ creatorId: "u1", assigneeId: "u2", creatorUnknown: false });
  });

  it("Unassigned is a null assignee", () => {
    const t = taskRowToModel({ ...row, owner_id: "u1", assignee_id: null, creator_unknown: false });
    expect(t.assigneeId).toBeNull();
  });

  it("a row from before the migration shows owner_id as the assignee and claims no creator", () => {
    const t = taskRowToModel({ ...row, owner_id: "u2" });
    expect(t).toMatchObject({ assigneeId: "u2", creatorUnknown: true });
  });

  it("keeps the server's unknown-creator flag", () => {
    const t = taskRowToModel({ ...row, owner_id: "u2", assignee_id: "u2", creator_unknown: true });
    expect(t.creatorUnknown).toBe(true);
  });
});

describe("deploy-gap detection", () => {
  it("recognises PostgREST's missing-column and missing-function answers", () => {
    expect(
      isMissingColumnError(
        {
          code: "PGRST204",
          message: "Could not find the 'assignee_id' column of 'tasks' in the schema cache",
        },
        "assignee_id",
      ),
    ).toBe(true);
    expect(
      isMissingColumnError({ code: "PGRST204", message: "… 'title' column …" }, "assignee_id"),
    ).toBe(false);
    expect(isMissingColumnError({ code: "23505", message: "assignee_id" }, "assignee_id")).toBe(
      false,
    );
    expect(
      isMissingFunctionError(
        {
          code: "PGRST202",
          message:
            "Could not find the function public.tasks_op_assign(p_assignee_id, …) in the schema cache",
        },
        "tasks_op_assign",
      ),
    ).toBe(true);
    expect(
      isMissingFunctionError({ code: "42501", message: "tasks_op_assign" }, "tasks_op_assign"),
    ).toBe(false);
    expect(isMissingFunctionError(null, "tasks_op_assign")).toBe(false);
  });
});

describe("personal queue rows (TV-D2)", () => {
  const row = {
    id: "q1",
    workspace_id: "w1",
    user_id: "u1",
    task_id: "t1",
    position: "000000mh34",
    queued_at: "2026-10-08T10:00:00Z",
    updated_at: "2026-10-08T10:00:00Z",
  };

  it("maps a task_queue row", () => {
    expect(taskQueueRowToModel(row)).toEqual({
      id: "q1",
      workspaceId: "w1",
      userId: "u1",
      taskId: "t1",
      position: "000000mh34",
      queuedAt: "2026-10-08T10:00:00Z",
      updatedAt: "2026-10-08T10:00:00Z",
    });
  });

  it("refuses a row without a task or a position", () => {
    expect(() => taskQueueRowToModel({ ...row, task_id: undefined })).toThrow();
    expect(() => taskQueueRowToModel({ ...row, position: "" })).toThrow();
  });

  it("orders by person, then position bytewise, then id", () => {
    const e = (id: string, userId: string, position: string) =>
      taskQueueRowToModel({ ...row, id, user_id: userId, position });
    const sorted = sortQueueEntries([
      e("a", "u2", "000000mh34"),
      // A subdivided key sorts right after its prefix, as in the database.
      e("b", "u1", "000000mh34i"),
      e("c", "u1", "000000mh34"),
      e("d", "u1", "0000018y68"),
      e("e", "u1", "000000mh34"),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(["c", "e", "b", "d", "a"]);
  });

  it("recognises a queue table that isn't there yet", () => {
    expect(
      isMissingTableError(
        {
          code: "PGRST205",
          message: "Could not find the table 'public.task_queue' in the schema cache",
        },
        "task_queue",
      ),
    ).toBe(true);
    expect(
      isMissingTableError(
        { code: "42P01", message: 'relation "public.task_queue" does not exist' },
        "task_queue",
      ),
    ).toBe(true);
    expect(isMissingTableError({ code: "42501", message: "task_queue" }, "task_queue")).toBe(false);
    expect(isMissingTableError(null, "task_queue")).toBe(false);
  });
});
