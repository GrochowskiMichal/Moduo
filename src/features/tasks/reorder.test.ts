import { describe, expect, it } from "vitest";

import { betweenPositions, endPosition } from "./helpers";
import { commitOrderUpdates, moveItem, positionForReorder } from "./reorder";

describe("commitOrderUpdates", () => {
  const queue = [
    { id: "a", commitOrder: 1 },
    { id: "b", commitOrder: 2 },
    { id: "c", commitOrder: 3 },
  ];

  it("returns only the rows whose rank changed (1-based, contiguous)", () => {
    // move c to the front: c→1, a→2, b→3 (every row moved)
    expect(commitOrderUpdates(["c", "a", "b"], queue)).toEqual([
      { id: "c", commitOrder: 1 },
      { id: "a", commitOrder: 2 },
      { id: "b", commitOrder: 3 },
    ]);
  });

  it("writes nothing when the order is unchanged", () => {
    expect(commitOrderUpdates(["a", "b", "c"], queue)).toEqual([]);
  });

  it("only persists the moved span on a small move", () => {
    // swap b and c: a stays 1, c→2, b→3
    expect(commitOrderUpdates(["a", "c", "b"], queue)).toEqual([
      { id: "c", commitOrder: 2 },
      { id: "b", commitOrder: 3 },
    ]);
  });

  it("self-heals sparse / legacy numbering to a contiguous 1..N", () => {
    const sparse = [
      { id: "a", commitOrder: 5 },
      { id: "b", commitOrder: 9 },
      { id: "c", commitOrder: null },
    ];
    expect(commitOrderUpdates(["a", "b", "c"], sparse)).toEqual([
      { id: "a", commitOrder: 1 },
      { id: "b", commitOrder: 2 },
      { id: "c", commitOrder: 3 },
    ]);
  });

  it("ignores ids not in the current queue", () => {
    expect(commitOrderUpdates(["a", "ghost", "b", "c"], queue)).toEqual([]);
  });
});

describe("positionForReorder", () => {
  // a stable, sorted position ladder
  const p0 = endPosition([]);
  const p1 = endPosition([{ position: p0 }]);
  const p2 = endPosition([{ position: p0 }, { position: p1 }]);
  const ordered = [{ position: p0 }, { position: p1 }, { position: p2 }];

  it("slots strictly between the new neighbours (middle)", () => {
    // moved task sits at index 1, between p0 and p2
    const pos = positionForReorder(ordered, 1);
    expect(pos > p0).toBe(true);
    expect(pos < p2).toBe(true);
  });

  it("sorts before everything at the head", () => {
    const pos = positionForReorder(ordered, 0);
    expect(pos < p1).toBe(true);
  });

  it("sorts after everything at the tail", () => {
    const pos = positionForReorder(ordered, ordered.length - 1);
    expect(pos > p1).toBe(true);
  });

  it("matches betweenPositions for the interior case", () => {
    expect(positionForReorder(ordered, 1)).toBe(betweenPositions(p0, p2));
  });
});

describe("moveItem", () => {
  it("moves an item forward", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item backward", () => {
    expect(moveItem(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("is a no-op when from === to", () => {
    expect(moveItem(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"];
    moveItem(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });
});
