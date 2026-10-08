// DS-3 · DS-AC7 — NavRow: the count and ⋯ share one slot (the label never
// re-truncates on hover), ⋯ works by right-click and keyboard and stays while
// its menu is open, and the current row exposes aria-current. jsdom can't
// hover or measure, so the swap is checked structurally here (same slot, ⋯
// absolutely placed, the count only fades) and measured live in Storybook.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Layers } from "lucide-react";
import { useState } from "react";

import {
  focusNavRow,
  type MenuKit,
  NavRow,
  NavRowDot,
  NavSectionHeader,
  restoreNavFocus,
} from "./nav-row";
import { Popover, PopoverAnchor, PopoverContent } from "./popover";
import { TooltipProvider } from "./tooltip";

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

// Long enough for a menu to unmount and Radix's focus return (a 0 ms timer).
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 50)));
const rowOf = (el: HTMLElement) => el.closest('[data-slot="nav-row"]') as HTMLElement;
const main = (name: string | RegExp) => screen.getByRole("button", { name });

function renderRows(extra: { onRename?: (name: string) => void; onDelete?: () => void } = {}) {
  const onDelete = extra.onDelete ?? rs.fn();
  const menu = (m: MenuKit) => (
    <>
      <m.Item onSelect={m.rename}>Rename</m.Item>
      <m.Item onSelect={m.afterClose(onDelete)}>Delete…</m.Item>
    </>
  );
  render(
    <TooltipProvider>
      <nav aria-label="Rail">
        <NavRow label="All" icon={<Layers aria-hidden />} count={76} current />
        <NavRow
          navId="mkt"
          label="Marketing"
          icon={<NavRowDot />}
          count={5}
          countLabel="5 open"
          menu={menu}
          onRename={extra.onRename}
        />
        <NavRow navId="empty" label="Someday" icon={<NavRowDot />} count={0} />
      </nav>
    </TooltipProvider>,
  );
  return { onDelete };
}

describe("NavRow", () => {
  it("marks only the current row with aria-current=page", () => {
    renderRows();
    expect(main(/^All,/).getAttribute("aria-current")).toBe("page");
    expect(main(/^Marketing,/).getAttribute("aria-current")).toBeNull();
    expect(rowOf(main(/^All,/)).dataset.current).toBe("true");
  });

  it("puts the count and ⋯ in one slot: ⋯ sits on top of the count, the count only fades", () => {
    renderRows();
    const more = screen.getByRole("button", { name: "Marketing options" });
    const slot = more.closest('[data-slot="nav-row-trail"]') as HTMLElement;
    const count = slot.querySelector('[data-slot="nav-row-count"]') as HTMLElement;
    expect(count.textContent).toBe("5");
    // Same slot, ⋯ absolutely placed over it; the slot is at least ⋯'s width.
    expect(more.className).toMatch(/(?:^|\s)absolute(?:\s|$)/);
    expect(slot.className).toContain("min-w-5");
    // Reveal is opacity only (R6): nothing toggles display, so nothing reflows.
    expect(count.className).toContain("group-hover/nav:opacity-0");
    expect(more.className).toContain("group-hover/nav:opacity-100");
    for (const el of [count, more, slot]) {
      expect(el.className).not.toMatch(/(?:^|\s)(?:hidden|group-hover\/nav:(?:flex|block|hidden))/);
    }
    // The label is outside the slot and carries no hover-dependent sizing.
    const label = rowOf(more).querySelector('[data-slot="nav-row-label"]') as HTMLElement;
    expect(slot.contains(label)).toBe(false);
    expect(label.className).not.toContain("hover");
  });

  it("reserves no slot on a row without a menu, and hides a zero count", () => {
    renderRows();
    expect(rowOf(main(/^All,/)).querySelector('[data-slot="nav-row-trail"]')).not.toBeNull();
    expect(rowOf(main(/^All,/)).querySelector('[data-slot="nav-row-action"]')).toBeNull();
    expect(rowOf(main("Someday")).querySelector('[data-slot="nav-row-trail"]')).toBeNull();
  });

  it("reads the count to a screen reader through the row's own button", () => {
    renderRows();
    expect(main("Marketing, 5 open")).toBeTruthy();
  });

  it("opens ⋯ from the keyboard, and ⋯ stays visible while its menu is open", async () => {
    renderRows();
    const more = screen.getByRole("button", { name: "Marketing options" });
    more.focus();
    fireEvent.keyDown(more, { key: "Enter", code: "Enter" });
    await settle();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(more.className).toContain("aria-expanded:opacity-100");
  });

  it("opens the same menu on right-click, and the open menu holds the swap", async () => {
    renderRows();
    const row = rowOf(main(/^Marketing,/));
    fireEvent.contextMenu(row);
    await settle();
    expect(screen.getByRole("menuitem", { name: "Rename" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Delete…" })).toBeTruthy();
    // The row is the context-menu trigger: its open state keeps ⋯ in and the count out.
    expect(row.dataset.state).toBe("open");
    const count = row.querySelector('[data-slot="nav-row-count"]') as HTMLElement;
    const more = row.querySelector('[data-slot="nav-row-action"]') as HTMLElement;
    expect(count.className).toContain("group-data-[state=open]/nav:opacity-0");
    expect(more.className).toContain("group-data-[state=open]/nav:opacity-100");
  });

  it("keeps the same row when its menu comes and goes (Inbox's, with drift)", () => {
    const menu = (m: MenuKit) => <m.Item>Triage…</m.Item>;
    const { rerender } = render(
      <TooltipProvider>
        <NavRow label="Inbox" count={2} />
      </TooltipProvider>,
    );
    const before = main(/^Inbox,/);
    before.focus();
    rerender(
      <TooltipProvider>
        <NavRow label="Inbox" count={2} menu={menu} />
      </TooltipProvider>,
    );
    expect(main(/^Inbox,/)).toBe(before);
    expect(document.activeElement).toBe(before);
    expect(screen.getByRole("button", { name: "Inbox options" })).toBeTruthy();
  });

  it("runs an afterClose action only once the menu has closed", async () => {
    const onDelete = rs.fn(() => {
      // The menu must be gone by the time the action runs (it opens a dialog).
      expect(screen.queryByRole("menu")).toBeNull();
    });
    renderRows({ onDelete });
    fireEvent.contextMenu(rowOf(main(/^Marketing,/)));
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete…" }));
    await settle();
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("renames inline from the menu: Enter saves the trimmed name and focus returns to the row", async () => {
    const onRename = rs.fn();
    renderRows({ onRename });
    fireEvent.contextMenu(rowOf(main(/^Marketing,/)));
    await settle();
    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));
    await settle();

    const input = screen.getByDisplayValue("Marketing");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "  Growth  " } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    await settle();
    expect(onRename).toHaveBeenCalledWith("Growth");
    expect(document.activeElement).toBe(main(/^Marketing,/));
  });

  it("Esc throws a rename away; F2 and double-click start one", async () => {
    const onRename = rs.fn();
    renderRows({ onRename });
    fireEvent.keyDown(main(/^Marketing,/), { key: "F2" });
    const input = screen.getByDisplayValue("Marketing");
    fireEvent.change(input, { target: { value: "Nope" } });
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
    await settle();
    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByDisplayValue("Nope")).toBeNull();

    fireEvent.doubleClick(main(/^Marketing,/));
    expect(screen.getByDisplayValue("Marketing")).toBeTruthy();
  });

  it("does not start a rename on a row without onRename", () => {
    renderRows();
    fireEvent.doubleClick(main(/^Marketing,/));
    expect(screen.queryByDisplayValue("Marketing")).toBeNull();
  });

  it("exposes drop-target and dragging states for drag and drop", () => {
    render(
      <>
        <NavRow label="Target" dropTarget />
        <NavRow label="Source" dragging />
      </>,
    );
    const target = rowOf(main("Target"));
    expect(target.dataset.dropTarget).toBe("true");
    expect(rowOf(main("Source")).dataset.dragging).toBe("true");
    // DS-4's recipes; the drop target's hover fill replaces the row's own hover.
    expect(target.className).toContain("ring-primary/60");
    expect(target.className).toContain("hover:bg-state-active");
    expect(target.className).not.toContain("hover:bg-state-hover");
    expect(rowOf(main("Source")).className).toContain("opacity-40");
  });

  it("activates on click anywhere on the row through its main button", () => {
    const onSelect = rs.fn();
    render(<NavRow label="Inbox" onSelect={onSelect} />);
    fireEvent.click(main("Inbox"));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});

describe("NavSectionHeader", () => {
  it("toggles with aria-expanded and swaps its count for the hover +", () => {
    const onToggle = rs.fn();
    const onAdd = rs.fn();
    render(
      <TooltipProvider>
        <NavSectionHeader
          label="Clients"
          count={14}
          collapsed
          onToggle={onToggle}
          onAdd={onAdd}
          addLabel="New bucket"
        />
      </TooltipProvider>,
    );
    const toggle = screen.getByRole("button", { name: /Clients/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);

    const add = screen.getByRole("button", { name: "New bucket" });
    const slot = add.closest('[data-slot="nav-row-trail"]') as HTMLElement;
    expect(slot.querySelector('[data-slot="nav-row-count"]')?.textContent).toBe("14");
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("keeps the count visible on an expanded section (aria-expanded alone doesn't swap)", () => {
    render(
      <TooltipProvider>
        <NavSectionHeader label="Clients" count={3} onToggle={() => {}} onAdd={() => {}} />
      </TooltipProvider>,
    );
    const count = document.querySelector('[data-slot="nav-row-count"]') as HTMLElement;
    // The swap keys on the ACTION's aria-expanded, never the toggle's.
    expect(count.className).toContain("[data-slot=nav-row-action][aria-expanded=true]");
    expect(count.className).not.toContain("group-has-[[aria-expanded=true]]");
  });
});

describe("restoreNavFocus", () => {
  // A row-menu popover with no trigger (Share): anchored to the row, closed by
  // Esc or by clicking somewhere else.
  function renderPopover() {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <>
          <nav aria-label="Rail">
            <div className="relative">
              <NavRow navId="mkt" label="Marketing" />
              <Popover open={open} onOpenChange={setOpen}>
                <PopoverAnchor asChild>
                  <span />
                </PopoverAnchor>
                <PopoverContent
                  onCloseAutoFocus={(e) => restoreNavFocus(e, document.querySelector("nav"), "mkt")}
                >
                  <button type="button">Can edit</button>
                </PopoverContent>
              </Popover>
            </div>
          </nav>
          <input aria-label="Task title" />
        </>
      );
    }
    render(<Harness />);
  }

  it("hands focus back to the row when the popover closes on Esc", async () => {
    renderPopover();
    await settle();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await settle();
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(document.activeElement).toBe(main("Marketing"));
  });

  it("leaves focus in the field the person clicked into to close it", async () => {
    renderPopover();
    await settle();
    const field = screen.getByRole("textbox", { name: "Task title" });
    fireEvent.pointerDown(field);
    fireEvent.mouseDown(field);
    field.focus();
    fireEvent.pointerUp(field);
    fireEvent.mouseUp(field);
    fireEvent.click(field);
    await settle();
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
    expect(document.activeElement).toBe(field);
  });
});

describe("focusNavRow", () => {
  it("focuses the named row, else the current row, else the first", () => {
    renderRows();
    const nav = screen.getByRole("navigation", { name: "Rail" });
    expect(focusNavRow(nav, "mkt")).toBe(true);
    expect(document.activeElement).toBe(main(/^Marketing,/));

    expect(focusNavRow(nav, "gone")).toBe(true);
    expect(document.activeElement).toBe(main(/^All,/));

    expect(focusNavRow(null, "mkt")).toBe(false);
  });
});
