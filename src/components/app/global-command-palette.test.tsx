// MOD-144 — the ⌘K palette finds a task by its ID ("MOD-99", "mod-99",
// "mod 99") from the workspace's Tasks copy, first and before the registry
// answers, and every task result says its ID.
import { afterEach, beforeAll, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const h = rs.hoisted(() => ({
  perms: {
    notes: "edit",
    tasks: "edit",
    calendar: "edit",
    contacts: "edit",
    chat: "edit",
  } as Record<string, string>,
  search: [] as Array<Record<string, unknown>>,
  tasks: [] as Array<Record<string, unknown>>,
  // One runtime object, as the real provider keeps (a new one each render
  // would restart the palette's search effect forever).
  runtime: { spine: { searchEntities: async () => [] as unknown[] } },
}));
h.runtime.spine.searchEntities = async () => h.search;

rs.mock("@tanstack/react-router", () => ({ useNavigate: () => () => {} }));
rs.mock("../../providers/workspace-provider", () => ({
  useWorkspace: () => ({
    selectedWorkspaceId: "w1",
    selectedWorkspace: { id: "w1", taskKey: "MOD" },
    modulePermissions: h.perms,
  }),
}));
rs.mock("../../providers/auth-provider", () => ({
  useAuth: () => ({ runtime: h.runtime }),
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
  h.search = [];
  h.tasks = [
    { id: "t99", number: 99, title: "Fix the login" },
    { id: "t990", number: 990, title: "Write the changelog" },
  ];
});
afterEach(cleanup);

function record(id: string, label: string) {
  return { workspaceId: "w1", type: "task", id, label, icon: null, deletedAt: null };
}

function openAndType(query: string) {
  render(<GlobalCommandPalette />);
  act(() => dispatchOpenPalette());
  const input = screen.getByPlaceholderText(/Search tasks, notes, contacts/);
  fireEvent.change(input, { target: { value: query } });
}

const optionNames = () => screen.queryAllByRole("option").map((o) => o.textContent ?? "");

describe("⌘K finds a task by its ID (MOD-144)", () => {
  for (const query of ["MOD-99", "mod-99", "mod 99"]) {
    it(`"${query}" lists that task first, with its ID, before the registry answers`, () => {
      openAndType(query);
      const first = screen
        .getAllByRole("option")
        .find((o) => o.textContent?.includes("Fix the login"));
      expect(first).toBeDefined();
      expect(within(first as HTMLElement).getByText("MOD-99")).toBeDefined();
      // Not the task whose ID merely starts the same.
      expect(optionNames().some((n) => n.includes("Write the changelog"))).toBe(false);
    });
  }

  it("leads the registry's results and never lists the task twice", async () => {
    h.search = [record("t990", "Write the changelog"), record("t99", "Fix the login")];
    openAndType("MOD-99");
    await screen.findByText("Write the changelog", undefined, { timeout: 2000 });
    const tasks = optionNames().filter((n) => n.includes("Task"));
    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toContain("Fix the login");
    expect(tasks[1]).toContain("MOD-990");
  });

  it("names every task result's ID, read from the Tasks copy", async () => {
    h.search = [record("t990", "Write the changelog")];
    openAndType("changelog");
    const row = (
      await screen.findByText("Write the changelog", undefined, { timeout: 2000 })
    ).closest('[role="option"]') as HTMLElement;
    expect(within(row).getByText("MOD-990").getAttribute("data-slot")).toBe("palette-task-id");
  });

  it("finds nothing by ID without Tasks access", () => {
    h.perms = { ...h.perms, tasks: "none" };
    openAndType("mod 99");
    expect(optionNames().some((n) => n.includes("Fix the login"))).toBe(false);
  });
});
