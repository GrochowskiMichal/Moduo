// The chat store (CV-3; AC12.2, AC1.1, AC1.4): it opens from the device copy,
// fills gaps by `updated_at` deltas (after 1,000 missed changes the copy equals
// a full read), applies live rows with zero requests, skips its own echo,
// rolls back one write on a refusal and drains an outbox in order under the
// same client-minted ids. The device copy here is the memory copy with the
// IndexedDB copy's contract (`device-copy.ts`); IndexedDB itself was measured
// in Chromium by CV-0 spike 2.

import { afterEach, describe, expect, it } from "@rstest/core";

import type { ChatMessage, ChatRuntime } from "../model";
import { emptyMeta, memoryChatCopy, ownerKey } from "./device-copy";
import { compareKeys, keyOf } from "./keys";
import { ChatStore, type ChatStoreOptions, PAGE } from "./store";
import { FakeChatServer, fakeLive, ME, member, settle, stampOf, uuid, WS, YOU } from "./testing";

const C = uuid(9001);
const D = uuid(9002);
const P = uuid(9003);
const OWNER = ownerKey(ME, WS);

const stores: ChatStore[] = [];

function setup(
  opts: Partial<ChatStoreOptions> = {},
  wrap: (t: ChatRuntime) => ChatRuntime = (t) => t,
) {
  const server = new FakeChatServer();
  const copy = memoryChatCopy();
  const live = fakeLive();
  const store = new ChatStore(wrap(server.transport()), ME, WS, {
    copy,
    live,
    ...opts,
    timing: {
      persistMs: 0,
      markReadMs: 0,
      joinDebounceMs: 0,
      focusThrottleMs: 0,
      retryMs: 3_600_000,
      gapFillMs: 3_600_000,
      accessCheckMs: 3_600_000,
      ...opts.timing,
    },
  });
  stores.push(store);
  return { server, copy, live, store };
}

afterEach(() => {
  for (const s of stores.splice(0)) s.dispose({ persist: false });
});

const ids = (rows: readonly ChatMessage[]) => rows.map((r) => r.id);
const serverRows = (rows: readonly ChatMessage[]) => rows.filter((r) => !r.sendState);

describe("device copy, delta, echo, outbox", () => {
  it("opens from the device copy, then the server's newest page lands", async () => {
    const { server, copy, store } = setup();
    server.addChannel(C, { isDefault: true });
    for (let i = 0; i < 80; i += 1) server.post(uuid(1000 + i), C);
    const all = server.fullRead([C]);
    // The device holds the newest 60 and the sidebar from a past session.
    await copy.updateMeta(OWNER, () => ({
      ...emptyMeta(),
      conversations: { [C]: { openedAt: 1 } },
      channels: [server.channels.get(C)!],
      mine: [member(C)],
      cursor: stampOf(server.clock),
    }));
    await copy.put(OWNER, all.slice(20), 500);

    const enabled = server.holdNext("isEnabled");
    store.acquire();
    await settle();
    // Before the server answers anything: the sidebar from the device.
    expect(store.getSnapshot().status).toBe("ready");
    expect(store.getSnapshot().fromDevice).toBe(true);
    expect(Object.keys(store.getSnapshot().channels)).toEqual([C]);

    const page = server.holdNext("page");
    void store.open(C);
    await settle();
    // The conversation paints the device's newest 51 before its page arrives.
    let win = store.getSnapshot().windows[C]!;
    expect(ids(win.rows)).toEqual(ids(all.slice(-PAGE)));
    expect(win.loaded).toBe(false);

    enabled();
    page();
    await settle();
    win = store.getSnapshot().windows[C]!;
    expect(store.getSnapshot().fromDevice).toBe(false);
    expect(win.loaded).toBe(true);
    expect(ids(win.rows)).toEqual(ids(all.slice(-PAGE)));
    expect(win.hasOlder).toBe(true);
  });

  it("after 1,000 missed changes a delta read equals a full read (a late commit included)", async () => {
    const { server, copy, store, live } = setup({ deltaLimit: 100 });
    server.addChannel(C, { isDefault: true });
    server.addChannel(D);
    // A private conversation the reader can't see: its changes never arrive.
    server.addChannel(P, { readable: false, member: false });
    let n = 0;
    for (let i = 0; i < 30; i += 1) {
      server.post(uuid(++n), C);
      server.post(uuid(++n), D);
    }
    store.acquire();
    await store.ready();
    await store.open(D);
    await store.open(C);
    expect(serverRows(store.getSnapshot().windows[C]!.rows)).toHaveLength(30);

    // Ten minutes later (older than the lookback), offline from the live feed:
    server.clock += 10 * 60 * 1_000_000;
    const held = () => [...server.rows.values()].filter((r) => r.channelId !== P);
    const pick = (i: number) => {
      const rows = held();
      return rows[(i * 7919) % rows.length]!;
    };
    for (let i = 0; i < 1000; i += 1) {
      const kind = i % 10;
      if (kind <= 2) server.post(uuid(++n), [C, D, P][i % 3]!);
      else if (kind === 3 || kind === 4)
        server.change(pick(i).id, { body: `edit ${i}`, editedAt: server.now() });
      else if (kind === 5 || kind === 6) {
        server.change(pick(i).id, { reactions: { "👍": [YOU] } });
      } else if (kind === 7) server.change(pick(i).id, { deletedAt: server.now(), body: "" });
      else if (kind === 8) server.change(pick(i).id, { pinnedAt: server.now(), pinnedBy: YOU });
      else {
        // A move between the two conversations you read.
        const row = pick(i);
        server.change(row.id, { channelId: row.channelId === C ? D : C });
      }
    }
    const before = server.calls.length;
    live.emit({ type: "joined", source: "messages" });
    await settle(80);
    // The delta paged under (updated_at, id), 100 rows a page.
    expect(server.calls.slice(before).filter((c) => c === "delta").length).toBeGreaterThan(1);

    // The open conversation's window, and both on the device (D, not open,
    // left memory after the delta: only the copy holds it now).
    const expectedC = server.fullRead([C]);
    const gotC = serverRows(store.getSnapshot().windows[C]!.rows);
    expect(ids(gotC)).toEqual(ids(expectedC));
    expect(gotC.map((r) => r.updatedAt)).toEqual(expectedC.map((r) => r.updatedAt));
    await store.persistNow();
    for (const id of [C, D]) {
      const expected = server.fullRead([id]);
      const onDevice = await copy.newest(OWNER, id, 500);
      expect(ids(onDevice)).toEqual(ids(expected));
      expect(onDevice.map((r) => r.updatedAt)).toEqual(expected.map((r) => r.updatedAt));
    }
    // Nothing from the conversation you can't read.
    for (const row of server.rows.values()) {
      if (row.channelId === P) expect(store.rowById(row.id)).toBeUndefined();
    }

    // A transaction that wrote a minute before the cursor (the newest stamp
    // just read) and committed late: only the next delta's lookback reads it.
    const at = stampOf(server.clock - 60 * 1_000_000);
    const late = server.post(uuid(++n), C, { createdAt: at, updatedAt: at });
    live.emit({ type: "joined", source: "messages" });
    await settle(40);
    expect(store.rowById(late.id)?.updatedAt).toBe(at);
  });

  it("a late commit older than the lookback is missed without it (the negative control)", async () => {
    const { server, store, live } = setup({ timing: { lagMs: 0 } });
    server.addChannel(C, { isDefault: true });
    server.post(uuid(1), C);
    store.acquire();
    await store.ready();
    await store.open(C);
    server.clock += 10 * 60 * 1_000_000;
    server.post(uuid(2), C);
    live.emit({ type: "joined", source: "messages" });
    await settle(40);
    const at = stampOf(server.clock - 60 * 1_000_000);
    const late = server.post(uuid(3), C, { createdAt: at, updatedAt: at });
    live.emit({ type: "joined", source: "messages" });
    await settle(40);
    expect(store.rowById(late.id)).toBeUndefined();
  });

  it("a jump window opened again goes back to the newest messages", async () => {
    const { server, store, live } = setup();
    server.addChannel(C, { isDefault: true });
    for (let i = 0; i < 400; i += 1) server.post(uuid(i + 1), C);
    store.acquire();
    await store.ready();
    await store.open(C);
    await store.openAt(C, uuid(150));
    const fresh = server.post(uuid(500), C);
    live.emit({ type: "message", row: fresh, insert: true });
    expect(ids(store.getSnapshot().windows[C]!.rows)).not.toContain(fresh.id);
    await store.open(C);
    const win = store.getSnapshot().windows[C]!;
    expect(win.hasNewer).toBe(false);
    expect(ids(win.rows).at(-1)).toBe(fresh.id);
    expect(ids(win.rows)).toEqual(ids(server.fullRead([C]).slice(-PAGE)));
  });

  it("deleting a message while it is being sent deletes it on the server once it lands", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    store.acquire();
    await store.ready();
    await store.open(C);
    const answer = server.holdNext("send");
    const id = store.send({ channelId: C, body: "oops" });
    await settle(2);
    expect(await store.remove(id)).toEqual({ ok: true });
    answer();
    await settle(20);
    expect(server.rows.get(id)?.deletedAt).not.toBeNull();
    expect(store.rowById(id)?.deletedAt).not.toBeNull();
  });

  it("deleted while sending and the answer is lost: deleted once its echo lands", async () => {
    const { server, store, live } = setup();
    server.addChannel(C, { isDefault: true });
    store.acquire();
    await store.ready();
    await store.open(C);
    const answer = server.holdNext("send");
    const id = store.send({ channelId: C, body: "oops" });
    await settle(2);
    expect(await store.remove(id)).toEqual({ ok: true });
    // Out of sight at once, still on its way.
    expect(ids(store.getSnapshot().windows[C]!.rows)).not.toContain(id);
    expect(store.getSnapshot().waiting).toBe(0);
    server.loseAnswer.add("send");
    answer();
    await settle(20);
    expect(server.rows.get(id)?.deletedAt ?? null).toBeNull();
    live.emit({ type: "message", row: server.rows.get(id)!, insert: true });
    await settle(20);
    expect(server.rows.get(id)?.deletedAt).not.toBeNull();
    expect(store.rowById(id)?.deletedAt).not.toBeNull();
  });

  it("a waiting send another tab discarded isn't sent from this one", async () => {
    const { server, copy, store } = setup();
    server.addChannel(C, { isDefault: true });
    const waiting = uuid(7001);
    await copy.updateMeta(OWNER, () => ({
      ...emptyMeta(),
      conversations: { [C]: { openedAt: 1 } },
      channels: [server.channels.get(C)!],
      mine: [member(C)],
      outbox: [
        {
          id: waiting,
          channelId: C,
          body: "never mind",
          replyToId: null,
          format: "v2",
          createdAt: server.now(),
        },
      ],
    }));
    const enabled = server.holdNext("isEnabled");
    store.acquire();
    await settle();
    expect(store.getSnapshot().waiting).toBe(1);
    // The other tab discards it: it leaves the device's outbox.
    await copy.updateMeta(OWNER, (m) => ({ ...m!, outbox: [] }));
    enabled();
    await store.ready();
    await settle(40);
    expect(server.calls).not.toContain("send");
    expect(server.rows.has(waiting)).toBe(false);
    expect(store.getSnapshot().waiting).toBe(0);
    expect(copy.metas.get(OWNER)?.outbox).toEqual([]);
  });

  it("a live row that landed before opening doesn't hide the gap to the newest page", async () => {
    const { server, copy, store, live } = setup();
    server.addChannel(C, { isDefault: true });
    for (let i = 0; i < 200; i += 1) server.post(uuid(1000 + i), C);
    const all = server.fullRead([C]);
    const device = all.slice(10, 10 + PAGE);
    await copy.updateMeta(OWNER, () => ({
      ...emptyMeta(),
      conversations: { [C]: { openedAt: 1, edge: keyOf(device.at(-1)!) } },
      channels: [server.channels.get(C)!],
      mine: [member(C)],
    }));
    await copy.put(OWNER, device, 500);
    store.acquire();
    await store.ready();
    const fresh = server.post(uuid(5000), C);
    live.emit({ type: "message", row: fresh, insert: true });
    await store.open(C);
    const win = store.getSnapshot().windows[C]!;
    // The newest page only: the device's old rows aren't drawn against it.
    expect(ids(win.rows)).toEqual(ids(server.fullRead([C]).slice(-PAGE)));
    expect(win.hasOlder).toBe(true);
  });

  it("a failed background read doesn't refuse your next write", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    const mine = server.post(uuid(1), C, { authorId: ME });
    store.acquire();
    await store.ready();
    await store.open(C);
    // The last read of a gap fill is lost: the store notes the network as gone.
    server.loseAnswer.add("syncIds");
    await store.sync("manual");
    expect(store.getSnapshot().offline).toBe(true);
    expect(await store.edit(mine.id, "fixed")).toEqual({ ok: true });
    expect(server.rows.get(mine.id)?.body).toBe("fixed");
  });

  it("a delta reads only the conversations the store holds", async () => {
    const scopes: (readonly string[] | undefined)[] = [];
    const { server, store } = setup({}, (t) => ({
      ...t,
      delta: (args) => {
        scopes.push(args.channelIds);
        return t.delta(args);
      },
    }));
    server.addChannel(C, { isDefault: true });
    server.addChannel(D);
    store.acquire();
    await store.ready();
    await store.open(C);
    await store.sync("manual");
    expect(scopes.at(-1)).toEqual([C]);
  });

  it("no message is lost at a page boundary: 200 share one timestamp", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    let n = 0;
    for (let i = 0; i < 100; i += 1) server.post(uuid(++n), C);
    const tie = server.now();
    for (let i = 0; i < 200; i += 1) server.post(uuid(5000 - i), C, { createdAt: tie });
    for (let i = 0; i < 100; i += 1) server.post(uuid(++n + 10_000), C);
    store.acquire();
    await store.ready();
    await store.open(C);
    while (store.getSnapshot().windows[C]!.hasOlder) await store.loadOlder(C);
    const got = ids(store.getSnapshot().windows[C]!.rows);
    expect(got).toEqual(ids(server.fullRead([C])));
    expect(new Set(got).size).toBe(400);
  });

  it("a reconnect fills the gap before the window shows: nothing missing for good", async () => {
    const { server, store, live } = setup();
    server.addChannel(C, { isDefault: true });
    for (let i = 0; i < 20; i += 1) server.post(uuid(i + 1), C);
    store.acquire();
    await store.ready();
    await store.open(C);
    // A 60 s outage: more than 50 messages arrive with no event.
    for (let i = 0; i < 60; i += 1) server.post(uuid(i + 100), C);
    live.emit({ type: "lost", source: "messages" });
    live.emit({ type: "joined", source: "messages" });
    await settle(40);
    expect(ids(store.getSnapshot().windows[C]!.rows)).toEqual(ids(server.fullRead([C])));
  });

  it("applies a live row with zero requests and skips its own echo", async () => {
    const { server, store, live } = setup();
    server.addChannel(C, { isDefault: true });
    server.post(uuid(1), C);
    store.acquire();
    await store.ready();
    await store.open(C);
    await settle();

    // Someone else's message: from the event, no request.
    const calls = server.calls.length;
    const theirs = server.post(uuid(2), C);
    live.emit({ type: "message", row: theirs, insert: true });
    expect(server.calls.length).toBe(calls);
    expect(ids(store.getSnapshot().windows[C]!.rows)).toContain(theirs.id);
    expect(store.getSnapshot().unread[C]?.unread).toBe(1);

    // Mine: visible at once, under the id the server keeps.
    const id = store.send({ channelId: C, body: "hi" });
    const shown = store.getSnapshot().windows[C]!.rows.at(-1)!;
    expect(shown.id).toBe(id);
    expect(shown.sendState).toBe("sending");
    await settle();
    expect(store.getSnapshot().windows[C]!.rows.at(-1)).toMatchObject({ id, body: "hi" });
    expect(store.getSnapshot().windows[C]!.rows.at(-1)!.sendState).toBeUndefined();

    // Its echo (the same server stamp) changes nothing.
    const before = store.getSnapshot();
    live.emit({ type: "message", row: server.rows.get(id)!, insert: true });
    expect(store.getSnapshot()).toBe(before);

    // A write in flight isn't flicked back by an event about its row.
    const answer = server.holdNext("react");
    const reacting = store.react(theirs.id, "👍", true);
    live.emit({
      type: "message",
      row: server.change(theirs.id, { body: "edited by them" }),
      insert: false,
    });
    let row = store.getSnapshot().windows[C]!.rows.find((r) => r.id === theirs.id)!;
    expect(row.body).toBe("edited by them");
    expect(row.reactions["👍"]).toEqual([ME]);
    answer();
    expect(await reacting).toEqual({ ok: true });
    row = store.getSnapshot().windows[C]!.rows.find((r) => r.id === theirs.id)!;
    expect(row.reactions["👍"]).toEqual([ME]);
    expect(row.body).toBe("edited by them");
  });

  it("a refusal rolls back one write: the others on the same row stay", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    const row = server.post(uuid(1), C, { authorId: ME, body: "original" });
    store.acquire();
    await store.ready();
    await store.open(C);
    server.refuse.set("edit", { code: "42501", message: "You can't edit this message." });
    const [pinned, edited] = await Promise.all([
      store.pin(row.id, true),
      store.edit(row.id, "changed"),
    ]);
    expect(pinned).toEqual({ ok: true });
    expect(edited).toEqual({ ok: false, offline: false, message: "You can't edit this message." });
    const shown = store.getSnapshot().windows[C]!.rows.find((r) => r.id === row.id)!;
    expect(shown.body).toBe("original");
    expect(shown.pinnedAt).not.toBeNull();
    // No reload: the refusal cost no read.
    expect(server.calls.filter((c) => c === "page")).toHaveLength(1);
  });

  it("offline sends wait, then go in order under the same ids; a refusal says Not sent", async () => {
    const { server, copy, store } = setup();
    server.addChannel(C, { isDefault: true });
    store.acquire();
    await store.ready();
    await store.open(C);

    server.offline = true;
    const sent = ["one", "two", "three"].map((body) => store.send({ channelId: C, body }));
    await settle();
    let rows = store.getSnapshot().windows[C]!.rows;
    expect(ids(rows)).toEqual(sent);
    expect(rows.map((r) => r.sendState)).toEqual(["waiting", "waiting", "waiting"]);
    expect(store.getSnapshot().offline).toBe(true);
    // Kept with the copy: a reload still has them.
    expect(copy.metas.get(OWNER)?.outbox.map((e) => e.id)).toEqual(sent);
    // Other writes say "Offline".
    expect(await store.react(sent[0]!, "👍", true)).toMatchObject({ ok: false, offline: true });

    // Back online; the first answer is lost after the server stored it.
    server.offline = false;
    server.loseAnswer.add("send");
    window.dispatchEvent(new Event("online"));
    await settle(40);
    window.dispatchEvent(new Event("online"));
    await settle(40);
    const mine = [...server.rows.values()].filter((r) => r.authorId === ME);
    // Each once, in order, under the ids minted on the device.
    expect(ids(mine.sort((a, b) => compareKeys(keyOf(a), keyOf(b))))).toEqual(sent);
    rows = store.getSnapshot().windows[C]!.rows;
    expect(ids(rows)).toEqual(sent);
    expect(rows.every((r) => !r.sendState)).toBe(true);
    expect(copy.metas.get(OWNER)?.outbox).toEqual([]);

    // The server says no: "Not sent · Retry", never a vanished message.
    server.refuse.set("send", { code: "42501", message: "This channel is archived." });
    const refused = store.send({ channelId: C, body: "four" });
    await settle();
    const failed = store.getSnapshot().windows[C]!.rows.at(-1)!;
    expect(failed).toMatchObject({
      id: refused,
      sendState: "failed",
      sendError: "This channel is archived.",
    });
    expect(copy.metas.get(OWNER)?.outbox.map((e) => e.id)).toEqual([refused]);
    server.refuse.delete("send");
    store.retry(refused);
    await settle();
    expect(server.rows.get(refused)?.body).toBe("four");
    expect(store.getSnapshot().windows[C]!.rows.at(-1)!.sendState).toBeUndefined();
  });

  it("the read mark is the last message on screen and moves forward only", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    const rows = Array.from({ length: 5 }, (_, i) => server.post(uuid(i + 1), C));
    store.acquire();
    await store.ready();
    await store.open(C);
    store.markSeen(C, rows[3]!.id);
    store.markSeen(C, rows[1]!.id);
    await settle();
    expect(store.getSnapshot().mine[C]?.lastReadId).toBe(rows[3]!.id);
    expect(server.marks).toEqual([{ channelId: C, messageId: rows[3]!.id }]);
  });

  it("lands on a message from last month: a window around it, its chain named", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    for (let i = 0; i < 400; i += 1) server.post(uuid(i + 1), C);
    const root = server.rows.get(uuid(150))!;
    const reply = server.post(uuid(9999), C, {
      createdAt: stampOf(server.clock - 1),
      parentId: root.id,
      replyToId: root.id,
    });
    store.acquire();
    await store.ready();
    await store.open(C);
    const target = server.rows.get(uuid(100))!;
    expect(await store.openAt(C, target.id)).toEqual({ channelId: C, chainId: null });
    const win = store.getSnapshot().windows[C]!;
    expect(win.target).toBe(target.id);
    expect(win.hasNewer).toBe(true);
    expect(win.hasOlder).toBe(false);
    expect(win.rows.map((r) => r.id)).toContain(target.id);
    expect(win.rows).toHaveLength(99 + 1 + 100);
    expect(await store.openAt(C, reply.id)).toEqual({ channelId: C, chainId: root.id });
    // Back to the newest: the jump window goes.
    await store.jumpToLatest(C);
    expect(store.getSnapshot().windows[C]!.hasNewer).toBe(false);
  });
});

describe("a paused plan (CV-8a, CH4a)", () => {
  it("still loads every conversation and its messages, and notices the plan coming back", async () => {
    const { server, store } = setup();
    server.enabled = false;
    server.addChannel(C, { isDefault: true });
    server.post(uuid(7001), C);
    store.acquire();
    await settle();
    const snap = store.getSnapshot();
    expect(snap.status).toBe("ready");
    expect(snap.paused).toBe(true);
    expect(Object.keys(snap.channels)).toEqual([C]);
    await store.open(C);
    await settle();
    expect(store.getSnapshot().windows[C]?.rows.map((r) => r.id)).toEqual([uuid(7001)]);

    server.enabled = true;
    await store.sync("manual");
    expect(store.getSnapshot().paused).toBe(false);
  });
});
