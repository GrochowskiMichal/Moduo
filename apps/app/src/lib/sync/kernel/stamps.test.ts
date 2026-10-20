// Characterization (Track C1): what each caller does with a missing or
// unreadable stamp, pinned before the copies were folded into the kernel.
// Tasks (store, live layer, tags) take an unknown stamp as newer; Chat takes
// it as the epoch. The old names still answer exactly as they did.

import { describe, expect, it } from "@rstest/core";

import { isNewerRow, laterStamp } from "../../../features/chat/store/keys";
import { stampMinus as stampMinusTasks } from "../store";
import {
  isNewer,
  isNewerStamp,
  laterOf,
  micros,
  newestOf,
  stampMinus,
  timestampMicros,
} from "./stamps";

const T1 = "2026-10-11T10:00:00.000001+00:00";
const T2 = "2026-10-11 10:00:00.000002+00";
const BAD = "not a stamp";

describe("timestampMicros", () => {
  it("reads PostgREST's and Realtime's spellings to the microsecond", () => {
    expect(timestampMicros(T2)! - timestampMicros(T1)!).toBe(1);
    expect(timestampMicros("2026-10-11T10:00:00+0200")).toBe(
      timestampMicros("2026-10-11T08:00:00Z"),
    );
  });

  it("answers null for nothing and for words", () => {
    expect(timestampMicros(null)).toBeNull();
    expect(timestampMicros("")).toBeNull();
    expect(timestampMicros(BAD)).toBeNull();
  });

  it("micros puts a caller's floor in for a missing stamp", () => {
    expect(micros(BAD, 0)).toBe(0);
    expect(micros(null, Number.NEGATIVE_INFINITY)).toBe(Number.NEGATIVE_INFINITY);
    expect(micros(T1, 0)).toBe(timestampMicros(T1));
  });
});

describe("stampMinus keeps the microseconds", () => {
  it("moves back by milliseconds", () => {
    expect(stampMinus(T1, 5 * 60_000)).toBe("2026-10-11T09:55:00.000001+00:00");
    expect(stampMinusTasks).toBe(stampMinus);
  });

  it("leaves an unreadable stamp as it is", () => {
    expect(stampMinus(BAD, 1000)).toBe(BAD);
  });
});

describe("Tasks' rule: anything beats an unknown held stamp", () => {
  it.each([
    [T2, T1, true],
    [T1, T2, false],
    [T1, T1, false],
    [null, T1, false],
    [T1, null, true],
    [null, null, true],
    [BAD, T1, false],
    [T1, BAD, true],
    [BAD, BAD, true],
  ] as const)("isNewer(%s, %s) is %s", (a, b, want) => {
    expect(isNewer(a, b)).toBe(want);
    expect(isNewerStamp(a, b, "newer")).toBe(want);
  });

  it("newestOf takes the newer cursor; a missing one loses", () => {
    expect(newestOf(T1, T2)).toBe(T2);
    expect(newestOf(T2, T1)).toBe(T2);
    expect(newestOf(null, T1)).toBe(T1);
    expect(newestOf(T1, null)).toBe(T1);
    expect(newestOf("", T1)).toBe(T1);
    // Two unreadable stamps: the second wins (unknown counts as newer).
    expect(newestOf(BAD, "also bad")).toBe("also bad");
    expect(newestOf(BAD, T1)).toBe(T1);
    expect(newestOf(T1, BAD)).toBe(T1);
  });
});

describe("Chat's rule: an unknown stamp is the epoch", () => {
  const row = (updatedAt: string) => ({ updatedAt });

  it.each([
    [T2, T1, true],
    [T1, T2, false],
    [T1, T1, false],
    [BAD, T1, false],
    [T1, BAD, true],
    [BAD, BAD, false],
  ] as const)("isNewerRow(%s, %s) is %s", (a, b, want) => {
    expect(isNewerRow(row(a) as never, row(b) as never)).toBe(want);
    expect(isNewerStamp(a, b, "oldest")).toBe(want);
  });

  it("a row the store doesn't hold is always newer", () => {
    expect(isNewerRow(row(BAD) as never, undefined)).toBe(true);
  });

  it("laterStamp keeps the first of two equal or unreadable stamps", () => {
    expect(laterStamp(T1, T2)).toBe(T2);
    expect(laterStamp(T2, T1)).toBe(T2);
    expect(laterStamp(null, T1)).toBe(T1);
    expect(laterStamp(T1, null)).toBe(T1);
    expect(laterStamp(BAD, "also bad")).toBe(BAD);
    expect(laterStamp(BAD, T1)).toBe(T1);
    expect(laterStamp(T1, BAD)).toBe(T1);
    expect(laterOf(T1, BAD, "oldest")).toBe(T1);
  });
});
