// Losing access sends no event (CV-3; AC10.6, AC10.3; spike 2 bar 5): removed
// from a private conversation, the conversation deleted, made private while
// you only read it from Browse, messages moved somewhere you can't read. One
// access check (`chat_sync_ids`) drops each from memory and the device copy;
// what you can still read stays, and messages moved somewhere you can read
// are re-filed by the next delta.

import { afterEach, describe, expect, it } from "@rstest/core";

import { planAccess } from "./access";
import { memoryChatCopy, ownerKey } from "./device-copy";
import { ChatStore } from "./store";
import { FakeChatServer, fakeLive, ME, settle, uuid, WS } from "./testing";

const OWNER = ownerKey(ME, WS);
const PUB = uuid(8001);
const PRIV = uuid(8002);
const DEL = uuid(8003);
const MADE = uuid(8004);
const SRC = uuid(8005);
const HIDDEN = uuid(8006);
const ELSEWHERE = uuid(8007);

const stores: ChatStore[] = [];
afterEach(() => {
  for (const s of stores.splice(0)) s.dispose({ persist: false });
});

function make(server: FakeChatServer, copy: ReturnType<typeof memoryChatCopy>) {
  const live = fakeLive();
  const store = new ChatStore(server.transport(), ME, WS, {
    copy,
    live,
    timing: {
      persistMs: 0,
      markReadMs: 0,
      joinDebounceMs: 0,
      retryMs: 3_600_000,
      gapFillMs: 3_600_000,
      accessCheckMs: 3_600_000,
    },
  });
  stores.push(store);
  return { store, live };
}

async function world() {
  const server = new FakeChatServer();
  const copy = memoryChatCopy();
  server.addChannel(PUB, { isDefault: true });
  server.addChannel(PRIV, { isPrivate: true });
  server.addChannel(DEL);
  // Read from Browse, never joined.
  server.addChannel(MADE, { member: false });
  server.addChannel(SRC);
  server.addChannel(HIDDEN, { readable: false, member: false, isPrivate: true });
  server.addChannel(ELSEWHERE);
  let n = 0;
  for (const c of [PUB, PRIV, DEL, MADE, SRC, ELSEWHERE]) {
    for (let i = 0; i < 10; i += 1) server.post(uuid(++n), c);
  }
  const { store, live } = make(server, copy);
  store.acquire();
  await store.ready();
  for (const c of [PUB, PRIV, DEL, MADE, SRC, ELSEWHERE]) await store.open(c);
  await store.persistNow();
  return { server, copy, store, live };
}

const deviceChannels = (copy: ReturnType<typeof memoryChatCopy>) =>
  new Set([...(copy.rows.get(OWNER)?.values() ?? [])].map((r) => r.channelId));
const deviceIds = (copy: ReturnType<typeof memoryChatCopy>) =>
  new Set(copy.rows.get(OWNER)?.keys() ?? []);

describe("losing access without an event", () => {
  it("one check drops removed, deleted, made-private and moved-away rows from memory and the device", async () => {
    const { server, copy, store } = await world();
    expect(deviceChannels(copy)).toEqual(new Set([PUB, PRIV, DEL, MADE, SRC, ELSEWHERE]));

    // None of these sends an event.
    server.readable.delete(PRIV); // removed from a private conversation
    server.memberOf.delete(PRIV);
    server.readable.delete(DEL); // deleted
    server.memberOf.delete(DEL);
    server.readable.delete(MADE); // made private
    const srcRows = server.fullRead([SRC]);
    const away = srcRows.slice(0, 5);
    const refiled = srcRows.slice(5, 7);
    for (const row of away) {
      server.change(row.id, { channelId: HIDDEN });
      server.movedAway.push({ id: row.id, source: SRC, at: server.now() });
    }
    for (const row of refiled) server.change(row.id, { channelId: ELSEWHERE });

    await store.checkAccess();
    await store.persistNow();

    const snap = store.getSnapshot();
    for (const gone of [PRIV, DEL, MADE]) {
      expect(snap.windows[gone]).toBeUndefined();
      expect(snap.channels[gone]).toBeUndefined();
      expect(snap.mine[gone]).toBeUndefined();
      for (const row of server.rows.values()) {
        if (row.channelId === gone) expect(store.rowById(row.id)).toBeUndefined();
      }
    }
    expect(deviceChannels(copy)).toEqual(new Set([PUB, SRC, ELSEWHERE]));
    expect(Object.keys(copy.metas.get(OWNER)?.conversations ?? {}).sort()).toEqual(
      [PUB, SRC, ELSEWHERE].sort(),
    );
    // The moved-away ids leave the source, in memory and on the device.
    for (const row of away) {
      expect(store.rowById(row.id)).toBeUndefined();
      expect(deviceIds(copy).has(row.id)).toBe(false);
    }
    // What you can still read stays.
    expect(snap.windows[PUB]?.rows).toHaveLength(10);
    expect(snap.channels[PUB]).toBeDefined();

    // Moved somewhere you can read: re-filed by the next delta.
    await store.sync("manual");
    for (const row of refiled) expect(store.rowById(row.id)?.channelId).toBe(ELSEWHERE);
    expect(store.getSnapshot().windows[SRC]?.rows).toHaveLength(3);
    expect(store.getSnapshot().windows[ELSEWHERE]?.rows).toHaveLength(12);

    // A store opened from the device later never sees the dropped conversations.
    const { store: again } = make(server, copy);
    again.acquire();
    await settle();
    expect(again.holds(PRIV)).toBe(false);
    expect(again.holds(DEL)).toBe(false);
    expect(again.holds(MADE)).toBe(false);
  });

  it("a membership row stamped by a removal runs the check: the conversation leaves", async () => {
    const { server, copy, store, live } = await world();
    server.readable.delete(PRIV);
    server.memberOf.delete(PRIV);
    live.emit({ type: "member-left", channelId: PRIV });
    await settle(30);
    await store.persistNow();
    expect(store.getSnapshot().mine[PRIV]).toBeUndefined();
    expect(store.getSnapshot().windows[PRIV]).toBeUndefined();
    expect(deviceChannels(copy).has(PRIV)).toBe(false);
    // Its messages stop arriving: a live row for it isn't kept.
    live.emit({ type: "message", row: server.post(uuid(99_999), PRIV), insert: true });
    expect(store.rowById(uuid(99_999))).toBeUndefined();
  });

  it("drops nothing on an answer that isn't whole", () => {
    expect(planAccess([PUB], [])).toBeNull();
    expect(
      planAccess(
        [PUB, PRIV],
        [
          { kind: "conversation", id: PUB, conversationId: PUB, checkedAt: "t" },
          { kind: "checked", id: null, conversationId: null, checkedAt: "t" },
        ],
      ),
    ).toMatchObject({ dropConversations: [PRIV], checkedAt: "t" });
  });

  it("moved-away messages leave the device even when their conversation isn't in memory", async () => {
    const server = new FakeChatServer();
    const copy = memoryChatCopy();
    server.addChannel(PUB, { isDefault: true });
    server.addChannel(SRC);
    server.addChannel(HIDDEN, { readable: false, member: false, isPrivate: true });
    for (let i = 0; i < 61; i += 1) server.post(uuid(i + 1), SRC);
    server.post(uuid(100), PUB);
    const { store } = make(server, copy);
    store.acquire();
    await store.ready();
    await store.open(SRC);
    await store.loadOlder(SRC);
    await store.persistNow();
    // Opening another conversation trims SRC (61 rows) from memory: only the device holds it.
    await store.open(PUB);
    const away = server.fullRead([SRC]).slice(-3);
    expect(store.rowById(away[0]!.id)).toBeUndefined();
    expect(deviceIds(copy).has(away[0]!.id)).toBe(true);
    for (const row of away) {
      server.change(row.id, { channelId: HIDDEN });
      server.movedAway.push({ id: row.id, source: SRC, at: server.now() });
    }
    await store.checkAccess();
    await store.persistNow();
    for (const row of away) expect(deviceIds(copy).has(row.id)).toBe(false);
    // The rest of SRC stays on the device.
    expect(
      [...deviceIds(copy)].filter((id) => server.rows.get(id)?.channelId === SRC),
    ).toHaveLength(58);
  });

  it("two tabs keep each other's conversations registered", async () => {
    const server = new FakeChatServer();
    const copy = memoryChatCopy();
    server.addChannel(PUB, { isDefault: true });
    server.addChannel(SRC);
    server.post(uuid(1), PUB);
    server.post(uuid(2), SRC);
    const one = make(server, copy).store;
    const two = make(server, copy).store;
    one.acquire();
    two.acquire();
    await Promise.all([one.ready(), two.ready()]);
    await one.open(PUB);
    await one.persistNow();
    await two.open(SRC);
    await two.persistNow();
    expect(Object.keys(copy.metas.get(OWNER)?.conversations ?? {}).sort()).toEqual(
      [PUB, SRC].sort(),
    );
    // Losing PUB, the next store that opens from the copy drops its rows.
    server.readable.delete(PUB);
    server.memberOf.delete(PUB);
    const three = make(server, copy).store;
    three.acquire();
    await three.ready();
    await three.persistNow();
    expect(deviceChannels(copy).has(PUB)).toBe(false);
    expect(Object.keys(copy.metas.get(OWNER)?.conversations ?? {})).toEqual([SRC]);
  });
});
