import { describe, expect, it } from "@rstest/core";

import { betweenPositions, endPosition, positionsAfter } from "./helpers";
import { boardDropPosition, moveItem, positionForReorder } from "./reorder";

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
    // Drag the head item to the very end: its new left neighbour is the current
    // max (p2) and nothing sits to its right, so the key must outrank EVERY
    // existing position — p2 included. (The old test only checked it beat p1,
    // so a key landing between p1 and p2 would have passed.)
    const draggedToEnd = [{ position: p1 }, { position: p2 }, { position: p0 }];
    const pos = positionForReorder(draggedToEnd, 2);
    expect(pos > p2).toBe(true);
    expect(pos > p1).toBe(true);
  });

  it("matches betweenPositions for the interior case", () => {
    expect(positionForReorder(ordered, 1)).toBe(betweenPositions(p0, p2));
  });
});

describe("betweenPositions", () => {
  it("subdivides instead of colliding when the integer gap is exhausted", () => {
    // The board bug: slot between the same two neighbours over and over. The old
    // integer-midpoint fallback collapsed to a tie with the upper neighbour after
    // ~20 inserts; precision extension must keep minting strictly-between keys.
    const lo = endPosition([]); // fixed-width start key
    let hi = endPosition([{ position: lo }]); // its neighbour, one STEP above
    let subdivided = false;
    for (let i = 0; i < 60; i += 1) {
      const mid = betweenPositions(lo, hi);
      expect(mid > lo).toBe(true); // strictly above the lower neighbour
      expect(mid < hi).toBe(true); // strictly below the upper neighbour — never a tie
      if (mid.length > lo.length) subdivided = true; // precision grew past fixed width
      hi = mid; // keep shrinking the SAME gap from the top (the pathological case)
    }
    expect(subdivided).toBe(true); // the fixed-width integer room really did run out
  });

  it("subdivides between two adjacent fixed-width keys (the collapse boundary)", () => {
    // Reach an integer-adjacent pair (gap === 1) by halving from the top, then
    // confirm the next insert extends precision rather than tying the bound.
    const lo = endPosition([]);
    let hi = endPosition([{ position: lo }]);
    let prev = hi;
    for (let i = 0; i < 40 && hi.length === lo.length; i += 1) {
      prev = hi;
      hi = betweenPositions(lo, hi);
    }
    // `hi` is now the first sub-fixed-width key — strictly inside (lo, prev).
    expect(hi.length).toBeGreaterThan(lo.length);
    expect(hi > lo).toBe(true);
    expect(hi < prev).toBe(true);
  });

  it("recovers deterministically from an equal (legacy-tie) bound", () => {
    // Degenerate input the old collision could leave behind: equal neighbours.
    // It can't be split, so we must nudge strictly past `a` without looping.
    const k = endPosition([]);
    const out = betweenPositions(k, k);
    expect(out > k).toBe(true);
    expect(betweenPositions(k, k)).toBe(out); // deterministic
  });

  it("legacy over-width keys (16-digit notes positions) never collide", () => {
    // parseInt(base36) on a 16-char key is past float precision — the old
    // integer fast path absorbed +STEP and returned the IDENTICAL string.
    const legacy = "5000000000000000";
    const after = endPosition([{ position: legacy }]);
    expect(after).not.toBe(legacy);
    expect(after > legacy).toBe(true);
    // Open-top step past a legacy key also stays strictly after it.
    const stepped = betweenPositions(legacy, null);
    expect(stepped > legacy).toBe(true);
    // And the result keeps working as a bound for the next insert.
    const between = betweenPositions(legacy, after);
    expect(between > legacy && between < after).toBe(true);
  });

  it("keeps open ends consistent with endPosition", () => {
    const a = endPosition([]);
    // Open top steps by STEP — same key endPosition would mint after `a`.
    expect(betweenPositions(a, null)).toBe(endPosition([{ position: a }]));
    // Open bottom lands strictly below the first key.
    expect(betweenPositions(null, a) < a).toBe(true);
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

// ── positionsAfter (NOTE-FIX-1: bulk insert that must APPEND) ────────────────

describe("positionsAfter", () => {
  it("returns ascending, unique, non-empty keys", () => {
    const out = positionsAfter(4);
    expect(out).toHaveLength(4);
    expect(out.every((p) => p !== "")).toBe(true);
    expect([...out].sort()).toEqual(out);
    expect(new Set(out).size).toBe(out.length);
  });

  it("sorts every new key AFTER every existing sibling", () => {
    // The bug this guards: starting from scratch mints exactly the same first
    // key as `endPosition([])`, so an import collided with the welcome note
    // and scattered itself through the existing tree instead of appending.
    const existing = [endPosition([]), endPosition([{ position: endPosition([]) }])];
    const out = positionsAfter(3, existing);
    const maxExisting = existing.reduce((a, b) => (a > b ? a : b));
    expect(out.every((p) => p > maxExisting)).toBe(true);
    expect([...out].sort()).toEqual(out);
  });

  it("appends past a subdivided (variable-width) key without collapsing", () => {
    // A long key decodes past float precision, where `+ STEP` is absorbed and
    // would mint duplicates forever — the trap `endPosition` documents.
    const existing = ["5000000000000000"];
    const out = positionsAfter(3, existing);
    expect(out.every((p) => p > existing[0]!)).toBe(true);
    expect(new Set(out).size).toBe(3);
    expect([...out].sort()).toEqual(out);
  });

  it("is empty for a zero/negative count", () => {
    expect(positionsAfter(0)).toEqual([]);
    expect(positionsAfter(-3)).toEqual([]);
  });
});

describe("boardDropPosition (TV-U1: hidden completed cards still count)", () => {
  const [a, hiddenDone, b, c] = positionsAfter(4);
  const column = [
    { id: "a", position: a },
    { id: "done", position: hiddenDone }, // hidden by Display, still in the column
    { id: "b", position: b },
  ];

  it("a reorder never lands on a hidden task's key", () => {
    // Drag "b" onto "a" (on screen, only "a" sits above it).
    const pos = boardDropPosition({ activeId: "b", overId: "a", source: column, dest: column });
    expect(pos).not.toBeNull();
    expect((pos as string) < a).toBe(true);
  });

  it("dropping into a column whose cards are all hidden goes after them, not to a fixed key", () => {
    const doneColumn = [
      { id: "d1", position: a },
      { id: "d2", position: b },
    ];
    const pos = boardDropPosition({
      activeId: "x",
      overId: null,
      source: [{ id: "x", position: c }],
      dest: doneColumn,
    });
    expect((pos as string) > b).toBe(true);
    expect(pos).not.toBe(betweenPositions(null, null));
  });

  it("dropping on a card inserts before it, between it and the task before it (hidden or not)", () => {
    const pos = boardDropPosition({
      activeId: "x",
      overId: "b",
      source: [{ id: "x", position: c }],
      dest: column,
    }) as string;
    expect(pos > hiddenDone && pos < b).toBe(true);
  });

  it("is no move on its own column's gutter or onto itself", () => {
    expect(boardDropPosition({ activeId: "a", overId: null, source: column, dest: column })).toBe(
      null,
    );
    expect(boardDropPosition({ activeId: "a", overId: "a", source: column, dest: column })).toBe(
      null,
    );
  });
});
