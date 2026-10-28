// ⌘K over search_all (GS-3, specs/global-search.md AC5, AC6, AC9): a Top
// result, fixed groups with "Show all N", type chips that Tab moves between,
// results kept while typing, a progress line only after 300 ms, and one quiet
// line offline that keeps the actions and the task-ID hit. MOD-144: a task's ID
// ("MOD-99", "mod-99", "mod 99") finds it from the workspace's Tasks copy, first
// and before the server answers, and every task row says its ID.
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

type Row = Record<string, unknown>;
type Call = {
  workspaceId: string;
  query: string;
  types: string[];
  limitPerType: number;
  context: { type: string; id: string } | null;
};

const h = rs.hoisted(() => ({
  perms: {
    notes: "edit",
    tasks: "edit",
    calendar: "edit",
    contacts: "edit",
    chat: "edit",
  } as Record<string, string>,
  // What the server answers for a query (by query), or a pending/failed reply.
  answer: (_call: Call): Promise<Row[]> => Promise.resolve([]),
  calls: [] as Call[],
  tasks: [] as Array<Record<string, unknown>>,
  // One runtime object, as the real provider keeps (a new one each render
  // would restart the palette's search effect forever).
  runtime: {
    // Recent (GS-8) is empty here: its own tests are global-command-palette-recent.test.tsx.
    spine: {
      searchAll: async (_call: Call) => [] as Row[],
      recents: async () => [] as Row[],
    },
    // Chat's half of ⌘K (CV-19, until GS-6) answers with nothing here.
    chat: {
      search: async () => ({ data: [], error: null }),
      findConversations: async () => ({ data: [], error: null }),
    },
  },
}));
h.runtime.spine.searchAll = (call: Call) => {
  h.calls.push(call);
  return h.answer(call);
};

rs.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
rs.mock("../../providers/workspace-provider", () => ({
  useWorkspace: () => ({
    selectedWorkspaceId: "w1",
    selectedWorkspace: { id: "w1", taskKey: "MOD" },
    modulePermissions: h.perms,
    members: [],
  }),
}));
rs.mock("../../providers/auth-provider", () => ({
  useAuth: () => ({ runtime: h.runtime, userId: "me" }),
}));
rs.mock("../../lib/sync/store", () => ({
  findWorkspaceStore: () => ({
    getSnapshot: () => ({
      bundle: { tasks: h.tasks, archivedTasks: [], archivedBuckets: [] },
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

beforeEach(() => {
  h.perms = { notes: "edit", tasks: "edit", calendar: "edit", contacts: "edit", chat: "edit" };
  h.answer = () => Promise.resolve([]);
  h.calls = [];
  h.tasks = [
    { id: "t99", number: 99, title: "Fix the login" },
    { id: "t990", number: 990, title: "Write the changelog" },
  ];
  window.history.replaceState(null, "", "/");
});
afterEach(cleanup);

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

const input = () => screen.getByPlaceholderText(/tasks, notes, contacts/);

function openAndType(query: string) {
  render(<GlobalCommandPalette />);
  act(() => {
    dispatchOpenPalette();
  });
  fireEvent.change(input(), { target: { value: query } });
}

function type(query: string) {
  fireEvent.change(input(), { target: { value: query } });
}

const optionNames = () => screen.queryAllByRole("option").map((o) => o.textContent ?? "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("⌘K finds a task by its ID (MOD-144)", () => {
  for (const query of ["MOD-99", "mod-99", "mod 99"]) {
    it(`"${query}" lists that task first, with its ID, before the server answers`, () => {
      h.answer = () => new Promise(() => {});
      openAndType(query);
      const first = screen.getAllByRole("option")[0];
      expect(first.textContent).toContain("Fix the login");
      expect(within(first).getByText("MOD-99")).toBeDefined();
      // Not the task whose ID merely starts the same.
      expect(optionNames().some((n) => n.includes("Write the changelog"))).toBe(false);
    });
  }

  it("leads the server's results and never lists the task twice", async () => {
    h.answer = () =>
      Promise.resolve([
        hit("task", "t99", "Fix the login", { match: "handle", rank: 1, top: true, type_total: 2 }),
        hit("task", "t990", "Write the changelog", { type_total: 2 }),
      ]);
    openAndType("MOD-99");
    await screen.findByText("Write the changelog", undefined, { timeout: 2000 });
    const tasks = optionNames().filter((n) => n.includes("Fix the login"));
    expect(tasks).toHaveLength(1);
    expect(optionNames()[0]).toContain("Fix the login");
  });

  it("names every task result's ID, read from the Tasks copy", async () => {
    h.answer = () => Promise.resolve([hit("task", "t990", "Write the changelog", { top: true })]);
    openAndType("changelog");
    const row = (
      await screen.findByText("Write the changelog", undefined, { timeout: 2000 })
    ).closest('[role="option"]') as HTMLElement;
    expect(within(row).getByText("MOD-990").getAttribute("data-slot")).toBe("palette-task-id");
  });

  it("finds nothing by ID without Tasks access", () => {
    h.perms = { ...h.perms, tasks: "none" };
    h.answer = () => new Promise(() => {});
    openAndType("mod 99");
    expect(optionNames().some((n) => n.includes("Fix the login"))).toBe(false);
  });
});

describe("keeps results while typing; offline line", () => {
  it("asks search_all once per settled query, with the palette's types and 8 per type", async () => {
    openAndType("budget");
    await waitFor(() => expect(h.calls).toHaveLength(1), { timeout: 2000 });
    expect(h.calls[0]).toMatchObject({ workspaceId: "w1", query: "budget", limitPerType: 8 });
    expect(h.calls[0].types).toContain("note");
    expect(h.calls[0].types).not.toContain("chat_message");
  });

  it("never asks for one letter or only excluded words", async () => {
    openAndType("b");
    type("-draft");
    await sleep(400);
    expect(h.calls).toHaveLength(0);
  });

  it("shows the Top result, then groups in the fixed order, 3 rows each with Show all N", async () => {
    h.answer = () =>
      Promise.resolve([
        hit("note", "n1", "Budget plan", { top: true, score: 0.9, type_total: 2 }),
        ...Array.from({ length: 5 }, (_, i) =>
          hit("task", `t${i}`, `Budget task ${i}`, { type_total: 12 }),
        ),
        hit("note", "n2", "Budget notes", {
          type_total: 2,
          match: "body",
          snippet: "the budget for Q4",
          context: "Finance / 2026",
        }),
      ]);
    openAndType("budget");
    await screen.findByText("Show all 12", undefined, { timeout: 2000 });
    const headings = Array.from(document.querySelectorAll("[cmdk-group-heading]")).map(
      (e) => e.textContent,
    );
    expect(headings.slice(0, 3)).toEqual(["Top result", "Tasks", "Notes"]);
    const names = optionNames();
    expect(names[0]).toContain("Budget plan");
    expect(names.filter((n) => n.includes("Budget task"))).toHaveLength(3);
    // The body hit draws its context line and its snippet, the hit marked.
    const body = screen.getByText("Budget notes").closest('[role="option"]') as HTMLElement;
    expect(within(body).getByText("Finance / 2026")).toBeDefined();
    expect(body.querySelector("mark")?.textContent).toBe("budget");
    // The title's matched word-start is marked too, and the age reads short.
    const top = screen.getAllByRole("option")[0];
    expect(top.querySelector("mark")?.textContent).toBe("Budget");
    expect(within(top).getByText("2h")).toBeDefined();
  });

  it("tags an archived result", async () => {
    h.answer = () =>
      Promise.resolve([
        hit("note", "n1", "Quince tart", { top: true }),
        hit("note", "n2", "Quince jam", { archived: true }),
      ]);
    openAndType("quince");
    const row = (await screen.findByText("Quince jam", undefined, { timeout: 2000 })).closest(
      '[role="option"]',
    ) as HTMLElement;
    expect(within(row).getByText("Archived")).toBeDefined();
  });

  it("keeps the previous results on screen while the next query is on its way", async () => {
    h.answer = () => Promise.resolve([hit("note", "n1", "Q4 planning", { top: true })]);
    openAndType("plan");
    await screen.findByText("Q4 planning", undefined, { timeout: 2000 });
    h.answer = () => new Promise(() => {});
    type("plann");
    await sleep(250);
    expect(optionNames().some((n) => n.includes("Q4 planning"))).toBe(true);
    expect(screen.queryByText("Searching…")).toBeNull();
  });

  it("shows a progress line only once a reply takes longer than 300 ms", async () => {
    h.answer = () => new Promise(() => {});
    openAndType("slow words");
    await sleep(300);
    expect(document.querySelector('[data-slot="palette-progress"]')).toBeNull();
    await waitFor(
      () => expect(document.querySelector('[data-slot="palette-progress"]')).not.toBeNull(),
      { timeout: 2000 },
    );
  });

  it("drops a reply that arrives after a newer query (the last request wins)", async () => {
    let releaseOld: (rows: Row[]) => void = () => {};
    h.answer = (call) =>
      call.query === "old"
        ? new Promise((resolve) => {
            releaseOld = resolve;
          })
        : Promise.resolve([hit("note", "n2", "New answer", { top: true })]);
    openAndType("old");
    await waitFor(() => expect(h.calls).toHaveLength(1), { timeout: 2000 });
    type("new");
    await screen.findByText("New answer", undefined, { timeout: 2000 });
    await act(async () => {
      releaseOld([hit("note", "n1", "Old answer", { top: true })]);
    });
    expect(screen.queryByText("Old answer")).toBeNull();
  });

  it("offline: one quiet line, the actions and the task-ID hit stay, no 'No results'", async () => {
    h.answer = () => Promise.reject(new TypeError("Failed to fetch"));
    openAndType("mod 99");
    await screen.findByText("Search needs a connection; showing what's on this device", undefined, {
      timeout: 2000,
    });
    expect(optionNames()[0]).toContain("Fix the login");
    expect(screen.queryByText(/No matches/)).toBeNull();
    type("open notes");
    await screen.findByText("Search needs a connection; showing what's on this device", undefined, {
      timeout: 2000,
    });
    expect(optionNames().some((n) => n.includes("Open Notes"))).toBe(true);
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
  });

  it("a server that gives up after 5 s says so", async () => {
    h.answer = () => Promise.reject(Object.assign(new Error("timeout"), { code: "57014" }));
    openAndType("many many words");
    await screen.findByText("Search took too long, try fewer words", undefined, { timeout: 2000 });
  });

  it("no results: says so, with Search everything when a chip narrows", async () => {
    openAndType("zzzz");
    await screen.findByText("No matches for 'zzzz'", undefined, { timeout: 2000 });
    expect(optionNames().some((n) => n.includes("Search everything"))).toBe(false);
    fireEvent.keyDown(input(), { key: "Tab" });
    await waitFor(() => expect(h.calls.at(-1)?.types).toEqual(["task", "bucket", "project"]), {
      timeout: 2000,
    });
    await screen.findByText("Search everything", undefined, { timeout: 2000 });
  });

  it("passes the item open now as the ranking's context", async () => {
    window.history.replaceState(null, "", "/notes?id=n-open");
    openAndType("budget");
    await waitFor(() => expect(h.calls).toHaveLength(1), { timeout: 2000 });
    expect(h.calls[0].context).toEqual({ type: "note", id: "n-open" });
  });
});

describe("type chips", () => {
  const chip = (name: string) => screen.getByRole("radio", { name });

  it("Tab and Shift+Tab move between the chips, and a chip narrows the search to 50 of its types", async () => {
    openAndType("budget");
    expect(chip("All").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(chip("Tasks").getAttribute("aria-checked")).toBe("true");
    await waitFor(
      () =>
        expect(h.calls.at(-1)).toMatchObject({
          types: ["task", "bucket", "project"],
          limitPerType: 50,
        }),
      { timeout: 2000 },
    );
    fireEvent.keyDown(input(), { key: "Tab" });
    expect(chip("Notes").getAttribute("aria-checked")).toBe("true");
    fireEvent.keyDown(input(), { key: "Tab", shiftKey: true });
    fireEvent.keyDown(input(), { key: "Tab", shiftKey: true });
    expect(chip("All").getAttribute("aria-checked")).toBe("true");
    // Focus never leaves the input.
    expect(document.activeElement).toBe(input());
  });

  it("a chip for a module you can't reach never shows", () => {
    h.perms = { ...h.perms, notes: "none", chat: "none" };
    openAndType("budget");
    expect(screen.queryByRole("radio", { name: "Notes" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Chat" })).toBeNull();
    expect(chip("Tasks")).toBeDefined();
  });

  it("Show all N selects that group's chip", async () => {
    h.answer = () =>
      Promise.resolve([
        hit("note", "n1", "Budget plan", { top: true }),
        ...Array.from({ length: 4 }, (_, i) =>
          hit("task", `t${i}`, `Budget task ${i}`, { type_total: 4 }),
        ),
      ]);
    openAndType("budget");
    fireEvent.click(await screen.findByText("Show all 4", undefined, { timeout: 2000 }));
    expect(chip("Tasks").getAttribute("aria-checked")).toBe("true");
  });

  it("matching actions appear below the results", async () => {
    h.answer = () => Promise.resolve([hit("note", "n1", "Settings for the garden", { top: true })]);
    openAndType("settings");
    await screen.findByText("Settings for the garden", undefined, { timeout: 2000 });
    const names = optionNames();
    const result = names.findIndex((n) => n.includes("Settings for the garden"));
    const action = names.findIndex((n) => n.trim().startsWith("Settings") && !n.includes("garden"));
    expect(action).toBeGreaterThan(result);
  });
});
