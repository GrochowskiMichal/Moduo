// tasks-v2 Q1-5 — the shortcut sheet's module row spans every module shortcut
// (⌘1–⌘7 since Chat became the 7th tab), read from SHORTCUTS so it can't drift.

import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { act, cleanup, render, screen } from "@testing-library/react";

import { dispatchOpenShortcuts, GlobalShortcutsDialog } from "./global-shortcuts-dialog";

beforeEach(() => {
  Object.defineProperty(window.navigator, "platform", { value: "MacIntel", configurable: true });
});
afterEach(() => {
  cleanup();
  // Drop the own property so the prototype's real `platform` shows through again.
  Reflect.deleteProperty(window.navigator, "platform");
});

describe("GlobalShortcutsDialog", () => {
  it("lists the module jumps as ⌘1–⌘7", () => {
    render(<GlobalShortcutsDialog />);
    act(() => dispatchOpenShortcuts());

    const row = screen.getByText("Jump to a module").previousElementSibling;
    expect(row?.textContent).toBe("⌘1–⌘7");
  });
});
