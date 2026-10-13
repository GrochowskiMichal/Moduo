// A subtask moved among its siblings lands where it was dropped, in the one
// position order every view reads.

import { describe, expect, it } from "@rstest/core";

import { subtaskPositionAt } from "./subtask-order";

const ALL = [
  { id: "p", position: "0000000010" },
  { id: "s1", position: "0000000020" },
  { id: "x", position: "0000000025" }, // another project's task, between them
  { id: "s2", position: "0000000030" },
  { id: "s3", position: "0000000040" },
];
const SIBLINGS = [{ id: "s1" }, { id: "s2" }, { id: "s3" }];

const order = (moving: string, position: string) =>
  ALL.map((t) => (t.id === moving ? { ...t, position } : t))
    .filter((t) => t.id !== "p" && t.id !== "x")
    .sort((a, b) => (a.position < b.position ? -1 : 1))
    .map((t) => t.id);

describe("subtaskPositionAt", () => {
  it("moves up and down among the parent's subtasks", () => {
    const up = subtaskPositionAt(ALL, SIBLINGS, "s3", 0);
    expect(up && order("s3", up)).toEqual(["s3", "s1", "s2"]);
    const down = subtaskPositionAt(ALL, SIBLINGS, "s1", 2);
    expect(down && order("s1", down)).toEqual(["s2", "s3", "s1"]);
    const oneUp = subtaskPositionAt(ALL, SIBLINGS, "s2", 0);
    expect(oneUp && order("s2", oneUp)).toEqual(["s2", "s1", "s3"]);
  });

  it("nothing to write at its own place or past either end", () => {
    expect(subtaskPositionAt(ALL, SIBLINGS, "s2", 1)).toBeNull();
    expect(subtaskPositionAt(ALL, SIBLINGS, "s1", -1)).toBeNull();
    expect(subtaskPositionAt(ALL, SIBLINGS, "s3", 3)).toBeNull();
    expect(subtaskPositionAt(ALL, SIBLINGS, "nope", 0)).toBeNull();
  });
});
