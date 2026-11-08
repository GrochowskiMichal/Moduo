// specs/mail-improve.md MI-0, AC14: the reader toolbar is one Tab stop with arrow keys
// inside, grouped Reply · Reply all · Forward | Done · Snooze · Remind | Task · Link |
// panel | ⋯. Done always shows its label; Snooze and Remind from 1280 px up. Every
// accessible name starts with the visible label; keys go in aria-keyshortcuts.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { TooltipProvider } from "@/components/ui/tooltip";

import { ReaderToolbar } from "./reader-toolbar";

afterEach(cleanup);
// Focus opens a button's tooltip, whose popper measures with ResizeObserver (jsdom has none).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

let width = 1400;
beforeEach(() => {
  width = 1400;
  Object.defineProperty(window, "innerWidth", { configurable: true, get: () => width });
});

const tick = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

function mount(over: Partial<Parameters<typeof ReaderToolbar>[0]> = {}) {
  const onAction = rs.fn();
  const onToggle = rs.fn();
  render(
    <TooltipProvider>
      <ReaderToolbar
        onAction={onAction}
        menu={<DropdownMenuItem>Mute</DropdownMenuItem>}
        panel={{ open: true, onToggle }}
        {...over}
      />
    </TooltipProvider>,
  );
  const toolbar = screen.getByRole("toolbar", { name: "Conversation actions" });
  return { toolbar, onAction, onToggle };
}

const actions = (toolbar: HTMLElement) =>
  [...toolbar.querySelectorAll<HTMLElement>("[data-reader-action]")].map(
    (el) => el.dataset.readerAction,
  );

describe("roving toolbar, groups and labels (AC14)", () => {
  it("groups in order, with Note, Pin and Move gone to ⋯", () => {
    const { toolbar } = mount();
    expect(actions(toolbar)).toEqual([
      "reply",
      "reply-all",
      "forward",
      "done",
      "snooze",
      "remind",
      "task",
      "link",
      "panel",
      "more",
    ]);
    expect(toolbar.querySelectorAll('[role="separator"]').length).toBe(4);
  });

  it("is one Tab stop; arrows, Home and End move inside", async () => {
    const { toolbar } = mount();
    await tick();
    const buttons = within(toolbar).getAllByRole("button");
    expect(buttons.filter((b) => b.tabIndex === 0)).toHaveLength(1);
    buttons[0]!.focus();
    fireEvent.keyDown(buttons[0]!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(buttons[1]);
    fireEvent.keyDown(buttons[1]!, { key: "End" });
    expect(document.activeElement).toBe(buttons.at(-1));
    fireEvent.keyDown(buttons.at(-1)!, { key: "Home" });
    expect(document.activeElement).toBe(buttons[0]);
  });

  it("Done is labelled; Snooze and Remind are labelled from 1280 px", () => {
    let { toolbar } = mount();
    const done = within(toolbar).getByRole("button", { name: "Done" });
    expect(done.textContent).toContain("Done");
    expect(done.getAttribute("aria-keyshortcuts")).toBe("e");
    expect(within(toolbar).getByRole("button", { name: "Snooze" }).textContent).toContain("Snooze");
    expect(within(toolbar).getByRole("button", { name: /^Remind/ }).textContent).toContain(
      "Remind",
    );
    cleanup();

    width = 1024;
    ({ toolbar } = mount());
    expect(within(toolbar).getByRole("button", { name: "Done" }).textContent).toContain("Done");
    expect(within(toolbar).getByRole("button", { name: "Snooze" }).textContent).not.toContain(
      "Snooze",
    );
  });

  it("every name starts with its visible label and carries its key", () => {
    const { toolbar } = mount();
    for (const b of within(toolbar).getAllByRole("button")) {
      const visible = (b.textContent ?? "").trim();
      const name = b.getAttribute("aria-label") ?? visible;
      if (visible) expect(name.startsWith(visible)).toBe(true);
    }
    expect(
      within(toolbar).getByRole("button", { name: "Reply" }).getAttribute("aria-keyshortcuts"),
    ).toBe("r");
    expect(
      within(toolbar)
        .getByRole("button", { name: /side panel/i })
        .getAttribute("aria-keyshortcuts"),
    ).toBe("Alt+0");
  });

  it("disabled: the whole toolbar is aria-disabled and acts on nothing", () => {
    const { toolbar, onAction } = mount({ disabled: true });
    expect(toolbar.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(within(toolbar).getByRole("button", { name: "Done" }));
    expect(onAction).not.toHaveBeenCalled();
  });
});
