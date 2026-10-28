// ⌘K's Recent (GS-8, specs/global-search.md AC7, Q11–Q13): with an empty
// query the palette lists the last things you opened in this workspace, above
// the actions; each can be removed, and "Clear recent" empties the list.
// Opening one goes through the spine's entity-open event like any result.
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

type Row = Record<string, unknown>;

const h = rs.hoisted(() => ({
  recents: [] as Row[],
  recentsFail: false,
  calls: [] as Array<{ fn: string; args: unknown }>,
  runtime: {
    spine: {
      searchAll: async (_call: unknown) => [] as Row[],
      recents: async (_call: unknown) => [] as Row[],
      forgetRecent: async (_call: unknown) => {},
      clearRecents: async (_call: unknown) => {},
    },
    chat: {
      search: async () => ({ data: [], error: null }),
      findConversations: async () => ({ data: [], error: null }),
    },
  },
}));
h.runtime.spine.recents = async (args: unknown) => {
  h.calls.push({ fn: "recents", args });
  if (h.recentsFail) throw new Error("offline");
  return h.recents;
};
h.runtime.spine.forgetRecent = async (args: unknown) => {
  h.calls.push({ fn: "forgetRecent", args });
};
h.runtime.spine.clearRecents = async (args: unknown) => {
  h.calls.push({ fn: "clearRecents", args });
};

rs.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
rs.mock("../../providers/workspace-provider", () => ({
  useWorkspace: () => ({
    selectedWorkspaceId: "w1",
    selectedWorkspace: { id: "w1", taskKey: "MOD" },
    modulePermissions: { notes: "edit", tasks: "edit", calendar: "edit", contacts: "edit", chat: "edit" },
    members: [],
  }),
}));
rs.mock("../../providers/auth-provider", () => ({
  useAuth: () => ({ runtime: h.runtime, userId: "me" }),
}));
rs.mock("../../lib/sync/store", () => ({
  findWorkspaceStore: () => ({
    getSnapshot: () => ({
      bundle: { tasks: [], archivedTasks: [], archivedBuckets: [] },
      attachmentCounts: new Map(),
    }),
  }),
}));

import { dispatchOpenPalette, GlobalCommandPalette } from "./global-command-palette";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});

function recent(type: string, id: string, title: string, minutesAgo = 5): Row {
  return {
    entity_type: type,
    entity_id: id,
    title,
    context: null,
    snippet: null,
    icon: null,
    match: "title",
    rank: 0,
    updated_at: new Date(Date.now() - 86_400_000).toISOString(),
    archived: false,
    last_opened_at: new Date(Date.now() - minutesAgo * 60_000).toISOString(),
  };
}

beforeEach(() => {
  h.recents = [
    recent("note", "n1", "Q4 planning", 2),
    recent("task", "t1", "Fix the login", 30),
    recent("contact", "c1", "Ada Lovelace", 600),
  ];
  h.recentsFail = false;
  h.calls = [];
});
afterEach(cleanup);

const input = () => screen.getByPlaceholderText(/tasks, notes, contacts/);

function openPalette() {
  render(<GlobalCommandPalette />);
  act(() => {
    dispatchOpenPalette();
  });
}

const recentGroup = () => screen.getByRole("group", { name: "Recent" });

describe("⌘K Recent (GS-8)", () => {
  it("lists what you opened, newest first, above the actions, asking for 8 in this workspace", async () => {
    openPalette();
    await waitFor(() => recentGroup());
    const names = within(recentGroup())
      .getAllByRole("option")
      .map((o) => o.textContent ?? "");
    expect(names[0]).toContain("Q4 planning");
    expect(names[1]).toContain("Fix the login");
    expect(names[2]).toContain("Ada Lovelace");
    expect(h.calls.find((c) => c.fn === "recents")?.args).toEqual({ workspaceId: "w1", limit: 8 });
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.findIndex((t) => t.includes("Ada Lovelace"))).toBeLessThan(
      options.findIndex((t) => t.includes("Open Home")),
    );
  });

  it("opens a recent item through the entity-open event", async () => {
    const opened: Array<{ type?: string; id?: string }> = [];
    const onOpen = (e: Event) => opened.push((e as CustomEvent).detail);
    window.addEventListener("moduo:entity:open", onOpen);
    openPalette();
    await waitFor(() => recentGroup());
    fireEvent.click(within(recentGroup()).getAllByRole("option")[1]);
    window.removeEventListener("moduo:entity:open", onOpen);
    expect(opened).toEqual([{ type: "task", id: "t1" }]);
  });

  it("removes one item", async () => {
    openPalette();
    await waitFor(() => recentGroup());
    fireEvent.click(screen.getByRole("button", { name: "Remove Fix the login from Recent" }));
    await waitFor(() =>
      expect(
        within(recentGroup())
          .getAllByRole("option")
          .some((o) => (o.textContent ?? "").includes("Fix the login")),
      ).toBe(false),
    );
    expect(h.calls.find((c) => c.fn === "forgetRecent")?.args).toEqual({
      workspaceId: "w1",
      type: "task",
      id: "t1",
    });
  });

  it("clears the list", async () => {
    openPalette();
    await waitFor(() => recentGroup());
    fireEvent.click(within(recentGroup()).getByRole("option", { name: /Clear recent/ }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Recent" })).toBeNull());
    expect(h.calls.find((c) => c.fn === "clearRecents")?.args).toEqual({ workspaceId: "w1" });
  });

  it("gives way to results once you type, and shows nothing when there are no recents", async () => {
    openPalette();
    await waitFor(() => recentGroup());
    fireEvent.change(input(), { target: { value: "planning" } });
    expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
    cleanup();
    h.recents = [];
    openPalette();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
    expect(screen.getAllByRole("option").some((o) => (o.textContent ?? "").includes("Open Home"))).toBe(
      true,
    );
  });

  it("keeps the actions and stays quiet when Recent can't be read", async () => {
    h.recentsFail = true;
    openPalette();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(screen.queryByRole("group", { name: "Recent" })).toBeNull();
    expect(screen.getAllByRole("option").some((o) => (o.textContent ?? "").includes("Open Home"))).toBe(
      true,
    );
  });
});
