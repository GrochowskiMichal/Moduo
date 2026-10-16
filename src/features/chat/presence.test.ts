import { describe, expect, it } from "@rstest/core";

// "Show me as online" (CV-17, AC11.2; spec §10, #17, #20, CH48). With the
// switch off the client never tracks itself on the presence topic, so others
// see it as offline (it still reads them); on, it tracks while the app is
// open and not idle, and says "away" after 10 minutes without input. A person
// is away only when every tab of theirs is.

import { presenceStateOf } from "@/lib/statuses/model";
import type { ChatSocket } from "./realtime";
import { ChatPresenceStore, presenceSets } from "./store/presence";
import { AWAY_AFTER_MS, PresenceSelfWatcher } from "./store/presence-self";

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
    expect(ch.calls.at(-1)).toEqual({ op: "track", state: expect.objectContaining({ away: true }) });

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
    expect(ch.calls.at(-1)).toEqual({ op: "track", state: expect.objectContaining({ away: false }) });
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

  it("a refused join is an error, never everyone offline (AC1.9)", () => {
    const { socket, channels } = fakeSocket();
    const presence = new ChatPresenceStore(socket, WS, ME, new PresenceSelfWatcher(true, fakeTime()));
    presence.acquire();
    channels[0]!.status?.("CHANNEL_ERROR");
    expect(presence.getSnapshot()).toMatchObject({
      status: "error",
      error: "Presence isn't available",
    });
  });
});
