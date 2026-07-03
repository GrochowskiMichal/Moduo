import { describe, expect, it } from "vitest";

import { elapsedBlockIds, elapsedBlocks, isElapsedBlock } from "./elapsed";
import type { TaskBlock } from "./lens";

function block(over: Partial<TaskBlock>): TaskBlock {
  const startMs = over.startMs ?? new Date(2026, 6, 2, 9, 0).getTime();
  return {
    taskId: over.taskId ?? "t1",
    title: over.title ?? "task",
    startMs,
    endMs: over.endMs ?? startMs + 30 * 60_000,
    durationMinutes: over.durationMinutes ?? 30,
    done: over.done ?? false,
    dayKey: over.dayKey ?? "2026-07-02",
  };
}

describe("elapsed — elapse detection (AC8)", () => {
  const now = new Date(2026, 6, 2, 14, 0).getTime();

  it("flags an open block whose end has passed", () => {
    const b = block({ startMs: new Date(2026, 6, 2, 9, 0).getTime() }); // 9:00–9:30
    expect(isElapsedBlock(b, now)).toBe(true);
  });

  it("does not flag a block whose end is still ahead", () => {
    const b = block({ startMs: new Date(2026, 6, 2, 15, 0).getTime() }); // 15:00–15:30
    expect(isElapsedBlock(b, now)).toBe(false);
  });

  it("never flags a done block (it sits serenely)", () => {
    const b = block({ startMs: new Date(2026, 6, 2, 9, 0).getTime(), done: true });
    expect(isElapsedBlock(b, now)).toBe(false);
  });

  it("treats the exact end instant as elapsed (end <= now)", () => {
    const startMs = new Date(2026, 6, 2, 13, 30).getTime();
    const b = block({ startMs, endMs: now }); // ends exactly at now
    expect(isElapsedBlock(b, now)).toBe(true);
  });

  it("wake-up catch-up: a block that ended long ago still flags on re-eval", () => {
    const b = block({ startMs: new Date(2026, 6, 2, 8, 0).getTime() });
    // Tab was asleep; the next tick re-evaluates with a much later `now`.
    const muchLater = new Date(2026, 6, 2, 18, 0).getTime();
    expect(isElapsedBlock(b, muchLater)).toBe(true);
  });

  it("elapsedBlocks / elapsedBlockIds return only the open, passed blocks", () => {
    const blocks = [
      block({ taskId: "past", startMs: new Date(2026, 6, 2, 9, 0).getTime() }),
      block({ taskId: "future", startMs: new Date(2026, 6, 2, 16, 0).getTime() }),
      block({ taskId: "done", startMs: new Date(2026, 6, 2, 9, 0).getTime(), done: true }),
    ];
    expect(elapsedBlocks(blocks, now).map((b) => b.taskId)).toEqual(["past"]);
    expect(elapsedBlockIds(blocks, now)).toEqual(new Set(["past"]));
  });
});
