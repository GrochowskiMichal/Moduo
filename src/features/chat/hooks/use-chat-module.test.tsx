import { describe, expect, it, rs } from "@rstest/core";
import { renderHook, waitFor } from "@testing-library/react";
import type { ModuoRuntime } from "@/lib/runtime.types";
import type { ChatChannel, ChatMember, ChatRuntime } from "../model";

const fakeLink = {
  subscribe: () => () => {},
  subscribePresence: () => () => {},
  subscribeTyping: () => () => {},
  getOnline: () => new Set<string>(),
  getTyping: () => [],
  sendTyping: () => {},
};
rs.mock("../realtime", () => ({
  acquireChatLink: () => ({ link: fakeLink, release: () => {} }),
  dispatchChatReadChanged: () => {},
}));

import { useChatModule } from "./use-chat-module";

const WS = "w";
const ME = "00000000-0000-4000-8000-000000000001";
const general: ChatChannel = {
  id: "11111111-1111-4111-8111-111111111111",
  workspaceId: WS,
  kind: "channel",
  name: "general",
  topic: "",
  isPrivate: false,
  dmKey: null,
  createdBy: ME,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
  archivedAt: null,
  lastMessageAt: null,
};
const member: ChatMember = {
  channelId: general.id,
  userId: ME,
  workspaceId: WS,
  notifyLevel: "mentions",
  starred: false,
  lastReadAt: "2026-10-01T00:00:00Z",
  joinedAt: "2026-10-01T00:00:00Z",
};

function fakeRuntime(enabled: boolean) {
  const chat: Partial<ChatRuntime> = {
    isEnabled: rs.fn(async () => enabled),
    bootstrap: rs.fn(async () => {}),
    listChannels: rs.fn(async () => [general]),
    listMyMemberships: rs.fn(async () => [member]),
    unreadCounts: rs.fn(async () => []),
    listMessages: rs.fn(async () => []),
    markRead: rs.fn(async () => {}),
    join: rs.fn(async () => member),
  };
  return {
    chat,
    workspace: {
      listMembers: rs.fn(async () => [{ user_id: ME, profiles: { display_name: "Mike" } }]),
    },
  } as unknown as ModuoRuntime;
}

describe("useChatModule", () => {
  it("loads a chat-enabled workspace and settles (no render loop)", async () => {
    const runtime = fakeRuntime(true);
    const { result } = renderHook(() =>
      useChatModule({
        runtime,
        workspaceId: WS,
        userId: ME,
        activeChannelId: general.id,
        activeThreadId: null,
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await waitFor(() => expect(result.current.state.messages[general.id]?.loaded).toBe(true));
    expect(result.current.state.people[ME]?.name).toBe("Mike");
    expect(runtime.chat.listMessages).toHaveBeenCalledTimes(1);
  });

  it("reports a locked workspace without loading anything", async () => {
    const runtime = fakeRuntime(false);
    const { result } = renderHook(() =>
      useChatModule({
        runtime,
        workspaceId: WS,
        userId: ME,
        activeChannelId: null,
        activeThreadId: null,
      }),
    );
    await waitFor(() => expect(result.current.state.status).toBe("locked"));
    expect(runtime.chat.listChannels).not.toHaveBeenCalled();
  });
});
