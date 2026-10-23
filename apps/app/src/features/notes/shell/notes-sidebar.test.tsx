// NR-2 · AC2/AC4 — the rendered New Notes sidebar is a real tree: it exposes
// tree / treeitem / aria-expanded / aria-level, walks by keyboard, shows the
// stored sections, and hides create for view-only members. Drag is resolved
// by raw pointer at release, which jsdom can't do; drop-intent.test.ts covers
// the decisions and the live check covers the gesture.

import { DndContext } from "@dnd-kit/core";
import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { Note, NoteFavorite } from "../model";
import { buildSidebarSections } from "../sections";
import { NotesSidebar, type NotesSidebarProps } from "./notes-sidebar";

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
afterEach(() => {
  cleanup();
  localStorage.clear();
});

function note(partial: Partial<Note> & { id: string; position: string }): Note {
  return {
    workspaceId: "ws1",
    createdBy: "u1",
    parentId: null,
    title: partial.id,
    icon: null,
    isPinned: false,
    isArchived: false,
    publishedAt: null,
    publishToken: null,
    docVersion: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-13T00:00:00.000Z",
    deletedAt: null,
    shareMode: "custom",
    workspaceShared: false,
    inInbox: false,
    fullWidth: false,
    ...partial,
  };
}

const notes: Note[] = [
  note({ id: "Idea", position: "0000001000", inInbox: true }),
  note({ id: "Clients", position: "0000002000" }),
  note({ id: "Acme", position: "0000001000", parentId: "Clients" }),
  note({ id: "Roadmap", position: "0000003000" }),
  note({ id: "Old", position: "0000004000", deletedAt: "2026-10-12T00:00:00.000Z" }),
];
const favorites: NoteFavorite[] = [
  { noteId: "Roadmap", position: "0000001000", createdAt: "2026-10-01T00:00:00.000Z" },
];

function renderSidebar(overrides: Partial<NotesSidebarProps> = {}) {
  const props: NotesSidebarProps = {
    workspaceId: "ws1",
    notes,
    sections: buildSidebarSections({ notes, favorites }),
    favoritePositions: new Map(favorites.map((f) => [f.noteId, f.position])),
    selectedId: null,
    draftId: null,
    canEdit: true,
    loading: false,
    footerView: null,
    onFooterViewChange: rs.fn(),
    onOpen: rs.fn(),
    onNewCapture: rs.fn(),
    onNewPage: rs.fn(),
    onCreateChild: rs.fn(),
    onUnfavorite: rs.fn(),
    onAction: rs.fn(),
    onDropIntent: rs.fn(),
    onUnarchive: rs.fn(),
    onTrash: rs.fn(),
    onRestore: rs.fn(),
    onPurge: rs.fn(),
    ...overrides,
  };
  render(
    <TooltipProvider>
      <DndContext>
        <NotesSidebar {...props} />
      </DndContext>
    </TooltipProvider>,
  );
  return props;
}

const item = (name: string) =>
  screen.getAllByRole("treeitem").find((el) => el.textContent?.includes(name)) as HTMLElement;

describe("tree roles — the New Notes sidebar (NR-2, AC2/AC4)", () => {
  it("announces itself as a tree of leveled, expandable items", () => {
    renderSidebar();
    const tree = screen.getByRole("tree", { name: "Notes" });
    const items = within(tree).getAllByRole("treeitem");
    expect(items.length).toBeGreaterThanOrEqual(4);
    expect(item("Clients").getAttribute("aria-level")).toBe("1");
    expect(item("Clients").getAttribute("aria-expanded")).toBe("false");
    // A leaf carries no aria-expanded at all.
    expect(item("Idea").hasAttribute("aria-expanded")).toBe(false);
  });

  it("shows Favorites, the stored Inbox with its count, and Pages; trash stays out", () => {
    renderSidebar();
    expect(screen.getByRole("group", { name: "Favorites" }).textContent).toContain("Roadmap");
    expect(screen.getByRole("group", { name: "Inbox" }).textContent).toContain("Idea");
    expect(screen.getByRole("group", { name: "Pages" }).textContent).toContain("Clients");
    expect(screen.getByText("1 in Inbox", { exact: false })).toBeTruthy();
    expect(screen.queryAllByRole("treeitem").some((el) => el.textContent?.includes("Old"))).toBe(
      false,
    );
    expect(screen.getByRole("button", { name: "Deleted" })).toBeTruthy();
  });

  it("expands with →, steps into the child, and reports aria-level 2 there", () => {
    renderSidebar();
    const clients = item("Clients");
    clients.focus();
    fireEvent.keyDown(clients, { key: "ArrowRight" });
    expect(item("Clients").getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(item("Clients"), { key: "ArrowRight" });
    expect(document.activeElement).toBe(item("Acme"));
    expect(item("Acme").getAttribute("aria-level")).toBe("2");
    fireEvent.keyDown(item("Acme"), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(item("Clients"));
  });

  it("opens with ↵ and trashes with ⌫", () => {
    const props = renderSidebar();
    const idea = item("Idea");
    idea.focus();
    fireEvent.keyDown(idea, { key: "Enter" });
    expect(props.onOpen).toHaveBeenCalledWith("Idea");
    fireEvent.keyDown(idea, { key: "Backspace" });
    expect(props.onTrash).toHaveBeenCalledWith("Idea");
  });

  it("⌫ on a Favorites row only un-favorites, never trashes the shared note", () => {
    const props = renderSidebar();
    const fav = screen
      .getByRole("group", { name: "Favorites" })
      .querySelector<HTMLElement>('[role="treeitem"]') as HTMLElement;
    fav.focus();
    fireEvent.keyDown(fav, { key: "Backspace" });
    expect(props.onUnfavorite).toHaveBeenCalledWith("Roadmap");
    expect(props.onTrash).not.toHaveBeenCalled();
  });

  it("keeps one roving tab stop, on the open note", () => {
    renderSidebar({ selectedId: "Roadmap" });
    const stops = screen.getAllByRole("treeitem").filter((el) => el.tabIndex === 0);
    expect(stops).toHaveLength(1);
    expect(stops[0].getAttribute("aria-selected")).toBe("true");
  });

  it("view-only: no create buttons and ⌫ does nothing", () => {
    const props = renderSidebar({ canEdit: false });
    expect(screen.queryByRole("button", { name: /New note/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "New page" })).toBeNull();
    const idea = item("Idea");
    idea.focus();
    fireEvent.keyDown(idea, { key: "Backspace" });
    expect(props.onTrash).not.toHaveBeenCalled();
  });

  it("says where captures land when the Inbox is empty", () => {
    const filed = notes.filter((n) => n.id !== "Idea");
    renderSidebar({ notes: filed, sections: buildSidebarSections({ notes: filed, favorites }) });
    expect(screen.getByText("Captures land here.")).toBeTruthy();
  });
});
