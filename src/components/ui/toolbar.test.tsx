// DF-18 — `role="toolbar"` is a promise (one tab stop, arrows move between the
// controls). The primitive announced it for a long time without keeping it;
// these lock the behaviour in.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { SegmentedControl } from "./segmented-control";
import { Toolbar } from "./toolbar";

afterEach(cleanup);

function Row() {
  return (
    <Toolbar aria-label="Row">
      <button type="button">One</button>
      <Toolbar.Group>
        <button type="button">Two</button>
        <button type="button">Three</button>
      </Toolbar.Group>
    </Toolbar>
  );
}

describe("Toolbar roving focus", () => {
  it("is a single tab stop — only the active control is tabbable", () => {
    render(<Row />);
    expect(screen.getByText("One").tabIndex).toBe(0);
    expect(screen.getByText("Two").tabIndex).toBe(-1);
    expect(screen.getByText("Three").tabIndex).toBe(-1);
  });

  it("moves focus with Arrow keys, across groups, and wraps", () => {
    render(<Row />);
    const [one, two, three] = ["One", "Two", "Three"].map((t) => screen.getByText(t));

    one.focus();
    fireEvent.keyDown(one, { key: "ArrowRight" });
    expect(document.activeElement).toBe(two);
    expect(two.tabIndex).toBe(0);
    expect(one.tabIndex).toBe(-1);

    fireEvent.keyDown(two, { key: "ArrowRight" });
    expect(document.activeElement).toBe(three);

    fireEvent.keyDown(three, { key: "ArrowRight" });
    expect(document.activeElement).toBe(one);

    fireEvent.keyDown(one, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(three);
  });

  it("Home/End jump to the ends", () => {
    render(<Row />);
    const two = screen.getByText("Two");
    two.focus();
    fireEvent.keyDown(two, { key: "End" });
    expect(document.activeElement).toBe(screen.getByText("Three"));
    fireEvent.keyDown(screen.getByText("Three"), { key: "Home" });
    expect(document.activeElement).toBe(screen.getByText("One"));
  });

  it("clicking a control makes it the tab stop", () => {
    render(<Row />);
    const three = screen.getByText("Three");
    fireEvent.focus(three);
    expect(three.tabIndex).toBe(0);
    expect(screen.getByText("One").tabIndex).toBe(-1);
  });

  it("never leaves the toolbar with zero tab stops when a control unmounts", () => {
    function Conditional({ show }: { show: boolean }) {
      return (
        <Toolbar aria-label="Row">
          {show ? <button type="button">Gone</button> : null}
          <button type="button">Stays</button>
        </Toolbar>
      );
    }
    const { rerender } = render(<Conditional show />);
    expect(screen.getByText("Gone").tabIndex).toBe(0);
    rerender(<Conditional show={false} />);
    expect(screen.getByText("Stays").tabIndex).toBe(0);
  });

  it("still works inside an aria-hidden shell wrapper", () => {
    // Live-caught: the app shell wraps panes in aria-hidden divs, and a
    // document-wide `closest()` read every control as unreachable — silently
    // turning roving focus off on every real surface.
    render(
      <div aria-hidden="true">
        <Toolbar aria-label="Row">
          <button type="button">One</button>
          <button type="button">Two</button>
        </Toolbar>
      </div>,
    );
    expect(screen.getByText("One").tabIndex).toBe(0);
    expect(screen.getByText("Two").tabIndex).toBe(-1);
  });

  it("counts a nested roving widget as ONE tab stop, root included", async () => {
    render(
      <Toolbar aria-label="Row">
        <button type="button">One</button>
        <SegmentedControl
          aria-label="View"
          value="list"
          onValueChange={() => {}}
          items={[
            { value: "list", label: "List" },
            { value: "board", label: "Board" },
          ]}
        />
      </Toolbar>,
    );
    const toolbar = screen.getByRole("toolbar");
    // Simulate the widget parking a tabindex on its current item while its root
    // also stays tabbable (radix does exactly this) — both must not count.
    screen.getByRole("radio", { name: "List" }).tabIndex = 0;
    // Before anything inside it is focused, the segmented control parks its own
    // tabindex on the ROOT (in an effect that lands after ours) — counting only
    // its children left the toolbar with two tab stops.
    await waitFor(() => {
      const stops = [...toolbar.querySelectorAll<HTMLElement>("button,[tabindex]")].filter(
        (el) => el.tabIndex === 0,
      );
      expect(stops).toHaveLength(1);
      expect(stops[0]).toBe(screen.getByText("One"));
    });
  });

  it("does not steal arrow keys from a nested widget that owns them", () => {
    render(
      <Toolbar aria-label="Row">
        <button type="button">One</button>
        <SegmentedControl
          aria-label="View"
          value="list"
          onValueChange={() => {}}
          items={[
            { value: "list", label: "List" },
            { value: "board", label: "Board" },
          ]}
        />
      </Toolbar>,
    );
    const list = screen.getByRole("radio", { name: "List" });
    list.focus();
    const before = document.activeElement;
    fireEvent.keyDown(list, { key: "ArrowRight" });
    // The SegmentedControl's own roving group handles this; the toolbar must not
    // yank focus out to another control.
    expect(document.activeElement).toBe(before);
  });

  it("arrows OUT of a nested widget at its edge, so nothing after it is stranded", () => {
    render(
      <Toolbar aria-label="Row">
        <button type="button">Before</button>
        <SegmentedControl
          aria-label="View"
          value="list"
          onValueChange={() => {}}
          items={[
            { value: "list", label: "List" },
            { value: "board", label: "Board" },
          ]}
        />
        <button type="button">New</button>
      </Toolbar>,
    );
    const board = screen.getByRole("radio", { name: "Board" });
    board.focus();
    // The widget loops internally; without the edge exit, "New" was unreachable
    // by keyboard once focus entered the switcher.
    fireEvent.keyDown(board, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByText("New"));

    const list = screen.getByRole("radio", { name: "List" });
    list.focus();
    fireEvent.keyDown(list, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByText("Before"));
  });

  it("passes the consumer's own handlers through", () => {
    const onKeyDown = rs.fn();
    render(
      <Toolbar aria-label="Row" onKeyDown={onKeyDown}>
        <button type="button">One</button>
      </Toolbar>,
    );
    fireEvent.keyDown(screen.getByText("One"), { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalled();
  });
});
