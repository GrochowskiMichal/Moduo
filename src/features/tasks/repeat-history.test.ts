// TV-U13b — a repeat's cycles as the panel reads them.

import { describe, expect, it } from "@rstest/core";

import { cycleLine, historySummary } from "./repeat-history";

const NOW = new Date(2026, 9, 13, 12, 0);

describe("historySummary", () => {
  it("counts this task's live completions and names the last day", () => {
    const rows = [
      { taskId: "t1", completedAt: new Date(2026, 9, 6, 9).toISOString(), deletedAt: null },
      { taskId: "t1", completedAt: new Date(2026, 9, 12, 9).toISOString(), deletedAt: null },
      { taskId: "t1", completedAt: new Date(2026, 9, 13, 9).toISOString(), deletedAt: "x" },
      { taskId: "t2", completedAt: new Date(2026, 9, 13, 9).toISOString(), deletedAt: null },
    ];
    expect(historySummary(rows, "t1", NOW)).toBe("2 done · last Yesterday");
  });

  it('reads "History" before any cycle is done', () => {
    expect(historySummary([], "t1", NOW)).toBe("History");
  });
});

describe("cycleLine", () => {
  const nameOf = (id: string) => (id === "u2" ? "Mike" : null);

  it("dates a cycle by its occurrence, says who closed it, and only your time", () => {
    const line = cycleLine(
      {
        kind: "done",
        at: new Date(2026, 9, 8, 9).toISOString(),
        cycle: new Date(2026, 9, 6, 9).toISOString(),
        by: "u2",
        mySeconds: 1500,
      },
      "u1",
      nameOf,
      NOW,
    );
    expect(line).toEqual({ day: "Oct 6", what: "Done by Mike", mine: "your time 25m" });
  });

  it("a skip by you, a one-off key, and nobody known", () => {
    const at = new Date(2026, 9, 12, 9).toISOString();
    expect(
      cycleLine({ kind: "skipped", at, cycle: "once", by: "u1", mySeconds: 0 }, "u1", nameOf, NOW),
    ).toEqual({ day: "Yesterday", what: "Skipped by you", mine: null });
    expect(
      cycleLine({ kind: "done", at, cycle: null, by: null, mySeconds: 0 }, "u1", nameOf, NOW).what,
    ).toBe("Done");
  });
});
