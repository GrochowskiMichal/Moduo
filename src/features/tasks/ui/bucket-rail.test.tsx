// TV-U6 — the Tasks sidebar (specs/tasks-v3.md §3, AC11.1, AC11.10; REPLAN
// 14–16, 20, 29a–e, 30, 98): the decided order and the hairline, no labels on
// the blocks, Pinned only once something is pinned, Customize sidebar, areas
// as collapsible sentence-case headers with their projects, the project menu
// (colour, area, pin, archive, delete; no "Open at"), "project" everywhere,
// Archived projects and Recently deleted in the ⋯ (never rows), drift marks,
// and sortable rows inside the page's DndContext.

import { DndContext } from "@dnd-kit/core";
import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import type { TasksSidebarHideable } from "../../../lib/preferences";
import type { Area, Bucket } from "../model";
import {
  ARCHIVED_SELECTION,
  asRailProject,
  BucketRail,
  parseCollapsedSections,
  TRASH_SELECTION,
  UPCOMING_SELECTION,
} from "./bucket-rail";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});
afterEach(cleanup);

const NOW = "2026-10-01T00:00:00.000Z";
function bucket(id: string, name: string, extra: Partial<Bucket> = {}): Bucket {
  return {
    id,
    workspaceId: "w",
    ownerId: "u",
    name,
    isSystem: false,
    group: null,
    position: id,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    ...extra,
  };
}
function area(id: string, name: string, position: number): Area {
  return {
    id,
    workspaceId: "w",
    name,
    color: null,
    position,
    shared: true,
    createdBy: "u",
    createdAt: NOW,
    updatedAt: NOW,
  };
}

const INBOX = bucket("inbox-id", "Inbox", { isSystem: true });
const AREAS = [area("product", "Product", 1), area("clients", "Clients", 2)];
const PROJECTS = [
  bucket("a-launch", "Launch v1", { color: "blue" }),
  bucket("b-site", "Website", { areaId: "product" }),
  bucket("c-acme", "Acme rebrand", { areaId: "clients", color: "violet" }),
  bucket("d-north", "Northwind", { areaId: "clients" }),
];

// Long enough for a menu to unmount and Radix's focus return.
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 80)));
const main = (name: RegExp) => screen.getByRole("button", { name });

function renderRail({
  canEdit = true,
  selection: initialSelection = "a-launch",
  drift = new Map<string, number>(),
  collapsed: initialCollapsed = new Set<string>(),
  myTasks = 3 as number | null,
  hidden: initialHidden = new Set<TasksSidebarHideable>(),
  pinned: initialPinned = [] as string[],
  dnd = false,
}: {
  canEdit?: boolean;
  selection?: string;
  drift?: Map<string, number>;
  collapsed?: Set<string>;
  myTasks?: number | null;
  hidden?: Set<TasksSidebarHideable>;
  pinned?: string[];
  /** Inside a DndContext, with sortable rows and drop targets. */
  dnd?: boolean;
} = {}) {
  const calls = {
    onSelect: rs.fn(),
    onRequestDelete: rs.fn(),
    onRequestArchive: rs.fn(),
    onSetBucketColor: rs.fn(),
    onMoveBucketToArea: rs.fn(),
    onToggleCollapsed: rs.fn(),
    onToggleHidden: rs.fn(),
    onTogglePin: rs.fn(),
    onRenameArea: rs.fn(),
    onDeleteArea: rs.fn(),
    onMoveArea: rs.fn(),
    onCreateBucket: rs.fn(),
    onCreateArea: rs.fn(async () => "new-area"),
    onTriageBucket: rs.fn(),
  };
  function Harness() {
    const [selection, setSelection] = useState(initialSelection);
    const [collapsed, setCollapsed] = useState(initialCollapsed);
    const [hidden, setHidden] = useState(initialHidden);
    const [pinned, setPinned] = useState(initialPinned);
    const rail = (
      <BucketRail
        mode="plan"
        onModeChange={() => {}}
        selection={selection}
        onSelect={(next) => {
          calls.onSelect(next);
          setSelection(next);
        }}
        buckets={PROJECTS}
        areas={AREAS}
        inbox={INBOX}
        openCountByBucket={
          new Map([
            ["a-launch", 6],
            ["b-site", 4],
            ["c-acme", 2],
            ["d-north", 3],
            ["inbox-id", 2],
          ])
        }
        driftCountByBucket={drift}
        totalOpenCount={15}
        queueCount={4}
        myTasksCount={myTasks}
        canEdit={canEdit}
        hidden={hidden}
        onToggleHidden={(row) => {
          calls.onToggleHidden(row);
          setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(row)) next.delete(row);
            else next.add(row);
            return next;
          });
        }}
        pinned={pinned}
        onTogglePin={(id) => {
          calls.onTogglePin(id);
          setPinned((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
        }}
        collapsed={collapsed}
        onToggleCollapsed={(key) => {
          calls.onToggleCollapsed(key);
          setCollapsed((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        }}
        onCreateBucket={calls.onCreateBucket}
        onRenameBucket={() => {}}
        onRequestDelete={calls.onRequestDelete}
        onRequestArchive={calls.onRequestArchive}
        onSetBucketColor={calls.onSetBucketColor}
        onMoveBucket={() => {}}
        onMoveBucketToArea={calls.onMoveBucketToArea}
        onTriageBucket={calls.onTriageBucket}
        onCreateArea={calls.onCreateArea}
        onRenameArea={calls.onRenameArea}
        onSetAreaColor={() => {}}
        onMoveArea={calls.onMoveArea}
        onDeleteArea={calls.onDeleteArea}
        archivedCount={2}
        trashCount={5}
        dropAccepts={dnd ? () => false : undefined}
      />
    );
    return <TooltipProvider>{dnd ? <DndContext>{rail}</DndContext> : rail}</TooltipProvider>;
  }
  render(<Harness />);
  return calls;
}

/** The sidebar's rows and headers, top to bottom, as their visible names. */
function order(): string[] {
  const nav = screen.getByRole("navigation", { name: "Tasks" });
  return Array.from(
    nav.querySelectorAll<HTMLElement>(
      '[data-slot="nav-row-label"], [data-slot="nav-section-header"] [data-slot="nav-row-main"] > span:first-child, [data-slot="sidebar-hairline"]',
    ),
  ).map((el) => (el.dataset.slot === "sidebar-hairline" ? "—" : (el.textContent ?? "")));
}

async function rowMenu(name: RegExp) {
  fireEvent.contextMenu(main(name).closest('[data-slot="nav-row"]') as Element);
  await settle();
}

async function openSidebarMenu() {
  const button = screen.getByRole("button", { name: "Sidebar options" });
  fireEvent.pointerDown(button, { button: 0, pointerType: "mouse" });
  await settle();
}

describe("the decided sidebar (AC11.1)", () => {
  it("Inbox · Focus · Upcoming · My tasks, the hairline, then All and the projects by area", () => {
    renderRail();
    expect(order()).toEqual([
      "Inbox",
      "Focus",
      "Upcoming",
      "My tasks",
      "—",
      "All",
      "Launch v1",
      "Product",
      "Website",
      "Clients",
      "Acme rebrand",
      "Northwind",
    ]);
  });

  it("has no labels on the blocks and no Pinned or Views header until there's something", () => {
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Tasks" });
    for (const word of ["You", "Workspace", "Pinned", "Views", "Projects", "Buckets"]) {
      expect(within(nav).queryByText(word)).toBeNull();
    }
  });

  it("never says bucket, and Focus is the sidebar's name for the Queue", () => {
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Tasks" });
    expect(nav.textContent ?? "").not.toMatch(/bucket/i);
    expect(within(nav).queryByText("Queue")).toBeNull();
    expect(main(/^Focus, 4 queued$/)).toBeTruthy();
    expect(main(/^New project$/)).toBeTruthy();
  });

  it("shows a colour dot on projects, and no glyph on a view or project", () => {
    renderRail();
    const dot = (name: RegExp) =>
      main(name).querySelector('[data-slot="nav-row-dot"]')?.getAttribute("data-label");
    expect(dot(/^Launch v1,/)).toBe("blue");
    expect(dot(/^Northwind,/)).toBe("gray");
    expect(main(/^Launch v1,/).querySelector("svg")).toBeNull();
  });

  it("area headers are sentence case as typed, with their open count, and collapse", async () => {
    const calls = renderRail();
    const header = screen.getByRole("button", { name: /^Clients, 5 open$/ });
    expect(header.closest('[data-slot="nav-section-header"]')?.className ?? "").not.toMatch(
      /uppercase/,
    );
    fireEvent.click(header);
    expect(calls.onToggleCollapsed).toHaveBeenCalledWith("area:clients");
    await settle();
    expect(screen.queryByRole("button", { name: /^Acme rebrand,/ })).toBeNull();
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("selects Upcoming as its own scope", () => {
    const calls = renderRail();
    fireEvent.click(main(/^Upcoming$/));
    expect(calls.onSelect).toHaveBeenCalledWith(UPCOMING_SELECTION);
    expect(main(/^Upcoming$/).getAttribute("aria-current")).toBe("page");
  });

  it("hides My tasks with fewer than two members", () => {
    renderRail({ myTasks: null });
    expect(screen.queryByRole("button", { name: /^My tasks/ })).toBeNull();
  });
});

describe("Customize sidebar, Archived projects and Recently deleted in the ⋯ (AC11.1, AC11.10)", () => {
  it("hides Focus, Upcoming, My tasks and All; the Inbox always shows", async () => {
    const calls = renderRail({ hidden: new Set(["focus", "all"]) });
    expect(screen.queryByRole("button", { name: /^Focus/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^All,/ })).toBeNull();
    expect(main(/^Inbox,/)).toBeTruthy();
    await openSidebarMenu();
    const menu = screen.getByRole("menu");
    const items = within(menu)
      .getAllByRole("menuitemcheckbox")
      .map((el) => el.textContent);
    expect(items).toEqual(["Focus", "Upcoming", "My tasks", "All"]);
    fireEvent.click(within(menu).getByRole("menuitemcheckbox", { name: "Focus" }));
    await settle();
    expect(calls.onToggleHidden).toHaveBeenCalledWith("focus");
    // The menu stays open while ticking several; Esc closes it.
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    await settle();
    expect(main(/^Focus, 4 queued$/)).toBeTruthy();
  });

  it("opens Archived projects and Recently deleted from the ⋯, never as rows", async () => {
    const calls = renderRail();
    const nav = screen.getByRole("navigation", { name: "Tasks" });
    expect(within(nav).queryByRole("button", { name: /Archived|Recently deleted/ })).toBeNull();
    await openSidebarMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Archived projects/ }));
    await settle();
    expect(calls.onSelect).toHaveBeenCalledWith(ARCHIVED_SELECTION);
    await openSidebarMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /^Recently deleted/ }));
    await settle();
    expect(calls.onSelect).toHaveBeenCalledWith(TRASH_SELECTION);
  });
});

describe("Pin (REPLAN 29b)", () => {
  it("Pinned appears once you pin a project, at the top of the shared block", async () => {
    const calls = renderRail();
    await rowMenu(/^Acme rebrand,/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Pin to sidebar" }));
    await settle();
    expect(calls.onTogglePin).toHaveBeenCalledWith("c-acme");
    expect(order().slice(5, 8)).toEqual(["All", "Pinned", "Acme rebrand"]);
    // Still in its area too.
    expect(screen.getAllByRole("button", { name: /^Acme rebrand,/ })).toHaveLength(2);
  });

  it("Unpin removes it, and Pinned goes with the last one", async () => {
    renderRail({ pinned: ["c-acme"] });
    expect(screen.getByText("Pinned")).toBeTruthy();
    await rowMenu(/^Northwind,/);
    expect(screen.getByRole("menuitem", { name: "Pin to sidebar" })).toBeTruthy();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await settle();
    const [pinnedRow] = screen.getAllByRole("button", { name: /^Acme rebrand,/ });
    fireEvent.contextMenu(pinnedRow!.closest('[data-slot="nav-row"]') as Element);
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Unpin from sidebar" }));
    await settle();
    expect(screen.queryByText("Pinned")).toBeNull();
  });
});

describe("the project menu (REPLAN 13–16, 30, 78)", () => {
  it("offers colour, area, pin, share, statuses, archive and delete; no Open at", async () => {
    renderRail();
    await rowMenu(/^Website,/);
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items).toEqual([
      "Rename",
      "Colour",
      "Area",
      "Pin to sidebar",
      "Share",
      "Archive…",
      "Delete project…",
    ]);
    expect(screen.queryByText(/Open at/)).toBeNull();
  });

  it("Archive… and Delete project… ask the page first", async () => {
    const calls = renderRail();
    await rowMenu(/^Website,/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive…" }));
    await settle();
    expect(calls.onRequestArchive).toHaveBeenCalledWith(expect.objectContaining({ id: "b-site" }));
    await rowMenu(/^Website,/);
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete project…" }));
    await settle();
    expect(calls.onRequestDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "b-site" }));
  });

  it("moves a project between areas", async () => {
    const calls = renderRail();
    await rowMenu(/^Website,/);
    const trigger = screen.getByRole("menuitem", { name: "Area" });
    fireEvent.pointerMove(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    await settle();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Clients" }));
    await settle();
    expect(calls.onMoveBucketToArea).toHaveBeenCalledWith("b-site", "clients");
  });

  it("colours a project", async () => {
    const calls = renderRail();
    await rowMenu(/^Website,/);
    const trigger = screen.getByRole("menuitem", { name: "Colour" });
    fireEvent.pointerMove(trigger);
    fireEvent.keyDown(trigger, { key: "ArrowRight" });
    await settle();
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Teal" }));
    await settle();
    expect(calls.onSetBucketColor).toHaveBeenCalledWith("b-site", "teal");
  });

  it("someone who can't edit only gets Pin", async () => {
    renderRail({ canEdit: false });
    await rowMenu(/^Website,/);
    expect(screen.getAllByRole("menuitem").map((el) => el.textContent)).toEqual(["Pin to sidebar"]);
    expect(screen.queryByRole("button", { name: "New project" })).toBeNull();
  });
});

describe("areas: create, rename, reorder, delete (TV-D10's ops)", () => {
  it("renames an area inline", async () => {
    const calls = renderRail();
    fireEvent.contextMenu(
      screen
        .getByRole("button", { name: /^Clients,/ })
        .closest('[data-slot="nav-section-header"]') as Element,
    );
    await settle();
    expect(screen.getByRole("menuitem", { name: "Move down" }).getAttribute("aria-disabled")).toBe(
      "true",
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    await settle();
    const input = screen.getByPlaceholderText("Area name — Enter");
    fireEvent.change(input, { target: { value: "Customers" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls.onRenameArea).toHaveBeenCalledWith("clients", "Customers");
  });

  it("moves an area up and deletes one", async () => {
    const calls = renderRail();
    const header = () =>
      screen
        .getByRole("button", { name: /^Clients,/ })
        .closest('[data-slot="nav-section-header"]') as Element;
    fireEvent.contextMenu(header());
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Move up" }));
    await settle();
    expect(calls.onMoveArea).toHaveBeenCalledWith("clients", "up");
    fireEvent.contextMenu(header());
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete area" }));
    await settle();
    expect(calls.onDeleteArea).toHaveBeenCalledWith("clients");
  });

  it("makes a new area from the sidebar's ⋯", async () => {
    const calls = renderRail();
    await openSidebarMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "New area…" }));
    await settle();
    const input = screen.getByPlaceholderText("Area name — Enter");
    fireEvent.change(input, { target: { value: "School" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls.onCreateArea).toHaveBeenCalledWith("School");
  });

  it("an area's + adds a project in it", async () => {
    const calls = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "New project in Product" }));
    await settle();
    const input = screen.getByPlaceholderText("Project name — Enter to add");
    fireEvent.change(input, { target: { value: "Docs" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(calls.onCreateBucket).toHaveBeenCalledWith("Docs", "product");
  });
});

describe("drift and drag", () => {
  it("shows drift as a mark that opens triage, and on a collapsed area", () => {
    const calls = renderRail({
      drift: new Map([["c-acme", 2]]),
      collapsed: new Set(["area:clients"]),
    });
    expect(screen.getByRole("img", { name: /2 drifted in Clients/ })).toBeTruthy();
    cleanup();
    const again = renderRail({ drift: new Map([["c-acme", 2]]) });
    fireEvent.click(screen.getByRole("button", { name: "2 drifted · triage" }));
    expect(again.onTriageBucket).toHaveBeenCalledWith("c-acme");
    expect(calls.onTriageBucket).not.toHaveBeenCalled();
  });

  it("renders sortable project rows inside the page's DndContext", () => {
    renderRail({ dnd: true });
    expect(main(/^Website,/)).toBeTruthy();
    expect(asRailProject({ type: "rail-project", projectId: "b-site" })).toBe("b-site");
    expect(asRailProject({ type: "task", taskId: "t" })).toBeNull();
  });

  it("reads remembered collapsed groups, and anything unreadable as none", () => {
    expect([...parseCollapsedSections(JSON.stringify(["area:clients"]))]).toEqual(["area:clients"]);
    expect(parseCollapsedSections("{").size).toBe(0);
  });
});
