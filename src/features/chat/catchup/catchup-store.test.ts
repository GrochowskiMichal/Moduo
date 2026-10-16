// Catch up's list (CV-11): reads while watched, re-reads when your rows move,
// hides at once on Done / Later and brings back on a refusal or Undo.

import { afterEach, describe, expect, it } from "@rstest/core";

import type { ChatCatchupItem } from "../model";
import { memoryChatCopy } from "../store/device-copy";
import { ChatStore } from "../store/store";
import { FakeChatServer, fakeLive, ME, settle, stampOf, uuid, WS } from "../store/testing";
import { CatchupStore, catchupStoreFor } from "./catchup-store";

const C = uuid(10);
const D = uuid(11);

function item(n: number, channelId: string, messageId: string | null, extra: Partial<ChatCatchupItem> = {}): ChatCatchupItem {
  const at = stampOf(1_760_000_000_000_000 + n * 1_000_000);
  return {
    id: uuid(100 + n),
    channelId,
    messageId,
    chainRootId: null,
    reason: "mention",
    actorId: null,
    createdAt: at,
    laterUntil: null,
    returnedAt: null,
    at,
    ...extra,
  };
}

function setup() {
  const server = new FakeChatServer();
  server.addChannel(C);
  server.addChannel(D);
  const m1 = server.post(uuid(1), C);
  const m2 = server.post(uuid(2), D);
  server.catchup = [item(1, C, m1.id), item(2, D, m2.id, { reason: "dm" })];
  const catchup = new CatchupStore(server.transport(), WS, { settleMs: 0 });
  return { server, catchup, m1, m2 };
}

const ids = (c: CatchupStore) => c.getSnapshot().items.map((i) => i.id);

describe("Catch up's list (CV-11)", () => {
  it("reads only while watched, with the messages its items name", async () => {
    const { server, catchup, m1, m2 } = setup();
    catchup.changed();
    await settle();
    expect(server.calls).not.toContain("catchupOpen");
    const release = catchup.watch();
    await settle();
    expect(catchup.getSnapshot().status).toBe("ready");
    expect(ids(catchup)).toEqual([uuid(101), uuid(102)]);
    expect(Object.keys(catchup.getSnapshot().messages).sort()).toEqual([m1.id, m2.id].sort());
    release();
  });

  it("a message the chat store holds isn't fetched again", async () => {
    const { server, m1, m2 } = setup();
    const catchup = new CatchupStore(server.transport(), WS, {
      settleMs: 0,
      rowById: (id) => (id === m1.id ? m1 : undefined),
    });
    catchup.watch();
    await settle();
    expect(server.calls.filter((c) => c === "messages")).toHaveLength(1);
    expect(catchup.getSnapshot().messages[m2.id]?.id).toBe(m2.id);
  });

  it("an item in a conversation you can no longer read isn't listed", async () => {
    const { server, catchup } = setup();
    server.readable.delete(D);
    catchup.watch();
    await settle();
    expect(ids(catchup)).toEqual([uuid(101)]);
  });

  it("Done hides at once, closes on the server, and Undo brings it back", async () => {
    const { server, catchup } = setup();
    catchup.watch();
    await settle();
    const held = server.holdNext("catchupDone");
    const done = catchup.done([uuid(101)]);
    expect(ids(catchup)).toEqual([uuid(102)]);
    held();
    expect(await done).toEqual({ ok: true });
    await settle();
    expect(ids(catchup)).toEqual([uuid(102)]);
    expect(await catchup.reopen([uuid(101)])).toEqual({ ok: true });
    expect(ids(catchup).sort()).toEqual([uuid(101), uuid(102)].sort());
  });

  it("a refused Done shows the item again", async () => {
    const { server, catchup } = setup();
    catchup.watch();
    await settle();
    server.refuse.set("catchupDone", { code: "42501", message: "Sign in first." });
    const res = await catchup.done([uuid(101)]);
    expect(res).toEqual({ ok: false, offline: false, message: "Sign in first." });
    expect(ids(catchup)).toContain(uuid(101));
  });

  it("Later hides the item and asks the server for its message", async () => {
    const { server, catchup, m1 } = setup();
    catchup.watch();
    await settle();
    const at = new Date(Date.now() + 3_600_000).toISOString();
    expect(await catchup.remind({ messageId: m1.id }, at, [uuid(101)])).toEqual({ ok: true });
    await settle();
    expect(server.reminds).toEqual([{ messageId: m1.id, channelId: null, at }]);
    expect(ids(catchup)).toEqual([uuid(102)]);
  });

  it("a refused Later shows the item again", async () => {
    const { server, catchup, m1 } = setup();
    catchup.watch();
    await settle();
    server.refuse.set("remind", { code: "22023", message: "Pick a time within a year." });
    const res = await catchup.remind({ messageId: m1.id }, "2030-01-01T00:00:00Z", [uuid(101)]);
    expect(res.ok).toBe(false);
    expect(ids(catchup)).toContain(uuid(101));
  });

  it("over 1,000 ids go in batches", async () => {
    const { server, catchup } = setup();
    catchup.watch();
    await settle();
    const many = Array.from({ length: 1500 }, (_, i) => uuid(5000 + i));
    await catchup.done(many);
    expect(server.calls.filter((c) => c === "catchupDone")).toHaveLength(2);
  });
});

describe("Catch up follows your rows (CV-11)", () => {
  const stores: ChatStore[] = [];
  afterEach(() => {
    for (const s of stores.splice(0)) s.dispose({ persist: false });
  });

  it("a Catch up row event re-reads the list while watched", async () => {
    const server = new FakeChatServer();
    server.addChannel(C, { isDefault: true });
    const live = fakeLive();
    const store = new ChatStore(server.transport(), ME, WS, {
      copy: memoryChatCopy(),
      live,
      timing: { persistMs: 0, markReadMs: 0, joinDebounceMs: 0, retryMs: 3_600_000 },
    });
    stores.push(store);
    store.acquire();
    await store.ready();
    const catchup = catchupStoreFor(store);
    expect(catchupStoreFor(store)).toBe(catchup);
    catchup.watch();
    await settle();
    const before = server.calls.filter((c) => c === "catchupOpen").length;
    const m = server.post(uuid(3), C);
    server.catchup = [item(3, C, m.id)];
    live.emit({ type: "catchup" });
    await new Promise((r) => setTimeout(r, 450));
    await settle();
    expect(server.calls.filter((c) => c === "catchupOpen").length).toBe(before + 1);
    expect(ids(catchup)).toEqual([uuid(103)]);
  });
});
