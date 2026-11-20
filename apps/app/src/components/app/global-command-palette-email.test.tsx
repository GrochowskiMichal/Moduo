// MR-13 (AC32): with the rebuilt engine on, `/` opens ⌘K on the Email chip,
// operator queries run through the engine, results open the thread, a search
// saves to the rail, and "Search older mail on <account>" escalates.
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { createFakeMailEngine } from "../../features/email/testing/fake-engine";

const h = rs.hoisted(() => ({
  runtime: {
    spine: { searchAll: async () => [], recents: async () => [] },
    chat: { message: async () => ({ data: null, error: null }) },
    email: {
      engine: null as unknown,
      listModule: async () => ({ refs: [] }),
      listSettings: async () => [],
      upsertSetting: async (input: Record<string, unknown>) => ({ ...input }),
      searchServer: async (_input: Record<string, unknown>) => ({ status: "ok", envelopes: [] }),
      upserts: [] as Array<Record<string, unknown>>,
      servers: [] as Array<Record<string, unknown>>,
    },
  },
}));

rs.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
rs.mock("../../providers/workspace-provider", () => ({
  useWorkspace: () => ({
    selectedWorkspaceId: "w1",
    selectedWorkspace: { id: "w1", taskKey: "MOD" },
    modulePermissions: {
      notes: "edit",
      tasks: "edit",
      calendar: "edit",
      contacts: "edit",
      chat: "edit",
    },
    members: [],
  }),
}));
rs.mock("../../providers/auth-provider", () => ({
  useAuth: () => ({ runtime: h.runtime, userId: "me" }),
}));
rs.mock("../../lib/sync/store", () => ({ findWorkspaceStore: () => null }));

import { openMailSearch } from "../../features/email/search/open";
import { ENTITY_OPEN_EVENT } from "../../lib/entity-open";
import { GlobalCommandPalette } from "./global-command-palette";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  window.localStorage.setItem("moduo:mail:engine", "1");
  h.runtime.email.engine = createFakeMailEngine();
  h.runtime.email.upserts = [];
  h.runtime.email.servers = [];
  h.runtime.email.upsertSetting = async (input) => {
    h.runtime.email.upserts.push(input);
    return input;
  };
  h.runtime.email.searchServer = async (input: Record<string, unknown>) => {
    h.runtime.email.servers.push(input);
    return { status: "ok", envelopes: [] };
  };
});
afterEach(() => {
  cleanup();
  window.localStorage.removeItem("moduo:mail:engine");
});

async function openOnEmail(query: string) {
  render(<GlobalCommandPalette />);
  act(() => {
    openMailSearch(query);
  });
  return screen.findByPlaceholderText(/search/i);
}

describe("⌘K Email over the engine (AC32)", () => {
  it("opens on the Email chip with the query, and is:unread lists engine threads", async () => {
    const input = (await openOnEmail("is:unread")) as HTMLInputElement;
    expect(input.value).toBe("is:unread");
    const email = screen.getAllByRole("radio").find((el) => /email/i.test(el.textContent ?? ""));
    expect(email?.getAttribute("aria-checked") ?? email?.getAttribute("data-state")).toMatch(
      /true|on|checked/,
    );
    const options = await waitFor(
      () => {
        const rows = screen
          .getAllByRole("option")
          .filter((o) => !/Search older|Save this/.test(o.textContent ?? ""));
        expect(rows.length).toBeGreaterThan(0);
        return rows;
      },
      { timeout: 2000 },
    );
    const opened: unknown[] = [];
    const onOpen = (e: Event) => opened.push((e as CustomEvent).detail);
    window.addEventListener(ENTITY_OPEN_EVENT, onOpen);
    fireEvent.click(options[0]!);
    window.removeEventListener(ENTITY_OPEN_EVENT, onOpen);
    expect((opened[0] as { type: string }).type).toBe("email_thread");
  });

  it("suggests operator values, saves the search and escalates to the server", async () => {
    await openOnEmail("is:");
    await screen.findByRole("option", { name: /is:unread/ });
    cleanup();
    await openOnEmail("invoice");
    fireEvent.click(await screen.findByRole("option", { name: /Save this search to Mail/ }));
    await waitFor(() => expect(h.runtime.email.upserts.length).toBe(1));
    expect(h.runtime.email.upserts[0]).toMatchObject({
      kind: "saved_search",
      value: { query: "invoice" },
    });
    const older = await screen.findAllByRole("option", { name: /Search older mail on/ });
    fireEvent.click(older[0]!);
    await waitFor(() => expect(h.runtime.email.servers.length).toBe(1));
    expect(h.runtime.email.servers[0]).toMatchObject({ query: "invoice" });
  });
});
