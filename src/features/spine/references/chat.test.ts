// CV-10 · message and conversation references (chat-v2 §8, AC9.4, AC15.3): a
// message and a conversation render as a link, a chip, a card and a hover
// preview; a deleted message reads "Deleted message"; one the reader can't read
// (the server answers nothing for it) reads "Private item", with no title, no
// words and no author anywhere in the DOM.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";

import type { ChatChannel, ChatMessageRef } from "../../chat/model";
import { conversationName, firstWords, messageConversation } from "./chat";
import { ReferenceStoreProvider } from "./context";
import { PRIVATE_ITEM_LABEL } from "./kinds";
import { openReferenceFull } from "./open";
import type { ResolveContext } from "./resolvers";
import type { ReferencePreviewApi } from "./rows";
import { ReferenceStore } from "./store";
import type { ReferenceDisplay } from "./types";
import { Reference } from "./ui/reference";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const NOW = new Date(2026, 9, 14, 10, 0, 0);
const MSG = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";
const HIDDEN = "33333333-3333-4333-8333-333333333333";
const ACME = "44444444-4444-4444-8444-444444444444";
const SECRET = "55555555-5555-4555-8555-555555555555";
const DM = "66666666-6666-4666-8666-666666666666";
const SECRET_WORDS = "the acquisition closes Friday";

function messageRef(over: Partial<ChatMessageRef> = {}): ChatMessageRef {
  return {
    id: MSG,
    workspaceId: "w1",
    channelId: ACME,
    channelKind: "channel",
    channelName: "acme",
    channelPrivate: false,
    parentId: null,
    authorId: "u2",
    authorKind: "user",
    authorLabel: null,
    createdAt: "2026-10-12T09:30:00Z",
    editedAt: null,
    deleted: false,
    excerpt: "Can you send the logo SVGs before Friday?",
    ...over,
  };
}

function channel(over: Partial<ChatChannel> = {}): ChatChannel {
  return {
    id: ACME,
    workspaceId: "w1",
    kind: "channel",
    name: "acme",
    topic: "Client work for Acme",
    isPrivate: false,
    dmKey: null,
    createdBy: "u1",
    createdAt: "2026-10-01T09:00:00Z",
    updatedAt: "2026-10-01T09:00:00Z",
    archivedAt: null,
    lastMessageAt: "2026-10-12T09:30:00Z",
    ...over,
  };
}

function makeStore() {
  const none = rs.fn(async () => []);
  const previews = new Proxy({}, { get: () => none }) as unknown as ReferencePreviewApi;
  const messageRefs = rs.fn(async (ids: readonly string[]) =>
    [
      messageRef(),
      messageRef({ id: GONE, deleted: true, excerpt: null, authorId: null }),
      // HIDDEN never answers: the reader can't read its conversation.
    ].filter((r) => ids.includes(r.id)),
  );
  const listChannels = rs.fn(async () => [
    channel(),
    channel({ id: DM, kind: "dm", name: null, dmKey: "u1,u2", topic: "" }),
    // SECRET is a private channel the reader isn't in: RLS leaves it out.
  ]);
  const memberCounts = rs.fn(async () => ({ [ACME]: 4 }));
  const context: ResolveContext = {
    workspaceId: "w1",
    previews,
    taskKey: "MOD",
    personOf: (id) =>
      id === "u2"
        ? { name: "Sofia Reyes", id: "u2", avatarUrl: null }
        : id === "u1"
          ? { name: "Maciej", id: "u1", avatarUrl: null }
          : null,
    chat: { messageRefs, listChannels, memberCounts },
    userId: "u1",
    now: () => NOW,
  };
  const store = new ReferenceStore({
    context: () => context,
    schedule: (fn) => queueMicrotask(fn),
  });
  return { store, messageRefs, listChannels };
}

function show(store: ReferenceStore, type: string, id: string, display: ReferenceDisplay) {
  return render(
    createElement(
      ReferenceStoreProvider,
      { store },
      createElement(Reference, { type, id, display }),
    ),
  );
}

describe("a message reference", () => {
  it("a chip reads author · first words", async () => {
    const { store } = makeStore();
    show(store, "chat_message", MSG, "chip");
    const chip = await screen.findByRole("button", { name: /Sofia Reyes · Can you send the logo/ });
    expect(chip.textContent).toContain("Sofia Reyes · Can you send the logo");
  });

  it("a link is the same words, with no card facts", async () => {
    const { store } = makeStore();
    show(store, "chat_message", MSG, "link");
    const link = await screen.findByRole("button", { name: /Sofia Reyes · Can you send/ });
    expect(link.textContent).not.toContain("#acme");
  });

  it("a card has the author, the conversation, the time and two lines", async () => {
    const { store } = makeStore();
    const { container } = show(store, "chat_message", MSG, "card");
    await waitFor(() => expect(container.textContent).toContain("Sofia Reyes · #acme"));
    expect(container.textContent).toContain("Oct 12");
    expect(container.textContent).toContain("Can you send the logo SVGs before Friday?");
  });

  it("the hover preview is the card", async () => {
    const { store, messageRefs } = makeStore();
    show(store, "chat_message", MSG, "chip");
    const chip = await screen.findByRole("button", { name: /Sofia Reyes/ });
    act(() => {
      fireEvent.focus(chip);
    });
    await waitFor(() => expect(screen.getByText(/Sofia Reyes · #acme/)).toBeTruthy(), {
      timeout: 2000,
    });
    expect(messageRefs).toHaveBeenCalled();
  });

  it("a deleted one reads 'Deleted message'", async () => {
    const { store } = makeStore();
    const { container } = show(store, "chat_message", GONE, "chip");
    await waitFor(() => expect(container.textContent).toContain("Deleted message"));
  });

  it("one the reader can't read is 'Private item' with nothing else in the DOM", async () => {
    const { store } = makeStore();
    const { container } = render(
      createElement(
        ReferenceStoreProvider,
        { store },
        createElement(
          "div",
          null,
          createElement(Reference, { type: "chat_message", id: HIDDEN, display: "link" }),
          createElement(Reference, { type: "chat_message", id: HIDDEN, display: "chip" }),
          createElement(Reference, { type: "chat_message", id: HIDDEN, display: "card" }),
          createElement(Reference, { type: "chat_channel", id: SECRET, display: "card" }),
        ),
      ),
    );
    await waitFor(() => expect(screen.getAllByText(PRIVATE_ITEM_LABEL)).toHaveLength(4));
    expect(container.innerHTML).not.toContain(SECRET_WORDS);
    expect(container.textContent).not.toMatch(/message|conversation|Sofia/i);
  });

  it("a full open lands on its conversation, at the message", async () => {
    const { store } = makeStore();
    show(store, "chat_message", MSG, "chip");
    await screen.findByRole("button", { name: /Sofia Reyes/ });
    expect(messageConversation(MSG)).toEqual({ channelId: ACME, parentId: null });
    const seen = rs.fn();
    window.addEventListener("moduo:entity:open", seen as EventListener);
    openReferenceFull({ type: "chat_message", id: MSG });
    window.removeEventListener("moduo:entity:open", seen as EventListener);
    expect((seen.mock.calls[0]?.[0] as CustomEvent | undefined)?.detail).toEqual({
      type: "chat_channel",
      id: ACME,
      messageId: MSG,
      chainId: null,
    });
  });
});

describe("a conversation reference", () => {
  it("a chip is the glyph and the name", async () => {
    const { store } = makeStore();
    const { container } = show(store, "chat_channel", ACME, "chip");
    await screen.findByRole("button", { name: /acme/ });
    expect(container.querySelector("svg")).toBeTruthy();
  });

  it("a card has the name, the people and the last message", async () => {
    const { store } = makeStore();
    const { container } = show(store, "chat_channel", ACME, "card");
    await waitFor(() => expect(container.textContent).toContain("4 people"));
    expect(container.textContent).toContain("acme");
    expect(container.textContent).toContain("Last message Oct 12");
  });

  it("a direct message is named by the other people in it", async () => {
    const { store } = makeStore();
    show(store, "chat_channel", DM, "chip");
    await screen.findByRole("button", { name: /Sofia Reyes/ });
  });
});

describe("the words", () => {
  it("first words collapse whitespace and stop at 48 characters", () => {
    expect(firstWords("  a\n b  ")).toBe("a b");
    expect(firstWords("x".repeat(60))).toHaveLength(48);
  });

  it("a channel is #name; a direct message is its other people", () => {
    const personOf = (id: string) => ({ name: id.toUpperCase(), id, avatarUrl: null });
    expect(conversationName({ kind: "channel", name: "acme", dmKey: null }, personOf, "u1")).toBe(
      "#acme",
    );
    expect(conversationName({ kind: "dm", name: null, dmKey: "u1,u2" }, personOf, "u1")).toBe("U2");
  });
});
