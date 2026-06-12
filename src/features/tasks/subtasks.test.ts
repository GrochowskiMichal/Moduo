import { describe, expect, it } from "vitest";

import { makeTask, nestedSubtaskIds, subtaskProgress, subtasksByParent } from "./helpers";
import type { Task, TaskStatus } from "./model";

function task(
  id: string,
  opts: { parentId?: string | null; status?: TaskStatus; position?: string } = {},
): Task {
  const t = makeTask({
    workspaceId: "w",
    bucketId: "b",
    title: id.toUpperCase(),
    position: opts.position ?? id,
    parentId: opts.parentId ?? null,
  });
  t.id = id;
  t.status = opts.status ?? "todo";
  return t;
}

describe("subtasksByParent", () => {
  it("keys children by parent, keeping incoming order", () => {
    const map = subtasksByParent([
      task("p"),
      task("c1", { parentId: "p" }),
      task("c2", { parentId: "p" }),
      task("other"),
    ]);
    expect(map.get("p")?.map((t) => t.id)).toEqual(["c1", "c2"]);
    expect(map.has("other")).toBe(false);
  });

  it("ignores a parentId that doesn't resolve in the set (orphans stay top-level)", () => {
    const map = subtasksByParent([task("c1", { parentId: "deleted-parent" })]);
    expect(map.size).toBe(0);
  });

  it("ignores self-referencing tasks", () => {
    const map = subtasksByParent([task("a", { parentId: "a" })]);
    expect(map.size).toBe(0);
  });
});

describe("subtaskProgress", () => {
  it("counts done over total", () => {
    expect(
      subtaskProgress([task("a", { status: "done" }), task("b"), task("c", { status: "in_progress" })]),
    ).toEqual({ done: 1, total: 3 });
  });

  it("excludes archived subtasks from both sides (terminal, out of open lists)", () => {
    expect(
      subtaskProgress([task("a", { status: "done" }), task("b", { status: "archived" })]),
    ).toEqual({ done: 1, total: 1 });
  });
});

describe("nestedSubtaskIds", () => {
  const parent = task("p");
  const child = task("c", { parentId: "p" });

  it("hides a subtask whose parent is in the same scope", () => {
    expect(nestedSubtaskIds([parent, child])).toEqual(new Set(["c"]));
  });

  it("keeps a subtask top-level when its parent is out of scope (never invisible)", () => {
    expect(nestedSubtaskIds([child]).size).toBe(0);
  });

  it("nests nothing when nest=false (Today's queue stays flat)", () => {
    expect(nestedSubtaskIds([parent, child], false).size).toBe(0);
  });
});
