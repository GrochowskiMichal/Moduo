// CV-14 · An item's decisions are read only when it has a conversation the
// reader can see (no conversation, no decision): no request for the rest.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, render } from "@testing-library/react";
import type { ReactNode } from "react";

import { AuthContext } from "@/providers/auth-provider";
import { WorkspaceContext } from "../workspaces/workspace-context";
import { MentionedInLines, useItemChatSlots } from "./mentioned-in";
import type { ChatItemConversation } from "./model";

afterEach(cleanup);

const W = "w-1";
const conversation: ChatItemConversation = {
  channelId: "c-1",
  workspaceId: W,
  channelKind: "channel",
  channelName: "acme",
  channelPrivate: false,
  relation: "conversation-of",
  since: "2026-10-16T10:00:00Z",
  unread: 0,
  archived: false,
};

function harness(conversations: ChatItemConversation[]) {
  const decisionsForItem = rs.fn(async () => []);
  const conversationsForItem = rs.fn(async () => conversations);
  const runtime = { chat: { decisionsForItem, conversationsForItem } };
  const wrap = (children: ReactNode) => (
    <AuthContext.Provider value={{ runtime } as never}>
      <WorkspaceContext.Provider
        value={{ selectedWorkspaceId: W, modulePermissions: { chat: "edit" } } as never}
      >
        {children}
      </WorkspaceContext.Provider>
    </AuthContext.Provider>
  );
  return { wrap, decisionsForItem, conversationsForItem };
}

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 10)));

function Slots({ id }: { id: string }) {
  const { conversation: c, decisions } = useItemChatSlots("project", id);
  return (
    <>
      {c}
      {decisions}
    </>
  );
}

describe("an item's decisions are read only with a conversation (CV-14)", () => {
  it("an item with no conversation sends no decisions request", async () => {
    const h = harness([]);
    render(h.wrap(<MentionedInLines entityType="contact" entityId="ct-1" />));
    await settle();
    expect(h.conversationsForItem).toHaveBeenCalledTimes(1);
    expect(h.decisionsForItem).not.toHaveBeenCalled();
  });

  it("once its conversations arrive, the decisions are read once", async () => {
    const h = harness([conversation]);
    render(h.wrap(<MentionedInLines entityType="contact" entityId="ct-1" />));
    await settle();
    expect(h.decisionsForItem).toHaveBeenCalledTimes(1);
    expect(h.decisionsForItem).toHaveBeenCalledWith("contact", "ct-1");
  });

  it("the project overview's slots share one conversations read and skip decisions without one", async () => {
    const none = harness([]);
    render(none.wrap(<Slots id="p-1" />));
    await settle();
    expect(none.conversationsForItem).toHaveBeenCalledTimes(1);
    expect(none.decisionsForItem).not.toHaveBeenCalled();
    cleanup();

    const some = harness([conversation]);
    render(some.wrap(<Slots id="p-1" />));
    await settle();
    expect(some.conversationsForItem).toHaveBeenCalledTimes(1);
    expect(some.decisionsForItem).toHaveBeenCalledTimes(1);
  });
});
