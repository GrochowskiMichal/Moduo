import { describe, expect, it } from "@rstest/core";
import { nextFlush } from "./engine-v2";

describe("nextFlush (NR-7: peers see edits when saved)", () => {
  it("waits the debounce after a lone edit", () => {
    expect(nextFlush(1000, null)).toEqual({ wait: 400, dueBy: 1800 });
  });

  it("steady typing still saves within 800 ms of the first edit", () => {
    let dueBy: number | null = null;
    const fired: number[] = [];
    // A keystroke every 100 ms for 2 s; each one reschedules.
    let at = 0;
    let fireAt = Number.POSITIVE_INFINITY;
    for (let t = 0; t <= 2000; t += 100) {
      if (t >= fireAt) {
        fired.push(fireAt);
        dueBy = null;
      }
      const next = nextFlush(t, dueBy);
      dueBy = next.dueBy;
      at = t;
      fireAt = at + next.wait;
    }
    expect(fired[0]).toBe(800);
    expect(fired.length).toBeGreaterThanOrEqual(2);
  });

  it("a longer requested delay is kept (the agent body re-save)", () => {
    expect(nextFlush(0, null, 1500)).toEqual({ wait: 1500, dueBy: 1500 });
  });
});
