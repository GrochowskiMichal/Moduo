// specs/mail-improve.md MI-0, AC26: on the Email route "Skip to mail list" is the first
// focusable element of the app shell, visible on focus; activating it focuses the
// selected row (else the list). Other routes get no skip link yet.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SkipLink } from "./skip-link";

afterEach(cleanup);

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function page(selected: boolean) {
  return (
    <>
      <SkipLink pathname="/email" />
      <nav aria-label="App">
        <button type="button">Home</button>
      </nav>
      <section aria-label="Mail list" data-skip-target="mail-list">
        <div role="listbox" aria-label="Conversations" tabIndex={-1}>
          <div role="option" aria-selected={false} tabIndex={-1} data-thread-id="t0">
            First
          </div>
          <div role="option" aria-selected={selected} tabIndex={-1} data-thread-id="t1">
            Second
          </div>
        </div>
      </section>
    </>
  );
}

describe("first focusable, focuses the list (AC26)", () => {
  it("is the first focusable element, hidden until focused", () => {
    const ui = render(page(true));
    const first = ui.container.querySelector<HTMLElement>(FOCUSABLE)!;
    expect(first.textContent).toBe("Skip to mail list");
    expect(first.className).toContain("sr-only");
    expect(first.className).toContain("focus:not-sr-only");
  });

  it("Enter focuses the selected row, else the list", () => {
    render(page(true));
    const link = screen.getByRole("link", { name: "Skip to mail list" });
    link.focus();
    fireEvent.click(link);
    expect((document.activeElement as HTMLElement).dataset.threadId).toBe("t1");
    cleanup();
    render(page(false));
    fireEvent.click(screen.getByRole("link", { name: "Skip to mail list" }));
    expect(document.activeElement?.getAttribute("role")).toBe("listbox");
  });

  it("no skip link off the Email route", () => {
    const ui = render(<SkipLink pathname="/tasks" />);
    expect(ui.container.textContent).toBe("");
  });
});
