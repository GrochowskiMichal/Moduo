// MOD-140 — a sidebar's quiet footer: its items side by side, each named,
// with its tooltip, the current one marked; the words give way to the icon
// alone the moment every label no longer fits whole, measured on the footer's
// own width.

import { afterAll, afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Archive, Trash2 } from "lucide-react";

import { TooltipProvider } from "../ui/tooltip";
import { SidebarFooter } from "./sidebar-footer";

// jsdom has no layout: the row and its measuring twin report the widths a
// test sets, and every ResizeObserver can be fired by hand.
const widths = { row: 300, measure: 200 };
const observers = new Set<() => void>();
const realRect = HTMLElement.prototype.getBoundingClientRect;

beforeAll(() => {
  // Radix's tooltip measures its trigger too.
  globalThis.ResizeObserver = class {
    #fire: () => void;
    constructor(cb: () => void) {
      this.#fire = () => cb();
    }
    observe() {
      observers.add(this.#fire);
    }
    unobserve() {}
    disconnect() {
      observers.delete(this.#fire);
    }
  } as never;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const slot = this.dataset.slot;
    const width =
      slot === "sidebar-footer-row"
        ? widths.row
        : slot === "sidebar-footer-measure"
          ? widths.measure
          : 0;
    return { ...realRect.call(this), width };
  };
});
afterAll(() => {
  HTMLElement.prototype.getBoundingClientRect = realRect;
});
afterEach(() => {
  cleanup();
  observers.clear();
  widths.row = 300;
  widths.measure = 200;
});

function resizeRow(width: number) {
  widths.row = width;
  act(() => {
    for (const fire of observers) fire();
  });
}

const labels = (list: HTMLElement) => [
  ...list.querySelectorAll<HTMLElement>('[data-slot="sidebar-footer-label"]'),
];

function renderFooter(active: "archived" | "trash" | null = null) {
  const onArchived = rs.fn();
  const onTrash = rs.fn();
  render(
    <TooltipProvider delayDuration={0}>
      <SidebarFooter
        label="Archive and trash"
        items={[
          { icon: Archive, label: "Archived", active: active === "archived", onSelect: onArchived },
          {
            icon: Trash2,
            label: "Recently deleted",
            active: active === "trash",
            onSelect: onTrash,
          },
        ]}
      />
    </TooltipProvider>,
  );
  return {
    onArchived,
    onTrash,
    list: screen.getByRole("navigation", { name: "Archive and trash" }),
  };
}

describe("SidebarFooter (MOD-140)", () => {
  it("lists its items side by side, each a named button that opens its place", () => {
    const { onArchived, onTrash, list } = renderFooter();
    const buttons = within(list).getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Archived",
      "Recently deleted",
    ]);
    // Side by side: one row, in its own navigation landmark.
    expect(list.querySelector("ul")?.className).toContain("flex");
    fireEvent.click(buttons[0] as HTMLElement);
    expect(onArchived).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[1] as HTMLElement);
    expect(onTrash).toHaveBeenCalledTimes(1);
  });

  it("shows the words while every label fits whole and the icon alone the moment one wouldn't", () => {
    const { list } = renderFooter();
    // Room for all the words (the twin, 200, fits the row, 300).
    for (const label of labels(list)) expect(label.className).not.toContain("sr-only");

    // Dragged narrower than the words need: icons alone, still named.
    resizeRow(180);
    for (const label of labels(list)) expect(label.className).toContain("sr-only");
    expect(within(list).getByRole("button", { name: "Recently deleted" })).toBeTruthy();

    // Exactly enough room is room.
    resizeRow(200);
    for (const label of labels(list)) expect(label.className).not.toContain("sr-only");
  });

  it("measures the labels it is given, so three items step aside sooner than two", () => {
    widths.measure = 320; // Notes' three labels need more than the row has.
    const { list } = renderFooter();
    for (const label of labels(list)) expect(label.className).toContain("sr-only");
    // The twin carries every label whole, unseen and out of the flow.
    const twin = list.querySelector('[data-slot="sidebar-footer-measure"]');
    expect(twin?.textContent).toBe("ArchivedRecently deleted");
    expect(twin?.parentElement?.getAttribute("aria-hidden")).toBe("true");
  });

  it("says each item's name in a tooltip", async () => {
    const { list } = renderFooter();
    fireEvent.focus(within(list).getByRole("button", { name: "Archived" }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.getByRole("tooltip").textContent).toBe("Archived");
  });

  it("marks the place you're on as the current page, with the neutral active fill", () => {
    const { list } = renderFooter("trash");
    const trash = within(list).getByRole("button", { name: "Recently deleted" });
    expect(trash.getAttribute("aria-current")).toBe("page");
    expect(trash.className).toContain("aria-[current=page]:bg-state-active");
    expect(
      within(list).getByRole("button", { name: "Archived" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("renders nothing without items", () => {
    render(<SidebarFooter label="Nothing" items={[]} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
