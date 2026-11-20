// CALR-16 contract (specs/calendar-rethink.md AC19, §Scheduling "With a
// teammate"): naming a teammate in the composer shows their busy time while
// you type, ⇥ finds a time every named teammate is free, and the echo gives
// each one's verdict: free, busy or in focus time. Your own clash still leads
// the echo on its own (a teammate's block is never "your" clash).

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { clashFor, hopFreeTime } from "./composer/hops";
import type { ComposerBusy } from "./composer/parse";
import { freeForAll, teammateBusyOn, verdictFor, verdictLine, verdictsEcho } from "./free-time";
import type { TeammateBlock } from "./teammates";

const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).getTime();
const day = (d: number) => at(d, 0);
const NOW = at(2, 8); // Monday morning
const WORK = { nowMs: NOW, workStartMinute: 9 * 60, workEndMinute: 18 * 60 };

function block(
  over: Partial<TeammateBlock> & { ownerId: string; startMs: number; endMs: number },
): TeammateBlock {
  return { calendarId: `c-${over.ownerId}`, kind: "event", title: null, eventId: null, ...over };
}

const BLOCKS: TeammateBlock[] = [
  block({
    ownerId: "kai",
    startMs: at(3, 9),
    endMs: at(3, 10),
    title: "Design review",
    eventId: "k1",
  }),
  block({ ownerId: "kai", startMs: at(3, 10, 30), endMs: at(3, 12), kind: "focus" }),
  block({ ownerId: "nora", startMs: at(3, 10), endMs: at(3, 11) }),
  block({ ownerId: "ana", startMs: at(3, 9), endMs: at(3, 18) }), // not named below
];

const mine: Record<number, ComposerBusy[]> = {
  [day(3)]: [{ startMs: at(3, 12), endMs: at(3, 13), title: "Lunch with Tom" }],
};
const ownBusy = (d: number) => mine[d] ?? [];

describe("free for everyone named", () => {
  it("a teammate's busy time is theirs alone, by day", () => {
    const kai = teammateBusyOn(BLOCKS, ["kai"]);
    expect(kai(day(3)).map((b) => b.startMs)).toEqual([at(3, 9), at(3, 10, 30)]);
    expect(kai(day(4))).toEqual([]);
    expect(teammateBusyOn(BLOCKS, [])(day(3))).toEqual([]);
  });

  it("⇥ skips your busy time and every named teammate's", () => {
    const busyOn = freeForAll(ownBusy, BLOCKS, ["kai", "nora"]);
    // From Tue 9:00 (30 min): Kai 9–10, Nora 10–11, Kai focus 10:30–12, you 12–13.
    const next = hopFreeTime({
      ...WORK,
      busyOn,
      startMs: at(3, 8, 45),
      endMs: at(3, 9, 15),
      direction: 1,
    });
    expect(next).toEqual({ startMs: at(3, 13), endMs: at(3, 13, 30) });
  });

  it("someone you didn't name doesn't block a time", () => {
    const busyOn = freeForAll(ownBusy, BLOCKS, ["nora"]);
    const next = hopFreeTime({
      ...WORK,
      busyOn,
      startMs: at(3, 8, 45),
      endMs: at(3, 9, 15),
      direction: 1,
    });
    expect(next).toEqual({ startMs: at(3, 9), endMs: at(3, 9, 30) });
  });

  it("your own clash still leads the echo; a teammate's block is not your clash", () => {
    const busyOn = freeForAll(ownBusy, BLOCKS, ["kai"]);
    expect(busyOn(day(3)).length).toBe(3);
    expect(clashFor(at(3, 9), at(3, 9, 30), ownBusy)).toBeNull();
    expect(clashFor(at(3, 12), at(3, 12, 30), ownBusy)?.title).toBe("Lunch with Tom");
  });

  it("verdicts read free, busy or in focus time", () => {
    expect(verdictFor(BLOCKS, "kai", at(3, 9), at(3, 9, 30), true)).toBe("busy");
    expect(verdictFor(BLOCKS, "kai", at(3, 11), at(3, 11, 30), true)).toBe("focus");
    expect(verdictFor(BLOCKS, "kai", at(3, 13), at(3, 13, 30), true)).toBe("free");
    // Busy wins over focus when the slot touches both.
    expect(verdictFor(BLOCKS, "kai", at(3, 9, 30), at(3, 11), true)).toBe("busy");
    // Touching edges is free.
    expect(verdictFor(BLOCKS, "nora", at(3, 11), at(3, 12), true)).toBe("free");
    // A teammate who shares nothing with you: their time can't be known.
    expect(verdictFor([], "omar", at(3, 9), at(3, 10), false)).toBe("unknown");
  });

  it("each verdict is one line, and the echo joins them", () => {
    expect(verdictLine("Kai Ito", "free")).toBe("Kai Ito is free");
    expect(verdictLine("Kai Ito", "busy")).toBe("Kai Ito is busy");
    expect(verdictLine("Kai Ito", "focus")).toBe("Kai Ito is in focus time");
    expect(verdictLine("Omar Diaz", "unknown")).toBe("Omar Diaz doesn't share their calendar");
    expect(
      verdictsEcho([
        { name: "Kai Ito", verdict: "focus" },
        { name: "Nora Ruiz", verdict: "free" },
      ]),
    ).toBe("Kai Ito is in focus time · Nora Ruiz is free");
    expect(verdictsEcho([])).toBe("");
  });
});
