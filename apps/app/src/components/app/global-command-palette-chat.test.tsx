// GS-6 · ⌘K's Messages and Conversations come from search_all
// (specs/global-search.md AC5, Q16b): no separate chat calls, the two groups
// in their fixed places, a message read as its author in its conversation, and
// a message opened at that message (and its chain when it is a reply).
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

type Row = Record<string, unknown>;

// Stable objects, as the real providers give: a new runtime each render would
// re-run every search effect.
const h = rs.hoisted(() => {
  const h = {
    rows: [] as Row[],
    types: [] as string[][],
    chatSearches: 0,
    message: null as null | { id: string; channelId: string; parentId: string | null },
    navigations: [] as unknown[],
    auth: null as unknown,
    workspace: {
      selectedWorkspaceId: "w1",
      selectedWorkspace: { id: "w1", taskKey: null },
      modulePermissions: { chat: "edit", tasks: "edit", notes: "edit", contacts: "edit" } as Record<
        string,
        string
      >,
      members: [],
    },
  };
  h.auth = {
    userId: "me",
    runtime: {
      chat: {
        search: async () => {
          h.chatSearches++;
          return { data: [], error: null };
        },
        findConversations: async () => {
          h.chatSearches++;
          return { data: [], error: null };
        },
        message: async (id: string) =>
          h.message && h.message.id === id
            ? { data: { ...h.message }, error: null }
            : { data: null, error: { code: null, message: "not found" } },
      },
      spine: {
        searchAll: async (call: { types: string[] }) => {
          h.types.push(call.types);
          return h.rows;
        },
      },
    },
  };
  return h;
});

rs.mock("@tanstack/react-router", () => ({
  useNavigate: () => (to: unknown) => {
    h.navigations.push(to);
  },
}));
rs.mock("../../providers/auth-provider", () => ({ useAuth: () => h.auth }));
rs.mock("../../providers/workspace-provider", () => ({ useWorkspace: () => h.workspace }));

import { ENTITY_OPEN_EVENT } from "../../lib/entity-open";
import { dispatchOpenPalette, GlobalCommandPalette } from "./global-command-palette";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});

const opened: unknown[] = [];
const onOpen = (e: Event) => opened.push((e as CustomEvent).detail);

beforeEach(() => {
  h.rows = [];
  h.types = [];
  h.chatSearches = 0;
  h.message = null;
  h.navigations = [];
  h.workspace.modulePermissions = { chat: "edit", tasks: "edit", notes: "edit", contacts: "edit" };
  opened.length = 0;
  window.addEventListener(ENTITY_OPEN_EVENT, onOpen);
});
afterEach(() => {
  window.removeEventListener(ENTITY_OPEN_EVENT, onOpen);
  cleanup();
});

function hit(type: string, id: string, title: string, extra: Row = {}): Row {
  return {
    entity_type: type,
    entity_id: id,
    title,
    context: null,
    snippet: null,
    icon: null,
    match: "title",
    rank: 0.75,
    updated_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    archived: false,
    score: 0.5,
    type_total: 1,
    top: false,
    ...extra,
  };
}

async function typeInPalette(words: string) {
  render(<GlobalCommandPalette />);
  act(() => {
    dispatchOpenPalette();
  });
  const input = await screen.findByPlaceholderText(/Search messages/);
  fireEvent.change(input, { target: { value: words } });
}

const group = (heading: string) =>
  [...document.querySelectorAll<HTMLElement>("[cmdk-group]")].find(
    (g) => g.querySelector("[cmdk-group-heading]")?.textContent === heading,
  );

describe("⌘K's Messages and Conversations (GS-6)", () => {
  it("asks search_all for messages and conversations, and Chat for nothing of its own", async () => {
    await typeInPalette("plans");
    await waitFor(() => expect(h.types.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(h.types[0]).toContain("chat_message");
    expect(h.types[0]).toContain("chat_channel");
    await act(async () => new Promise((r) => setTimeout(r, 250)));
    expect(h.chatSearches).toBe(0);
  });

  it("draws a message as its author in its conversation, with the marked snippet, between Events and Email", async () => {
    h.rows = [
      hit("event", "e1", "Plans review", { top: true }),
      hit("chat_message", "m1", "Alicja Żak", {
        context: "open-plans",
        snippet: "the plans for Friday",
        match: "body",
        rank: 0.4,
      }),
      hit("chat_channel", "c1", "open-plans"),
      hit("email_thread", "t1", "Re: plans"),
    ];
    await typeInPalette("plans");
    await screen.findByText("Alicja Żak", undefined, { timeout: 2000 });
    const headings = [...document.querySelectorAll("[cmdk-group-heading]")].map((n) => n.textContent);
    expect(headings.slice(0, 4)).toEqual(["Top result", "Messages", "Conversations", "Email"]);
    const messages = group("Messages") as HTMLElement;
    expect(within(messages).getByText("open-plans")).toBeTruthy();
    expect(within(messages).getByText("plans").tagName).toBe("MARK");
    expect(within(group("Conversations") as HTMLElement).getByText("open-plans")).toBeTruthy();
  });

  it("opens a message at that message, beside its chain when it is a reply (Q16b)", async () => {
    h.rows = [hit("chat_message", "m1", "Alicja Żak", { context: "open-plans", match: "body" })];
    h.message = { id: "m1", channelId: "c1", parentId: "root1" };
    await typeInPalette("plans");
    fireEvent.click(await screen.findByText("Alicja Żak", undefined, { timeout: 2000 }));
    await waitFor(() => expect(opened).toHaveLength(1));
    expect(opened[0]).toEqual({ type: "chat_channel", id: "c1", messageId: "m1", chainId: "root1" });
  });

  it("opens a conversation in Chat", async () => {
    h.rows = [hit("chat_channel", "c1", "open-plans")];
    await typeInPalette("plans");
    fireEvent.click(await screen.findByText("open-plans", undefined, { timeout: 2000 }));
    expect(opened).toEqual([{ type: "chat_channel", id: "c1" }]);
  });

  it("a message that can't be read any more lands in Chat's search for the query", async () => {
    h.rows = [hit("chat_message", "gone", "Alicja Żak", { match: "body" })];
    await typeInPalette("plans");
    fireEvent.click(await screen.findByText("Alicja Żak", undefined, { timeout: 2000 }));
    await waitFor(() => expect(h.navigations).toHaveLength(1));
    expect(opened).toHaveLength(0);
    expect(h.navigations[0]).toMatchObject({ to: "/chat", search: { view: "search", q: "plans" } });
  });

  it("offers See all in Chat while searching, and nothing of Chat without access", async () => {
    await typeInPalette("plans");
    expect(await screen.findByText("See all in Chat")).toBeTruthy();
    cleanup();
    h.workspace.modulePermissions = { tasks: "edit", notes: "edit", contacts: "edit", chat: "none" };
    h.types = [];
    await typeInPalette("plans");
    await waitFor(() => expect(h.types.length).toBeGreaterThan(0), { timeout: 2000 });
    expect(screen.queryByText("See all in Chat")).toBeNull();
  });
});
