// MOD-140 — a sidebar's quiet footer: its items side by side, each named,
// with its tooltip, the current one marked; the words give way to the icon
// alone through a container query on the footer's own width.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Archive, Trash2 } from "lucide-react";

import { TooltipProvider } from "../ui/tooltip";
import { SidebarFooter } from "./sidebar-footer";

beforeAll(() => {
  // Radix's tooltip measures its trigger.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

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

  it("shows the words while there's room and the icon alone when the footer is narrow", () => {
    const { list } = renderFooter();
    // The footer reads its own width (a container), not the window's.
    expect(list.closest('[data-slot="sidebar-footer"]')?.className).toContain("@container");
    for (const label of list.querySelectorAll('[data-slot="sidebar-footer-label"]')) {
      expect(label.className).toContain("@max-[14rem]:sr-only");
    }
    expect(within(list).getByText("Recently deleted")).toBeTruthy();
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
