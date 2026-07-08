/**
 * AC3 proof — mint/link args: `/task` create yields an Inbox-bucket task with
 * nothing scheduled + a `spawned-from` back-link; linking an existing task
 * yields `references`; the title-sync mapper renames, never clobbers.
 */

import { describe, expect, it } from "vitest";
import type { Task } from "../../tasks/model";
import { makeTask } from "../../tasks/helpers";
import {
  applyTaskRename,
  buildMintTaskFields,
  buildTaskLineLink,
  filterTaskCandidates,
  shouldOfferCreate,
} from "./task-line";

const WS = "ws-1";
const NOTE = { type: "note", id: "note-1" } as const;

function task(overrides: Partial<Task>): Task {
  return {
    ...makeTask({ workspaceId: WS, bucketId: "b-1", title: "t", position: "a0" }),
    id: "task-1",
    ...overrides,
  };
}

describe("buildMintTaskFields (mint → Tasks Inbox)", () => {
  it("targets the Inbox bucket with nothing scheduled and no due date", () => {
    const fields = buildMintTaskFields({
      workspaceId: WS,
      inboxBucketId: "inbox-1",
      title: "  Ship the report  ",
      position: "a1",
    });
    expect(fields.bucketId).toBe("inbox-1");
    expect(fields.title).toBe("Ship the report");
    expect(fields.dueDate).toBeNull();
    expect(fields.scheduledAt).toBeNull();
    const minted = makeTask(fields);
    expect(minted.status).toBe("todo");
  });

  it("an emptied title still mints something nameable", () => {
    expect(
      buildMintTaskFields({ workspaceId: WS, inboxBucketId: "i", title: "  ", position: "a1" })
        .title,
    ).toBe("Untitled task");
  });
});

describe("buildTaskLineLink (the back-link kinds)", () => {
  it("minted = spawned-from, note as source", () => {
    const link = buildTaskLineLink({
      workspaceId: WS,
      note: NOTE,
      noteLabel: "Plan",
      taskId: "task-9",
      taskTitle: "Ship it",
      minted: true,
    });
    expect(link.relationKind).toBe("spawned-from");
    expect(link.source).toEqual(NOTE);
    expect(link.target).toEqual({ type: "task", id: "task-9" });
    expect(link.targetLabel).toBe("Ship it");
  });

  it("linking an existing task = references", () => {
    expect(
      buildTaskLineLink({
        workspaceId: WS,
        note: NOTE,
        noteLabel: "Plan",
        taskId: "task-9",
        taskTitle: "Ship it",
        minted: false,
      }).relationKind,
    ).toBe("references");
  });
});

describe("applyTaskRename (title-sync mapper — renames, not clobbers)", () => {
  it("returns a title-ONLY patch", () => {
    const patch = applyTaskRename(task({ title: "Old" }), "New title");
    expect(patch).toEqual({ title: "New title" }); // nothing else rides along
  });

  it("no-ops on unchanged or emptied text (an empty line never overwrites)", () => {
    expect(applyTaskRename(task({ title: "Same" }), "Same")).toBeNull();
    expect(applyTaskRename(task({ title: "Keep me" }), "   ")).toBeNull();
  });
});

describe("filterTaskCandidates + shouldOfferCreate (the /task picker)", () => {
  const tasks: Task[] = [
    task({ id: "a", title: "Ship the report", updatedAt: "2026-07-01T00:00:00Z" }),
    task({ id: "b", title: "Email Anna", updatedAt: "2026-07-03T00:00:00Z" }),
    task({ id: "c", title: "Done thing", status: "done" }),
    task({ id: "d", title: "Archived thing", status: "archived" }),
    task({ id: "e", title: "Deleted thing", deletedAt: "2026-07-01T00:00:00Z" }),
  ];

  it("offers only open work, most recently touched first on empty query", () => {
    const out = filterTaskCandidates(tasks, "");
    expect(out.map((t) => t.id)).toEqual(["b", "a"]);
  });

  it("fuzzy-matches the query case-insensitively", () => {
    expect(filterTaskCandidates(tasks, "ship").map((t) => t.id)).toEqual(["a"]);
    expect(filterTaskCandidates(tasks, "zzz")).toEqual([]);
  });

  it("offers Create unless an existing task matches exactly", () => {
    expect(shouldOfferCreate("", filterTaskCandidates(tasks, ""))).toBe(false);
    expect(shouldOfferCreate("Ship", filterTaskCandidates(tasks, "Ship"))).toBe(true);
    expect(
      shouldOfferCreate("ship the report", filterTaskCandidates(tasks, "ship the report")),
    ).toBe(false); // exact (ci) match — no create row
  });
});
