// MOD-97 · the directory's tag filter: its menu lists dot + name (no "#"), and
// the active filter shows in the trigger as the tag's ring chip.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "@/components/ui/tooltip";

import type { Tag } from "../../tasks/model";
import { ContactDirectory } from "./contact-directory";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(cleanup);

const tag = (id: string, name: string, color: string | null): Tag => ({
  id,
  workspaceId: "w1",
  ownerId: "u1",
  name,
  color,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  deletedAt: null,
});

function renderDirectory() {
  render(
    <TooltipProvider>
      <ContactDirectory
        contacts={[]}
        companies={[]}
        status="ready"
        selected={null}
        workspaceTags={[tag("g1", "investor", "green"), tag("g2", "press", null)]}
        tagLinks={[]}
        onSelect={rs.fn()}
      />
    </TooltipProvider>,
  );
}

function openTagMenu(name: string | RegExp) {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return screen.getByRole("menu");
}

describe("contacts tag filter (MOD-97)", () => {
  it("lists each tag as dot + name, without a #", () => {
    renderDirectory();
    const menu = openTagMenu("Tag");
    const investor = within(menu).getByRole("menuitemradio", { name: "investor" });
    expect(investor.textContent).toBe("investor");
    const dot = investor.querySelector(".tag-dot") as HTMLElement;
    expect(dot.getAttribute("data-label")).toBe("green");
    expect(dot.getAttribute("aria-hidden")).toBe("true");
    // The chip's own 6 px dot.
    expect(dot.className).toContain("size-1.5");
    // A tag with no stored hue falls back to gray.
    const press = within(menu).getByRole("menuitemradio", { name: "press" });
    expect(press.querySelector(".tag-dot")?.getAttribute("data-label")).toBe("gray");
    expect(menu.textContent).not.toContain("#");
  });

  it("shows the active filter as the tag's ring chip, and names the trigger for it", () => {
    renderDirectory();
    fireEvent.click(within(openTagMenu("Tag")).getByRole("menuitemradio", { name: "investor" }));
    const trigger = screen.getByRole("button", { name: "Tag filter: investor" });
    const chip = trigger.querySelector('[data-slot="tag-chip"]') as HTMLElement;
    expect(chip.textContent).toBe("investor");
    expect(chip.getAttribute("data-label")).toBe("green");
    expect(chip.className).toContain("tag-chip-active");
    // The trigger names it; the chip adds no hover text of its own.
    expect(chip.querySelector('[data-slot="tag-chip-label"]')?.getAttribute("title")).toBe("");
    expect(trigger.textContent).not.toContain("#");
  });
});
