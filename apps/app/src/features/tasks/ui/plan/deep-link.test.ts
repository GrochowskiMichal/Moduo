// The deep-link machine (DF-1, MOD-28): each race the plan view's comments
// named, as a sequence of events.

import { describe, expect, it } from "@rstest/core";

import type { HandleLinkStep, TasksDeepLinkTarget } from "../../search";
import {
  DEEP_LINK_START,
  deepLinkAt,
  type DeepLinkEvent,
  deepLinkReducer,
  type DeepLinkState,
  type DeepLinkWorld,
  HANDLE_RETRY_MS,
  linkSettled,
} from "./deep-link";

function world(over: Partial<DeepLinkWorld> = {}): DeepLinkWorld {
  return {
    ready: true,
    restLoaded: true,
    handleStep: () => null,
    target: (id): TasksDeepLinkTarget =>
      id === "t1"
        ? { kind: "task", taskId: "t1", scope: "projA" }
        : id === "projA"
          ? { kind: "bucket", scope: "projA" }
          : { kind: "none" },
    inScope: () => false,
    canLookup: true,
    ...over,
  };
}

/** Run events from a state, collecting every command. */
function play(events: DeepLinkEvent[], from: DeepLinkState = DEEP_LINK_START) {
  let state = from;
  const commands = [];
  for (const event of events) {
    const step = deepLinkReducer(state, event);
    state = step.state;
    commands.push(...step.commands);
  }
  return { state, commands };
}

const url = (id: string | null, intent = false): DeepLinkEvent => ({
  type: "urlChanged",
  id,
  intent,
});
const evaluate = (w: DeepLinkWorld = world()): DeepLinkEvent => ({ type: "evaluate", world: w });

describe("deepLinkReducer", () => {
  it("an inbound link holds everything else until the bundle answers it (DF-1)", () => {
    // Arrival: the bundle is still loading, so the link waits and the
    // last-place default, the backstop and the mirror all hold.
    const waiting = play([url("t1", true), evaluate(world({ ready: false }))]);
    expect(waiting.state.phase.kind).toBe("awaitingLoad");
    expect(linkSettled(waiting.state)).toBe(false);
    expect(waiting.commands).toEqual([]);
    // Loaded: the link wins over wherever the default put the place.
    const answered = play([evaluate()], waiting.state);
    expect(answered.commands).toEqual([
      { kind: "openTask", taskId: "t1", snapTo: "projA", external: true },
    ]);
    expect(answered.state.phase).toEqual({ kind: "resolved", id: "t1" });
    expect(linkSettled(answered.state)).toBe(true);
  });

  it("reads a newer address bar as waiting already, before its event (the arrival flush)", () => {
    const resolved = play([url("t1"), evaluate()]).state;
    expect(linkSettled(deepLinkAt(resolved, "t2"))).toBe(false);
    expect(deepLinkAt(resolved, "t1")).toBe(resolved);
  });

  it("snaps the place only when the open one doesn't show the task", () => {
    const shown = play([url("t1"), evaluate(world({ inScope: (id) => id === "t1" }))]);
    expect(shown.commands).toEqual([
      { kind: "openTask", taskId: "t1", snapTo: null, external: false },
    ]);
    const elsewhere = play([url("t1"), evaluate()]);
    expect(elsewhere.commands[0]).toMatchObject({ snapTo: "projA" });
  });

  it("never re-applies its own mirrored id, even while the router hasn't committed it", () => {
    const at = play([url("t1"), evaluate()]).state;
    // The cursor moved on; the mirror wrote t2, but the URL still says t1.
    const written = play([{ type: "mirrorWritten", id: "t2" }, evaluate(), evaluate()], at);
    expect(written.commands).toEqual([]);
    expect(linkSettled(written.state)).toBe(true);
    // The write lands: it's ours, not a link.
    const landed = play([url("t2"), evaluate()], written.state);
    expect(landed.commands).toEqual([]);
    expect(landed.state.phase).toEqual({ kind: "resolved", id: "t2" });
  });

  it("opens a project link as a place and lets a stale id go", () => {
    expect(play([url("projA"), evaluate()]).commands).toEqual([
      { kind: "openPlace", place: "projA" },
    ]);
    expect(play([url("gone", true), evaluate()]).commands).toEqual([
      { kind: "gone", id: "gone", external: true },
    ]);
    // Done, Won't do and Backlog may still be on their way: not gone yet.
    expect(play([url("gone"), evaluate(world({ restLoaded: false }))]).commands).toEqual([]);
  });

  it("a handle waits for the rest, asks the server, fails, retries and follows (MOD-28)", () => {
    const step = (s: HandleLinkStep["kind"]): ((id: string) => HandleLinkStep | null) => {
      return (id) =>
        id === "MOD-7" ? (s === "task" ? { kind: "task", taskId: "t1" } : { kind: s }) : null;
    };
    // Loaded, but Done/Won't do/Backlog aren't in yet: wait.
    const wait = play([url("MOD-7", true), evaluate(world({ handleStep: step("wait") }))]);
    expect(wait.commands).toEqual([]);
    expect(wait.state.phase.kind).toBe("awaitingLoad");
    // Everything's in and it isn't here: ask the server.
    const ask = play([evaluate(world({ handleStep: step("lookup") }))], wait.state);
    expect(ask.commands).toEqual([{ kind: "lookup", handle: "MOD-7" }]);
    expect(linkSettled(ask.state)).toBe(false);
    // Offline: it stays, unsettled, due again in half a minute.
    const failed = play(
      [{ type: "handleFailed", handle: "MOD-7", now: 1000, cursor: "c0" }],
      ask.state,
    );
    expect(failed.state.phase).toMatchObject({
      kind: "failed",
      retryAt: 1000 + HANDLE_RETRY_MS,
      external: true,
    });
    expect(linkSettled(failed.state)).toBe(false);
    // The retry asks again, keeping its "take me there" mark.
    const retried = play(
      [{ type: "retry" }, evaluate(world({ handleStep: step("lookup") }))],
      failed.state,
    );
    expect(retried.commands).toEqual([{ kind: "lookup", handle: "MOD-7" }]);
    const found = play([{ type: "handleResolved", handle: "MOD-7", taskId: "t1" }], retried.state);
    expect(found.commands).toEqual([
      { kind: "follow", handle: "MOD-7", taskId: "t1", external: true },
    ]);
    // Found locally: no server round trip.
    expect(play([url("MOD-7"), evaluate(world({ handleStep: step("task") }))]).commands).toEqual([
      { kind: "follow", handle: "MOD-7", taskId: "t1", external: false },
    ]);
  });

  it("moving the cursor while a failed handle waits lets it go; a late answer is dropped", () => {
    const lookup = world({ handleStep: (id) => (id === "MOD-7" ? { kind: "lookup" } : null) });
    const failed = play([
      url("MOD-7"),
      evaluate(lookup),
      { type: "handleFailed", handle: "MOD-7", now: 0, cursor: "c0" },
    ]).state;
    // The same cursor (a re-render) isn't a move.
    expect(play([{ type: "cursorMoved", id: "c0" }], failed).state).toBe(failed);
    const moved = play([{ type: "cursorMoved", id: "c1" }], failed);
    expect(moved.state.phase).toEqual({ kind: "resolved", id: "MOD-7" });
    expect(play([{ type: "retry" }], moved.state).state).toBe(moved.state);
    // An answer for a link the address bar moved on from does nothing.
    const asking = play([url("MOD-7"), evaluate(lookup)]).state;
    const movedOn = play([url("t1"), evaluate()], asking).state;
    expect(
      play([{ type: "handleResolved", handle: "MOD-7", taskId: "t9" }], movedOn).commands,
    ).toEqual([]);
  });

  it("a handle with no server to ask is answered by what's loaded", () => {
    const local = world({
      canLookup: false,
      handleStep: (id) => (id === "MOD-7" ? { kind: "lookup" } : null),
    });
    expect(play([url("MOD-7", true), evaluate(local)]).commands).toEqual([
      { kind: "follow", handle: "MOD-7", taskId: null, external: true },
    ]);
  });

  it("an empty address bar is idle", () => {
    const at = play([url("t1"), evaluate(), url(null)]).state;
    expect(at.phase).toEqual({ kind: "idle" });
    expect(linkSettled(at)).toBe(true);
  });
});
