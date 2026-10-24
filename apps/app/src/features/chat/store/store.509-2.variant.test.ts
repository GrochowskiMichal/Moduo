// HV-15 variant of benchmarks/escapes/509-2-outbox-overtaken: an edit of my
// message that is still being sent goes straight to the server (`edit` never
// looks at the outbox, unlike `remove`), so it jumps the send, is refused, and
// the send lands last with the old words. Fails until the fix lands.
// Run: MODUO_HUNT=1 bun run --cwd apps/app test src/features/chat/store/store.509-2.variant.test.ts

import { afterEach, describe, expect, it } from "@rstest/core";

import { memoryChatCopy } from "./device-copy";
import { ChatStore } from "./store";
import { FakeChatServer, fakeLive, ME, settle, uuid, WS } from "./testing";

const C = uuid(9101);
const stores: ChatStore[] = [];

function setup() {
  const server = new FakeChatServer();
  const store = new ChatStore(server.transport(), ME, WS, {
    copy: memoryChatCopy(),
    live: fakeLive(),
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
  return { server, store };
}

afterEach(() => {
  for (const s of stores.splice(0)) s.dispose({ persist: false });
});

const hunt = process.env.MODUO_HUNT ? describe : describe.skip;

hunt("HV-15 variant 509-2-outbox-overtaken: a chat edit jumps its own waiting send", () => {
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
});
