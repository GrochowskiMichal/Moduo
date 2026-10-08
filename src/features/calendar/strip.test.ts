import { describe, expect, it } from "@rstest/core";
import type { LensTask } from "./lens";
import { stripItems } from "./strip";

const NOW = new Date(2026, 6, 10, 14, 0); // Fri Jul 10 2026, 14:00
const nowMs = NOW.getTime();

function task(over: Partial<LensTask>): LensTask {
  return {
    id: over.id ?? "t1",
    title: over.title ?? "task",
    scheduledAt: over.scheduledAt ?? null,
    durationMinutes: over.durationMinutes ?? 30,
    status: over.status ?? "todo",
    deletedAt: over.deletedAt ?? null,
  };
}
function iso(y: number, mo: number, d: number, h: number, mi = 0): string {
  return new Date(y, mo, d, h, mi).toISOString();
}

describe("strip — the 7-day drift window (AC9)", () => {
  it("includes an open task scheduled earlier today whose block has passed", () => {
    const items = stripItems([task({ id: "a", scheduledAt: iso(2026, 6, 10, 9, 0) })], nowMs);
    expect(items.map((i) => i.taskId)).toEqual(["a"]);
  });

  it("includes an open task from the previous days (within 7)", () => {
    const items = stripItems([task({ id: "b", scheduledAt: iso(2026, 6, 8, 10, 0) })], nowMs);
    expect(items.map((i) => i.taskId)).toEqual(["b"]);
  });

  it("excludes a task still in the future today (not yet elapsed)", () => {
    const items = stripItems([task({ id: "c", scheduledAt: iso(2026, 6, 10, 16, 0) })], nowMs);
    expect(items).toEqual([]);
  });

  it("excludes a task whose block is currently in progress (end still ahead)", () => {
    // 13:45 + 30m = 14:15, ahead of now (14:00) → not unfinished-from-earlier.
    const items = stripItems([task({ id: "d", scheduledAt: iso(2026, 6, 10, 13, 45) })], nowMs);
    expect(items).toEqual([]);
  });

  it("drops tasks older than the 7-day look-back", () => {
    const items = stripItems([task({ id: "old", scheduledAt: iso(2026, 6, 1, 9, 0) })], nowMs);
    expect(items).toEqual([]);
  });

  it("never includes done or archived tasks (they aren't unfinished)", () => {
    const items = stripItems(
      [
        task({ id: "done", scheduledAt: iso(2026, 6, 9, 9, 0), status: "done" }),
        task({ id: "arch", scheduledAt: iso(2026, 6, 9, 9, 0), status: "archived" }),
      ],
      nowMs,
    );
    expect(items).toEqual([]);
  });

  it("never includes unscheduled tasks", () => {
    const items = stripItems([task({ id: "u", scheduledAt: null })], nowMs);
    expect(items).toEqual([]);
  });

  it("orders items by original scheduled time and carries duration", () => {
    const items = stripItems(
      [
        task({ id: "later", scheduledAt: iso(2026, 6, 10, 11, 0), durationMinutes: 45 }),
        task({ id: "earlier", scheduledAt: iso(2026, 6, 9, 9, 0) }),
      ],
      nowMs,
    );
    expect(items.map((i) => i.taskId)).toEqual(["earlier", "later"]);
    expect(items[1]).toMatchObject({ durationMinutes: 45 });
  });

  it("defaults a duration-less task to a 30-minute block", () => {
    const items = stripItems(
      [task({ id: "n", scheduledAt: iso(2026, 6, 10, 9, 0), durationMinutes: null })],
      nowMs,
    );
    expect(items[0].durationMinutes).toBe(30);
  });

  it("excludes session-acknowledged ids (a 'took longer' chip)", () => {
    const items = stripItems(
      [task({ id: "worked", scheduledAt: iso(2026, 6, 10, 9, 0) })],
      nowMs,
      new Set(["worked"]),
    );
    expect(items).toEqual([]);
  });
});
