import { describe, expect, it } from "vitest";

import { createSendHold } from "./undo-send";

/** A manual clock so we can assert "fires only after the window". */
function fakeClock() {
  let seq = 0;
  const tasks = new Map<number, () => void>();
  return {
    schedule: (fn: () => void) => {
      const id = ++seq;
      tasks.set(id, fn);
      return id;
    },
    cancel: (h: unknown) => {
      tasks.delete(h as number);
    },
    fire: () => {
      for (const [, fn] of tasks) fn();
      tasks.clear();
    },
    size: () => tasks.size,
  };
}

describe("createSendHold", () => {
  it("sends only after the window elapses", () => {
    const clock = fakeClock();
    const sent: string[] = [];
    const hold = createSendHold<string, string>({
      delayMs: 10_000,
      send: (input) => sent.push(input),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    hold.start("msg-1", "draft-1");
    expect(sent).toEqual([]); // nothing sent yet
    expect(hold.pending()).toBe(true);

    clock.fire();
    expect(sent).toEqual(["msg-1"]); // fired once, after the window
    expect(hold.pending()).toBe(false);
  });

  it("undo cancels the send and returns the draft to restore", () => {
    const clock = fakeClock();
    const sent: string[] = [];
    const hold = createSendHold<string, string>({
      delayMs: 10_000,
      send: (input) => sent.push(input),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    hold.start("msg-1", "draft-1");
    expect(hold.undo()).toBe("draft-1");
    clock.fire(); // the timer was cancelled
    expect(sent).toEqual([]);
    expect(hold.pending()).toBe(false);
  });

  it("abandon (quit inside the window) sends nothing and hands back the draft", () => {
    const clock = fakeClock();
    const sent: string[] = [];
    const hold = createSendHold<string, string>({
      delayMs: 10_000,
      send: (input) => sent.push(input),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    hold.start("msg-1", "draft-1");
    expect(hold.abandon()).toBe("draft-1");
    clock.fire();
    expect(sent).toEqual([]);
  });

  it("a second start replaces the first (no double send)", () => {
    const clock = fakeClock();
    const sent: string[] = [];
    const hold = createSendHold<string, string>({
      delayMs: 10_000,
      send: (input) => sent.push(input),
      schedule: clock.schedule,
      cancel: clock.cancel,
    });

    hold.start("msg-1", "draft-1");
    hold.start("msg-2", "draft-2");
    expect(clock.size()).toBe(1); // the first timer was cancelled
    clock.fire();
    expect(sent).toEqual(["msg-2"]);
  });
});
