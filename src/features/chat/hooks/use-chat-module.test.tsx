import { afterAll, describe, expect, it, rs } from "@rstest/core";
import { renderHook, waitFor } from "@testing-library/react";

// v1's screens read the chat store through this hook (CV-3): it settles without
// a render loop, follows typing in the open conversation only, stays locked
// without chat, and lands a deep link on its message.

const sockets = rs.hoisted(() => ({
  channels: [] as { topic: string; removed: boolean }[],
}));
rs.mock("@/lib/runtime.web", () => ({
  supabaseClient: {
    channel: (topic: string) => {
      const ch = { topic, removed: false };
      sockets.channels.push(ch);
      const api = {
        on: () => api,
        subscribe: () => api,
        track: () => Promise.resolve("ok"),
        presenceState: () => ({}),
        __ch: ch,
      };
      return api;
    },
    removeChannel: (api: { __ch: { removed: boolean } }) => {
      api.__ch.removed = true;
      return Promise.resolve("ok");
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  },
}));
rs.mock("sonner", () => ({ toast: Object.assign(() => {}, { error: () => {} }) }));

import type { ModuoRuntime } from "@/lib/runtime.types";
import { memoryChatCopy } from "../store/device-copy";
import { setChatStoreOptionsForTests, wipeChatCopies } from "../store/store";
import { FakeChatServer, fakeLive, ME, uuid, WS } from "../store/testing";
import { useChatModule } from "./use-chat-module";

setChatStoreOptionsForTests({
  copy: memoryChatCopy(),
  live: fakeLive(),
  timing: { persistMs: 0, markReadMs: 0, joinDebounceMs: 0 },
});
afterAll(() => {
  void wipeChatCopies();
  setChatStoreOptionsForTests({});
});

const GENERAL = uuid(7001);
const OTHER = uuid(7002);

function fakeRuntime(enabled: boolean) {
  const server = new FakeChatServer();
  server.enabled = enabled;
  server.addChannel(GENERAL, { isDefault: true });
  server.addChannel(OTHER);
  const runtime = {
    chat: server.transport(),
    workspace: {
      listMembers: rs.fn(async () => [{ user_id: ME, profiles: { display_name: "Mike" } }]),
    },
  } as unknown as ModuoRuntime;
  return { server, runtime };
}

const typingTopics = () =>
  sockets.channels
    .filter((c) => c.topic.startsWith("chat:typing:"))
    .map((c) => [c.topic.slice(12), !c.removed]);

describe("useChatModule", () => {
  it("loads a chat-enabled workspace and settles (no render loop)", async () => {
    const { server, runtime } = fakeRuntime(true);
    server.post(uuid(1), GENERAL);
    const { result, unmount } = renderHook(() =>
      useChatModule({
        runtime,
        workspaceId: WS,
        userId: ME,
        activeChannelId: GENERAL,
        activeThreadId: null,
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await waitFor(() => expect(result.current.state.messages[GENERAL]?.loaded).toBe(true));
    await waitFor(() => expect(result.current.state.people[ME]?.name).toBe("Mike"));
    expect(result.current.state.messages[GENERAL]?.items.map((m) => m.id)).toEqual([uuid(1)]);
    expect(server.calls.filter((c) => c === "page")).toHaveLength(1);
    unmount();
  });

  it("follows typing in the open conversation only: joins on open, leaves on switch and unmount", async () => {
    sockets.channels.length = 0;
    const { runtime } = fakeRuntime(true);
    const { result, rerender, unmount } = renderHook(
      ({ channelId }: { channelId: string | null }) =>
        useChatModule({
          runtime,
          workspaceId: WS,
          userId: ME,
          activeChannelId: channelId,
          activeThreadId: null,
        }),
      { initialProps: { channelId: GENERAL as string | null } },
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await waitFor(() => expect(typingTopics()).toEqual([[GENERAL, true]]));

    rerender({ channelId: OTHER });
    await waitFor(() =>
      expect(typingTopics()).toEqual([
        [GENERAL, false],
        [OTHER, true],
      ]),
    );

    rerender({ channelId: null });
    await waitFor(() => expect(typingTopics().every(([, open]) => !open)).toBe(true));

    rerender({ channelId: GENERAL });
    await waitFor(() => expect(typingTopics().at(-1)).toEqual([GENERAL, true]));
    unmount();
    expect(typingTopics().every(([, open]) => !open)).toBe(true);
  });

  it("reports a locked workspace without loading anything", async () => {
    const { server, runtime } = fakeRuntime(false);
    const { result, unmount } = renderHook(() =>
      useChatModule({
        runtime,
        workspaceId: uuid(6000),
        userId: ME,
        activeChannelId: null,
        activeThreadId: null,
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("locked"));
    expect(server.calls).not.toContain("listChannels");
    unmount();
  });

  it("lands a deep link on its message: the window loads around it (AC1.6)", async () => {
    const { server, runtime } = fakeRuntime(true);
    for (let i = 0; i < 300; i += 1) server.post(uuid(i + 1), GENERAL);
    const old = uuid(20);
    const { result, unmount } = renderHook(() =>
      useChatModule({
        runtime,
        workspaceId: uuid(6001),
        userId: ME,
        activeChannelId: GENERAL,
        activeThreadId: null,
        focusMessageId: old,
      }),
    );
    await waitFor(() =>
      expect(result.current.state.messages[GENERAL]?.items.map((m) => m.id)).toContain(old),
    );
    expect(server.calls).toContain("message");
    // The window doesn't reach the newest messages until "Jump to latest".
    expect(result.current.state.messages[GENERAL]?.hasNewer).toBe(true);
    await result.current.actions.jumpToLatest(GENERAL);
    await waitFor(() => expect(result.current.state.messages[GENERAL]?.hasNewer).toBe(false));
    expect(result.current.state.messages[GENERAL]?.items.at(-1)?.id).toBe(uuid(300));
    unmount();
  });
});
