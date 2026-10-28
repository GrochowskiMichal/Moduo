// CV-19 · ⌘K's Chat half: a failed conversation search says "Search isn't
// available", never "No results."; a direct message is named by its people, a
// note-to-self by your name (or "You"), as the sidebar names them.
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { ChatConversationFound } from "../../features/chat/model";

// Stable objects, as the real providers give: a new runtime each render would
// re-run every search effect.
const h = rs.hoisted(() => {
  const h = {
    messages: { data: [] as unknown[], error: null as unknown },
    conversations: { data: [] as unknown[], error: null as unknown },
    auth: null as unknown,
    workspace: {
      selectedWorkspaceId: "w1",
      modulePermissions: { chat: "edit", tasks: "edit", notes: "edit", contacts: "edit" },
      members: [
        { userId: "me", displayName: "Maja Nowak" },
        { userId: "u2", displayName: "Bożena Wróbel" },
        { userId: "u3", displayName: "Cezary Kot" },
      ],
    },
  };
  h.auth = {
    userId: "me",
    runtime: {
      chat: {
        search: async () => h.messages,
        findConversations: async () => h.conversations,
      },
      spine: { searchAll: async () => [] },
    },
  };
  return h;
});

rs.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
rs.mock("../../providers/auth-provider", () => ({ useAuth: () => h.auth }));
rs.mock("../../providers/workspace-provider", () => ({ useWorkspace: () => h.workspace }));

import {
  dispatchOpenPalette,
  foundConversationName,
  GlobalCommandPalette,
} from "./global-command-palette";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  h.messages = { data: [], error: null };
  h.conversations = { data: [], error: null };
});
afterEach(cleanup);

async function typeInPalette(words: string) {
  render(<GlobalCommandPalette />);
  act(() => dispatchOpenPalette());
  const input = await screen.findByPlaceholderText(/Search messages/);
  fireEvent.change(input, { target: { value: words } });
}

const dm = (people: string[]): ChatConversationFound => ({
  channelId: `dm-${people.join("-") || "self"}`,
  kind: "dm",
  name: null,
  people,
  archived: false,
});

describe("⌘K's Chat half (CV-19)", () => {
  it("a failed conversation search says Search isn't available, never No results.", async () => {
    h.conversations = { data: [], error: { message: "timeout" } };
    await typeInPalette("qqzzx");
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe("Search isn't available"),
    );
    expect(screen.queryByText("No results.")).toBeNull();
  });

  it("with both halves answering and nothing found, nothing says it failed", async () => {
    await typeInPalette("qqzzx");
    await waitFor(() => expect(screen.getByText("See all in Chat")).toBeTruthy());
    await act(async () => new Promise((r) => setTimeout(r, 250)));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names a direct message by its people and a note-to-self by your name", async () => {
    h.conversations = { data: [dm(["u2", "u3"]), dm([])], error: null };
    await typeInPalette("nowak");
    await waitFor(() => expect(screen.getByText("Bożena Wróbel, Cezary Kot")).toBeTruthy());
    expect(screen.getByText("Maja Nowak")).toBeTruthy();
  });
});

describe("foundConversationName (CV-19)", () => {
  const nameOf = (id: string) => ({ me: "Maja", u2: "Bożena" })[id];
  it("follows the sidebar: people, someone gone, a note-to-self", () => {
    expect(foundConversationName(dm(["u2"]), "me", nameOf)).toBe("Bożena");
    expect(foundConversationName(dm(["u2", "gone"]), "me", nameOf)).toBe("Bożena, Former member");
    expect(foundConversationName(dm([]), "me", nameOf)).toBe("Maja");
    expect(foundConversationName(dm([]), "stranger", nameOf)).toBe("You");
    expect(
      foundConversationName(
        { channelId: "c", kind: "channel", name: "plans", people: [], archived: false },
        "me",
        nameOf,
      ),
    ).toBe("plans");
  });
});
