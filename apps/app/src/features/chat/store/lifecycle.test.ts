// Chat's copy is one person's (CV-3), and a sign-out keeps what waits to send
// (Track C3, as Tasks since #509): rows, drafts and the sidebar go, waiting
// sends stay under their person's key and go out when that person signs in
// here again. A null session is not a sign-out; account deletion takes
// everything; a workspace left takes its copy.

import { afterEach, describe, expect, it } from "@rstest/core";

import type { ModuoRuntime } from "../../../lib/runtime.types";
import { waitingSyncCount } from "../../../lib/sync/store";
import { memoryChatCopy, ownerKey } from "./device-copy";
import {
  attachChatUser,
  chatStore,
  keepChatWorkspaces,
  setChatStoreOptionsForTests,
  wipeChatCopies,
} from "./store";
import { FakeChatServer, fakeLive, ME, settle, uuid, WS, YOU } from "./testing";

const C = uuid(9101);
const OWNER = ownerKey(ME, WS);

function setup() {
  const server = new FakeChatServer();
  server.addChannel(C, { isDefault: true });
  const copy = memoryChatCopy();
  setChatStoreOptionsForTests({
    copy,
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
  const runtime = { chat: server.transport() } as unknown as ModuoRuntime;
  return { server, copy, runtime };
}

/** Signed in as ME, a conversation open, two sends waiting offline. */
async function withWaiting() {
  const ctx = setup();
  ctx.server.post(uuid(9201), C, { authorId: YOU });
  const store = chatStore(ctx.runtime, ME, WS);
  const release = store.acquire();
  await store.ready();
  await store.open(C);
  store.setDraft(C, null, "half a thought");
  ctx.server.offline = true;
  const sent = [
    store.send({ channelId: C, body: "one" }),
    store.send({ channelId: C, body: "two" }),
  ];
  await settle();
  await store.persistNow();
  expect(ctx.copy.metas.get(OWNER)?.outbox.map((e) => e.id)).toEqual(sent);
  expect(ctx.copy.rows.get(OWNER)?.size ?? 0).toBeGreaterThan(0);
  return { ...ctx, store, release, sent };
}

afterEach(async () => {
  await wipeChatCopies({ keepWaiting: false });
  setChatStoreOptionsForTests({});
});

describe("the chat copy and who is signed in", () => {
  it("a null session (an expired token offline) stops the store and keeps the copy whole", async () => {
    const { copy, store, sent } = await withWaiting();
    await attachChatUser(null);
    await settle();
    expect(copy.metas.get(OWNER)?.outbox.map((e) => e.id)).toEqual(sent);
    expect(copy.metas.get(OWNER)?.drafts).toEqual({ [`${C}:`]: "half a thought" });
    expect(copy.rows.get(OWNER)?.size ?? 0).toBeGreaterThan(0);
    // Stopped: nothing more is sent from it.
    expect(store.waitingEntries().map((e) => e.id)).toEqual(sent);
  });

  it("sign-out keeps the waiting sends (rows, drafts and sidebar go) and sends them on the next sign-in", async () => {
    const { server, copy, runtime, sent } = await withWaiting();
    expect(waitingSyncCount()).toBe(2);
    await wipeChatCopies();
    await settle();
    const meta = copy.metas.get(OWNER);
    expect(meta?.outbox.map((e) => e.id)).toEqual(sent);
    expect(meta?.drafts).toEqual({});
    expect(meta?.channels).toEqual([]);
    expect(copy.rows.get(OWNER)?.size ?? 0).toBe(0);
    expect(waitingSyncCount()).toBe(0);

    // The same person signs in again, online: the sends go, once each, in order.
    server.offline = false;
    await attachChatUser(ME);
    const again = chatStore(runtime, ME, WS);
    again.acquire();
    await again.ready();
    await settle(40);
    const mine = [...server.rows.values()].filter((r) => r.authorId === ME).map((r) => r.id);
    expect(mine).toEqual(sent);
    await again.persistNow();
    expect(copy.metas.get(OWNER)?.outbox).toEqual([]);
  });

  it("another person signing in cuts the first one's copy down to its waiting sends", async () => {
    const { copy, runtime, store, sent } = await withWaiting();
    await attachChatUser(YOU);
    await settle();
    expect(copy.metas.get(OWNER)?.outbox.map((e) => e.id)).toEqual(sent);
    expect(copy.rows.get(OWNER)?.size ?? 0).toBe(0);
    // The first person's store is gone: the workspace's store is the new person's.
    expect(chatStore(runtime, YOU, WS)).not.toBe(store);
  });

  it("a person with nothing waiting leaves no copy behind", async () => {
    const { copy, runtime } = setup();
    const store = chatStore(runtime, ME, WS);
    store.acquire();
    await store.ready();
    await store.open(C);
    await store.persistNow();
    expect(copy.metas.has(OWNER)).toBe(true);
    await wipeChatCopies();
    expect(copy.metas.has(OWNER)).toBe(false);
    expect(copy.rows.get(OWNER)?.size ?? 0).toBe(0);
  });

  it("account deletion takes the waiting sends too", async () => {
    const { copy } = await withWaiting();
    await wipeChatCopies({ keepWaiting: false });
    expect(copy.metas.size).toBe(0);
    expect(copy.rows.size).toBe(0);
  });

  it("a workspace no longer on the list takes its copy, waiting sends and all", async () => {
    const { copy } = await withWaiting();
    await keepChatWorkspaces(ME, ["another-workspace"]);
    expect(copy.metas.has(OWNER)).toBe(false);
  });
});
