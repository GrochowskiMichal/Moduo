// TV-TL2 · dependencies on the Timeline (REPLAN 70, 68b): lines only around
// the selected or hovered task (or all), never to a task the reader doesn't
// have, none to a finished one Display hides; a date that contradicts a
// dependency is shown with its one fix; "Also move the n that wait on this".

import { describe, expect, it } from "@rstest/core";

import { makeTask } from "./helpers";
import type { Task, TaskRelation } from "./model";
import {
  contradictions,
  depEdges,
  edgeShape,
  isTimelineDeps,
  waitingOn,
  waitingWords,
} from "./timeline-deps";
import { dayNumOfKey } from "./timeline-scale";

function task(id: string, over: Partial<Task> = {}): Task {
  return { ...makeTask({ workspaceId: "w", title: id, bucketId: "p", position: id }), id, ...over };
}

function rel(blocker: string, blocked: string): TaskRelation {
  return {
    id: `${blocker}>${blocked}`,
    workspaceId: "w",
    blockerTaskId: blocker,
    blockedTaskId: blocked,
    createdAt: "",
  };
}

const byIdOf = (tasks: Task[]) => new Map(tasks.map((t) => [t.id, t]));
const shown = () => false;

describe("which lines", () => {
  const tasks = [task("a"), task("b"), task("c"), task("d")];
  const relations = [rel("a", "b"), rel("b", "c"), rel("x", "d")];
  const byId = byIdOf(tasks);

  it("draws the selected or hovered task's lines only, or all of them", () => {
    expect(depEdges(relations, byId, "selected", new Set(), shown)).toEqual([]);
    expect(depEdges(relations, byId, "selected", new Set(["a"]), shown)).toEqual([
      { blockerId: "a", blockedId: "b" },
    ]);
    expect(depEdges(relations, byId, "selected", new Set(["b"]), shown)).toHaveLength(2);
    expect(depEdges(relations, byId, "all", new Set(), shown)).toHaveLength(2);
    expect(depEdges(relations, byId, "off", new Set(["a"]), shown)).toEqual([]);
  });

  it("never draws to a task the reader doesn't have", () => {
    // "x" isn't in the reader's copy: its relation draws nothing at all.
    expect(depEdges(relations, byId, "selected", new Set(["d"]), shown)).toEqual([]);
  });

  it("draws no line to a finished task Display hides", () => {
    const done = task("a", { status: "done", statusCategory: "done" } as Partial<Task>);
    const hidden = (t: Task) => t.id === "a";
    expect(
      depEdges(relations, byIdOf([done, ...tasks.slice(1)]), "all", new Set(), hidden),
    ).toEqual([{ blockerId: "b", blockedId: "c" }]);
  });

  it("reads Display's value", () => {
    expect(isTimelineDeps("all")).toBe(true);
    expect(isTimelineDeps("always")).toBe(false);
  });
});

describe("dates that contradict a dependency (68b)", () => {
  const day = (key: string) => dayNumOfKey(key) ?? Number.NaN;

  it("finds a task due before what it waits on, with the day after the latest blocker", () => {
    const tasks = [
      task("export", { dueOn: "2026-11-07", title: "Export logo files" }),
      task("brief", { dueOn: "2026-11-01" }),
      task("launch", { dueOn: "2026-11-03" }),
      task("site", { dueOn: "2026-11-09" }),
    ];
    const found = contradictions(
      [rel("export", "launch"), rel("brief", "launch"), rel("export", "site")],
      byIdOf(tasks),
    );
    expect([...found.keys()]).toEqual(["launch"]);
    expect(found.get("launch")).toEqual({
      blockerId: "export",
      blockerTitle: "Export logo files",
      blockerDay: day("2026-11-07"),
      moveTo: day("2026-11-08"),
    });
  });

  it("isn't one when a date is missing, the blocker is done, or the reader lacks it", () => {
    const tasks = [
      task("a", { dueOn: "2026-11-07", status: "done", statusCategory: "done" } as Partial<Task>),
      task("b", { dueOn: "2026-11-01" }),
      task("c"),
    ];
    const relations = [rel("a", "b"), rel("c", "b"), rel("hidden", "b")];
    expect(contradictions(relations, byIdOf(tasks)).size).toBe(0);
  });
});

describe("Also move the ones that wait on this", () => {
  it("offers the open, dated tasks waiting on the ones moved, not the ones moved with them", () => {
    const tasks = [
      task("a", { dueOn: "2026-11-01" }),
      task("b", { dueOn: "2026-11-03" }),
      task("c", { dueOn: "2026-11-04" }),
      task("d"),
      task("e", { dueOn: "2026-11-05", status: "done", statusCategory: "done" } as Partial<Task>),
    ];
    const relations = [rel("a", "b"), rel("a", "c"), rel("a", "d"), rel("a", "e")];
    expect(waitingOn(new Set(["a"]), relations, byIdOf(tasks)).map((t) => t.id)).toEqual([
      "b",
      "c",
    ]);
    expect(waitingOn(new Set(["a", "b"]), relations, byIdOf(tasks)).map((t) => t.id)).toEqual([
      "c",
    ]);
    expect(waitingWords(3, 1)).toBe("Also move the 3 that wait on this");
    expect(waitingWords(1, 2)).toBe("Also move the one that waits on these");
  });
});

describe("how a line runs", () => {
  it("runs forward from the blocker's point into the waiting one's", () => {
    const shape = edgeShape({ x: 100, y: 18 }, { x: 300, y: 90 });
    expect(shape.backwards).toBe(false);
    expect(shape.d.startsWith("M107 18")).toBe(true);
    expect(shape.d.endsWith("H293")).toBe(true);
  });

  it("comes back into a waiting task due first (backwards), or hooks on the same day", () => {
    const back = edgeShape({ x: 300, y: 18 }, { x: 100, y: 90 });
    expect(back.backwards).toBe(true);
    expect(back.d.endsWith("H107")).toBe(true);
    const same = edgeShape({ x: 200, y: 18 }, { x: 200, y: 90 });
    expect(same.backwards).toBe(false);
    expect(same.d).toContain("V90");
  });
});
