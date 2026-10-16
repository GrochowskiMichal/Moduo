import { describe, expect, it } from "@rstest/core";

// Everyone's "now" (CV-17): read on hold, again on a live change and on the
// minute while visible; a sign-out stops the feed and forgets what was read,
// even a read still on its way.

import type { PersonNow } from "./model";
import { PeopleNowStore } from "./store";

const person = (id: string): PersonNow => ({
  userId: id,
  status: null,
  dnd: false,
  focusing: true,
  focusUntil: null,
  focusTaskId: null,
  focusTaskTitle: null,
});

function setup() {
  const reads: Array<(m: Map<string, PersonNow>) => void> = [];
  let live: (() => void) | null = null;
  let liveStopped = false;
  let tick: (() => void) | null = null;
  let visible = true;
  const store = new PeopleNowStore("ws", {
    read: () => new Promise((resolve) => reads.push(resolve)),
    live: (fn) => {
      live = fn;
      return () => {
        liveStopped = true;
      };
    },
    visible: () => visible,
    setInterval: (fn) => {
      tick = fn;
      return 1;
    },
    clearInterval: () => {
      tick = null;
    },
  });
  return {
    store,
    reads,
    fireLive: () => live?.(),
    tick: () => tick?.(),
    hide: () => {
      visible = false;
    },
    liveStopped: () => liveStopped,
    ticking: () => tick !== null,
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("PeopleNowStore", () => {
  it("reads on hold, on a live change and each minute while visible", async () => {
    const t = setup();
    t.store.acquire();
    expect(t.reads).toHaveLength(1);
    t.reads[0]!(new Map([["ana", person("ana")]]));
    await settle();
    expect(t.store.getSnapshot().people.get("ana")?.focusing).toBe(true);
    t.fireLive();
    expect(t.reads).toHaveLength(2);
    t.reads[1]!(new Map());
    await settle();
    t.tick();
    expect(t.reads).toHaveLength(3);
    t.reads[2]!(new Map());
    await settle();
    t.hide();
    t.tick();
    expect(t.reads).toHaveLength(3);
  });

  it("a sign-out stops the feed and forgets, even a read still on its way", async () => {
    const t = setup();
    t.store.acquire();
    t.reads[0]!(new Map([["ana", person("ana")]]));
    await settle();
    t.fireLive(); // a read in flight
    t.store.dispose();
    expect(t.store.getSnapshot().people.size).toBe(0);
    expect(t.liveStopped()).toBe(true);
    expect(t.ticking()).toBe(false);
    t.reads[1]!(new Map([["ana", person("ana")]]));
    await settle();
    expect(t.store.getSnapshot().people.size).toBe(0);
    expect(t.store.getSnapshot().loaded).toBe(false);
  });

  it("keeps the snapshot when a read says the same, so readers don't re-render", async () => {
    const t = setup();
    const stop = t.store.acquire();
    t.reads.shift()?.(new Map([["a", person("a")]]));
    await settle();
    const first = t.store.getSnapshot();
    t.tick();
    t.reads.shift()?.(new Map([["a", person("a")]]));
    await settle();
    expect(t.store.getSnapshot()).toBe(first);
    t.tick();
    t.reads.shift()?.(new Map([["a", { ...person("a"), focusing: false }]]));
    await settle();
    expect(t.store.getSnapshot()).not.toBe(first);
    stop();
  });
});
