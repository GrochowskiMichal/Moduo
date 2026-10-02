import { describe, expect, it } from "vitest";

import { blockedTaskIds, frontierTasks, makeTask, wouldCreateCycle } from "./helpers";
import type { Task, TaskRelation, TaskStatus } from "./model";

function task(id: string, opts: { status?: TaskStatus } = {}): Task {
  const t = makeTask({ workspaceId: "w", bucketId: "b", title: id.toUpperCase(), position: id });
  t.id = id;
  t.status = opts.status ?? "todo";
  return t;
}

function edge(blockerId: string, blockedId: string): TaskRelation {
  return {
    id: `${blockerId}->${blockedId}`,
    workspaceId: "w",
    blockerTaskId: blockerId,
    blockedTaskId: blockedId,
    createdAt: "2026-06-12T00:00:00Z",
  };
}

describe("blockedTaskIds", () => {
  it("marks a task blocked when a live, open blocker exists", () => {
    const ids = blockedTaskIds([task("a"), task("b")], [edge("a", "b")]);
    expect(ids.has("b")).toBe(true);
    expect(ids.has("a")).toBe(false);
  });

  it("a done or archived blocker doesn't block (zero writes to unblock)", () => {
    expect(blockedTaskIds([task("a", { status: "done" }), task("b")], [edge("a", "b")]).size).toBe(
      0,
    );
    expect(
      blockedTaskIds([task("a", { status: "archived" }), task("b")], [edge("a", "b")]).size,
    ).toBe(0);
  });

  it("an edge whose blocker doesn't resolve (deleted) is inert", () => {
    expect(blockedTaskIds([task("b")], [edge("ghost", "b")]).size).toBe(0);
  });

  it("re-opening a blocker re-blocks its dependents", () => {
    const blocker = task("a", { status: "done" });
    expect(blockedTaskIds([blocker, task("b")], [edge("a", "b")]).size).toBe(0);
    blocker.status = "todo";
    expect(blockedTaskIds([blocker, task("b")], [edge("a", "b")]).has("b")).toBe(true);
  });
});

describe("frontierTasks", () => {
  it("a directly blocked task's frontier is its open, unblocked blockers", () => {
    const tasks = [task("a"), task("b")];
    expect(frontierTasks("b", tasks, [edge("a", "b")]).map((t) => t.id)).toEqual(["a"]);
  });

  it("walks up a chain to the topmost open blockers", () => {
    // a ← b ← c  (a blocks b, b blocks c): c's frontier is a, not b.
    const tasks = [task("a"), task("b"), task("c")];
    const rels = [edge("a", "b"), edge("b", "c")];
    expect(frontierTasks("c", tasks, rels).map((t) => t.id)).toEqual(["a"]);
  });

  it("skips done blockers and dedupes a diamond", () => {
    // a → b → d and a → c → d, with b done: d's open blocker is c, which is
    // itself blocked by a — the walk climbs to a, once (visited-set dedupe).
    const tasks = [task("a"), task("b", { status: "done" }), task("c"), task("d")];
    const rels = [edge("a", "b"), edge("b", "d"), edge("a", "c"), edge("c", "d")];
    expect(frontierTasks("d", tasks, rels).map((t) => t.id)).toEqual(["a"]);
  });

  it("is non-empty for any blocked task on a DAG", () => {
    const tasks = [task("a"), task("b"), task("c"), task("d")];
    const rels = [edge("a", "b"), edge("b", "c"), edge("c", "d")];
    expect(frontierTasks("d", tasks, rels).length).toBeGreaterThan(0);
  });

  it("returns empty for an unblocked task", () => {
    expect(frontierTasks("a", [task("a")], [])).toEqual([]);
  });

  it("survives a cycle (defensive — the DB forbids them)", () => {
    const tasks = [task("a"), task("b")];
    const rels = [edge("a", "b"), edge("b", "a")];
    // Both blocked, neither unblocked — frontier is empty, but no infinite loop.
    expect(frontierTasks("a", tasks, rels)).toEqual([]);
  });
});

describe("wouldCreateCycle", () => {
  it("rejects a self-edge", () => {
    expect(wouldCreateCycle("a", "a", [])).toBe(true);
  });

  it("rejects a direct reverse edge", () => {
    expect(wouldCreateCycle("b", "a", [edge("a", "b")])).toBe(true);
  });

  it("rejects a transitive cycle", () => {
    // a → b → c exists; adding c → a would close the loop.
    expect(wouldCreateCycle("c", "a", [edge("a", "b"), edge("b", "c")])).toBe(true);
  });

  it("allows a new edge that keeps the graph a DAG", () => {
    expect(wouldCreateCycle("a", "c", [edge("a", "b"), edge("b", "c")])).toBe(false);
    expect(wouldCreateCycle("x", "y", [])).toBe(false);
  });
});
