// HV-15 variant of benchmarks/escapes/509-2-outbox-overtaken: an edit of my
// message that is still being sent goes straight to the server (`edit` never
// looks at the outbox, unlike `remove`), so it jumps the send, is refused, and
// the send lands last with the old words. Fixed in MOD-562; un-parked.
// Run: bun run --cwd apps/app test src/features/chat/store/store.509-2.variant.test.ts

import { afterEach, describe, expect, it } from "@rstest/core";

import { memoryChatCopy } from "./device-copy";
import { ChatStore } from "./store";
import { FakeChatServer, fakeLive, ME, settle, uuid, WS } from "./testing";

const C = uuid(9101);
const stores: ChatStore[] = [];

function setup() {
  const server = new FakeChatServer();
  const live = fakeLive();
  const store = new ChatStore(server.transport(), ME, WS, {
    copy: memoryChatCopy(),
    live,
    timing: {
      persistMs: 0,
      markReadMs: 0,
      joinDebounceMs: 0,
      focusThrottleMs: 0,
      retryMs: 3_600_000,
      gapFillMs: 3_600_000,
      accessCheckMs: 3_600_000,
    },
  });
  stores.push(store);
  return { server, store, live };
}

afterEach(() => {
  for (const s of stores.splice(0)) s.dispose({ persist: false });
});

describe("HV-15 variant 509-2-outbox-overtaken: a chat edit jumps its own waiting send", () => {
  it("editing a message while it is being sent keeps the edited words on the server", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    store.acquire();
    await store.ready();
    await store.open(C);
    // The send is on its way (its answer held).
    const answer = server.holdNext("send");
    const id = store.send({ channelId: C, body: "teh plan" });
    await settle(2);
    // The person fixes the typo before the answer comes back (Edit is offered on own rows).
    const edited = store.edit(id, "the plan");
    await settle(2);
    answer();
    await edited;
    await settle(20);
    // In the order they were made: the newer words are the ones that stay.
    expect(server.rows.get(id)?.body).toBe("the plan");
  });

  it("editing a send still waiting for the network sends the edited words, with no edit call", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    store.acquire();
    await store.ready();
    await store.open(C);
    server.offline = true;
    const id = store.send({ channelId: C, body: "teh plan" });
    await settle();
    expect(await store.edit(id, "the plan")).toEqual({ ok: true });
    // The waiting row shows the new words at once.
    expect(store.getSnapshot().windows[C]!.rows.at(-1)!.body).toBe("the plan");
    server.offline = false;
    window.dispatchEvent(new Event("online"));
    await settle(40);
    expect(server.rows.get(id)?.body).toBe("the plan");
    expect(server.calls).not.toContain("edit");
  });

  it("edited while sending and the answer is lost: edited once its echo lands", async () => {
    const { server, store, live } = setup();
    server.addChannel(C, { isDefault: true });
    store.acquire();
    await store.ready();
    await store.open(C);
    const answer = server.holdNext("send");
    const id = store.send({ channelId: C, body: "teh plan" });
    await settle(2);
    expect(await store.edit(id, "the plan")).toEqual({ ok: true });
    expect(store.getSnapshot().windows[C]!.rows.at(-1)!.body).toBe("the plan");
    server.loseAnswer.add("send");
    answer();
    await settle(20);
    expect(server.rows.get(id)?.body).toBe("teh plan");
    live.emit({ type: "message", row: server.rows.get(id)!, insert: true });
    await settle(20);
    expect(server.rows.get(id)?.body).toBe("the plan");
    expect(store.rowById(id)?.body).toBe("the plan");
  });

  it("an edit after a send whose answer was lost reaches the server when the resend lands", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    store.acquire();
    await store.ready();
    await store.open(C);
    // The send lands but its answer never comes back: it waits to be sent again.
    server.loseAnswer.add("send");
    const id = store.send({ channelId: C, body: "teh plan" });
    await settle(20);
    expect(server.rows.get(id)?.body).toBe("teh plan");
    expect(await store.edit(id, "the plan")).toEqual({ ok: true });
    // The resend answers with the stored (old) words; the edit follows it.
    window.dispatchEvent(new Event("online"));
    await settle(40);
    expect(server.rows.get(id)?.body).toBe("the plan");
    expect(store.rowById(id)?.body).toBe("the plan");
  });

  it("a delete after a send whose answer was lost deletes it on the server once the resend lands", async () => {
    const { server, store } = setup();
    server.addChannel(C, { isDefault: true });
    store.acquire();
    await store.ready();
    await store.open(C);
    server.loseAnswer.add("send");
    const id = store.send({ channelId: C, body: "oops" });
    await settle(20);
    expect(server.rows.get(id)?.deletedAt ?? null).toBeNull();
    expect(await store.remove(id)).toEqual({ ok: true });
    window.dispatchEvent(new Event("online"));
    await settle(40);
    expect(server.rows.get(id)?.deletedAt).not.toBeNull();
  });
});
