import { describe, expect, it } from "@rstest/core";
// "Show me as online" (CV-17, AC11.2; spec §10, #17, #20, CH48). With the
// switch off the client never tracks itself on the presence topic, so others
// see it as offline (it still reads them); on, it tracks while the app is
// open and not idle, and says "away" after 10 minutes without input. A person
// is away only when every tab of theirs is.

import { presenceStateOf } from "@/lib/statuses/model";

import type { ChatSocket } from "./realtime";
import { ChatPresenceStore, presenceSets } from "./store/presence";
import {
  AWAY_AFTER_MS,
  PresenceSelfRegistry,
  PresenceSelfWatcher,
  SHOW_ONLINE_REREAD_MS,
} from "./store/presence-self";

type FakeChannel = {
  status: ((s: string) => void) | null;
  calls: Array<{ op: "track"; state: { away?: boolean } } | { op: "untrack" }>;
  presence: Record<string, Array<{ away?: boolean }>>;
  sync: (() => void) | null;
};

function fakeSocket() {
  const channels: FakeChannel[] = [];
  const socket = {
    channel: () => {
      const ch: FakeChannel = { status: null, calls: [], presence: {}, sync: null };
      channels.push(ch);
      const api = {
        on: (_kind: string, _filter: unknown, fn: () => void) => {
          ch.sync = fn;
          return api;
        },
        subscribe: (cb?: (s: string) => void) => {
          ch.status = cb ?? null;
          return api;
        },
        track: (state: { away?: boolean }) => {
          ch.calls.push({ op: "track", state });
          return Promise.resolve("ok");
        },
        untrack: () => {
          ch.calls.push({ op: "untrack" });
          return Promise.resolve("ok");
        },
        presenceState: () => ch.presence,
        __ch: ch,
      };
      return api;
    },
    removeChannel: () => Promise.resolve("ok"),
  };
  return { socket: socket as unknown as ChatSocket, channels };
}

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let now = 0;
  let next = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      next += 1;
      timers.set(next, { at: now + ms, fn });
      return next;
    },
    clearTimer: (h: unknown) => {
      timers.delete(h as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= now) {
          timers.delete(id);
          t.fn();
        }
      }
    },
  };
}

const WS = "ws-1";
const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};
const ME = "me";

describe('"Show me as online"', () => {
  it("off: never tracks itself, still reads others, and shows as offline", () => {
    const { socket, channels } = fakeSocket();
    const self = new PresenceSelfWatcher(false, fakeTime());
    const presence = new ChatPresenceStore(socket, WS, ME, self);
    presence.acquire();
    const ch = channels[0]!;
    ch.status?.("SUBSCRIBED");
    expect(ch.calls).toEqual([]);
    // Others are there; I'm not, because I never tracked.
    ch.presence = { ana: [{ away: false }] };
    ch.sync?.();
    const snap = presence.getSnapshot();
    expect([...snap.online]).toEqual(["ana"]);
    expect(snap.online.has(ME)).toBe(false);
    expect(presenceStateOf({ online: snap.online.has(ME), away: snap.away.has(ME) })).toBe(
      "offline",
    );
    // Idle time passing changes nothing while it's off.
    self.input();
    expect(ch.calls).toEqual([]);
  });

  it("on: tracks while open and not idle, away after 10 minutes, back on input", () => {
    const { socket, channels } = fakeSocket();
    const time = fakeTime();
    const self = new PresenceSelfWatcher(true, time);
    const presence = new ChatPresenceStore(socket, WS, ME, self);
    presence.acquire();
    const ch = channels[0]!;
    ch.status?.("SUBSCRIBED");
    expect(ch.calls).toEqual([{ op: "track", state: expect.objectContaining({ away: false }) }]);

    time.advance(AWAY_AFTER_MS - 1);
    expect(ch.calls).toHaveLength(1);
    time.advance(1);
    expect(ch.calls.at(-1)).toEqual({
      op: "track",
      state: expect.objectContaining({ away: true }),
    });

    self.input();
    expect(ch.calls.at(-1)).toEqual({
      op: "track",
      state: expect.objectContaining({ away: false }),
    });
    expect(ch.calls).toHaveLength(3);
  });

  it("turning it off untracks at once; on again tracks again", () => {
    const { socket, channels } = fakeSocket();
    const self = new PresenceSelfWatcher(true, fakeTime());
    const presence = new ChatPresenceStore(socket, WS, ME, self);
    presence.acquire();
    const ch = channels[0]!;
    ch.status?.("SUBSCRIBED");
    self.setShowOnline(false);
    expect(ch.calls.at(-1)).toEqual({ op: "untrack" });
    self.setShowOnline(true);
    expect(ch.calls.at(-1)).toEqual({
      op: "track",
      state: expect.objectContaining({ away: false }),
    });
  });

  it("a person is away only when every tab of theirs is", () => {
    const { online, away } = presenceSets({
      ana: [{ away: true }, { away: false }],
      bo: [{ away: true }, { away: true }],
      cy: [{}],
    });
    expect([...online].sort()).toEqual(["ana", "bo", "cy"]);
    expect([...away]).toEqual(["bo"]);
  });

  it("another person on this tab starts untracked: nothing of the one before stays", () => {
    const prefs = new Map<string, boolean>([["ana", true]]);
    const listeners = new Set<() => void>();
    const loads: string[] = [];
    const registry = new PresenceSelfRegistry(
      {
        get: (id) => prefs.get(id) ?? null,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        read: () => {
          loads.push("load");
          return Promise.resolve();
        },
      },
      fakeTime(),
    );
    const { socket, channels } = fakeSocket();
    const anaSelf = registry.for("ana");
    const ana = new ChatPresenceStore(socket, WS, "ana", anaSelf);
    ana.acquire();
    channels[0]!.status?.("SUBSCRIBED");
    expect(channels[0]!.calls).toEqual([
      { op: "track", state: expect.objectContaining({ away: false }) },
    ]);

    // Bo signs in on the same tab: Ana's "me" untracks and lets go.
    const boSelf = registry.for("bo");
    expect(boSelf).not.toBe(anaSelf);
    expect(channels[0]!.calls.at(-1)).toEqual({ op: "untrack" });
    expect(listeners.size).toBe(1);
    expect(loads).toEqual(["load"]);
    // Ana's switch ("on") never turns Bo's tracking on.
    for (const fn of listeners) fn();
    const bo = new ChatPresenceStore(socket, WS, "bo", boSelf);
    bo.acquire();
    channels[1]!.status?.("SUBSCRIBED");
    expect(channels[1]!.calls).toEqual([]);
    // Bo's own switch, once read, does.
    prefs.set("bo", true);
    for (const fn of listeners) fn();
    expect(channels[1]!.calls.at(-1)).toEqual({
      op: "track",
      state: expect.objectContaining({ away: false }),
    });

    // Sign-out: nothing tracked, no listener left.
    registry.forget();
    expect(channels[1]!.calls.at(-1)).toEqual({ op: "untrack" });
    expect(listeners.size).toBe(0);
    expect(registry.userId).toBeNull();
  });

  it("another device turns it off: this tab untracks after the next re-read, with no tab message", async () => {
    const time = fakeTime();
    const server = { on: true };
    let known: boolean | null = null;
    const listeners = new Set<() => void>();
    let reads = 0;
    const registry = new PresenceSelfRegistry(
      {
        get: (id) => (id === ME ? known : null),
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        // As the real read does: keep what the server says, tell listeners.
        read: async () => {
          reads += 1;
          known = server.on;
          for (const fn of listeners) fn();
        },
      },
      time,
    );
    const { socket, channels } = fakeSocket();
    const self = registry.for(ME);
    const stopWatch = registry.watch();
    await flush();
    const presence = new ChatPresenceStore(socket, WS, ME, self);
    presence.acquire();
    channels[0]!.status?.("SUBSCRIBED");
    expect(channels[0]!.calls).toEqual([
      { op: "track", state: expect.objectContaining({ away: false }) },
    ]);

    // Turned off on another device: nothing reaches this tab yet.
    server.on = false;
    time.advance(SHOW_ONLINE_REREAD_MS - 1);
    await flush();
    expect(channels[0]!.calls.at(-1)?.op).toBe("track");
    // The minute's re-read hears it and stops tracking.
    time.advance(1);
    await flush();
    expect(reads).toBe(2);
    expect(channels[0]!.calls.at(-1)).toEqual({ op: "untrack" });

    // Stopped watching: no more reads.
    stopWatch();
    time.advance(SHOW_ONLINE_REREAD_MS * 3);
    await flush();
    expect(reads).toBe(2);
    registry.forget();
  });

  it("a failed first read tries again; once known, the retries stop", async () => {
    const time = fakeTime();
    let known: boolean | null = null;
    const listeners = new Set<() => void>();
    let reads = 0;
    let failures = 2;
    const registry = new PresenceSelfRegistry(
      {
        get: () => known,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        read: async () => {
          reads += 1;
          if (failures > 0) {
            failures -= 1;
            throw new Error("offline");
          }
          known = true;
          for (const fn of listeners) fn();
        },
      },
      time,
    );
    const self = registry.for(ME);
    await flush();
    expect(reads).toBe(1);
    expect(self.get().track).toBe(false);
    time.advance(2_000);
    await flush();
    expect(reads).toBe(2);
    time.advance(3_999);
    await flush();
    expect(reads).toBe(2);
    time.advance(1);
    await flush();
    expect(reads).toBe(3);
    expect(self.get().track).toBe(true);
    time.advance(120_000);
    await flush();
    expect(reads).toBe(3);
  });

  it("a retry never outlives sign-out", async () => {
    const time = fakeTime();
    let reads = 0;
    const registry = new PresenceSelfRegistry(
      {
        get: () => null,
        subscribe: () => () => {},
        read: async () => {
          reads += 1;
          throw new Error("offline");
        },
      },
      time,
    );
    registry.for(ME);
    await flush();
    registry.forget();
    time.advance(120_000);
    await flush();
    expect(reads).toBe(1);
  });

  it("a hidden tab keeps re-reading, and reads at once on return", async () => {
    const time = fakeTime();
    let visible = true;
    const onVisible = new Set<() => void>();
    const server = { on: true };
    let known: boolean | null = null;
    const listeners = new Set<() => void>();
    let reads = 0;
    const registry = new PresenceSelfRegistry(
      {
        get: () => known,
        subscribe: (fn) => {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
        read: async () => {
          reads += 1;
          known = server.on;
          for (const fn of listeners) fn();
        },
      },
      {
        ...time,
        visibility: {
          isVisible: () => visible,
          onChange: (fn) => {
            onVisible.add(fn);
            return () => onVisible.delete(fn);
          },
        },
      },
    );
    const self = registry.for(ME);
    const stop = registry.watch();
    await flush();
    expect(reads).toBe(1);
    expect(self.get().track).toBe(true);

    // Hidden, then turned off elsewhere: the hidden tab still stops tracking.
    visible = false;
    for (const fn of onVisible) fn();
    server.on = false;
    time.advance(SHOW_ONLINE_REREAD_MS);
    await flush();
    expect(reads).toBe(2);
    expect(self.get().track).toBe(false);

    // Back in view: read at once, then each minute again.
    visible = true;
    for (const fn of onVisible) fn();
    await flush();
    expect(reads).toBe(3);
    time.advance(SHOW_ONLINE_REREAD_MS);
    await flush();
    expect(reads).toBe(4);
    stop();
    expect(onVisible.size).toBe(0);
    time.advance(SHOW_ONLINE_REREAD_MS * 3);
    await flush();
    expect(reads).toBe(4);
    registry.forget();
  });

  it("a refused join is an error, never everyone offline (AC1.9)", () => {
    const { socket, channels } = fakeSocket();
    const presence = new ChatPresenceStore(
      socket,
      WS,
      ME,
      new PresenceSelfWatcher(true, fakeTime()),
    );
    presence.acquire();
    channels[0]!.status?.("CHANNEL_ERROR");
    expect(presence.getSnapshot()).toMatchObject({
      status: "error",
      error: "Presence isn't available",
    });
  });
});
