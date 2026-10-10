// SH-1 (tasks-v3 calls 72a, AC11.7) — the right panel's title row: "Detail ▾"
// lists the module's registered views (about this, a hairline, alongside) with
// their ⌥ shortcuts; one view is just a title; an item opened on top shows as
// "← item" and the back arrow or Esc returns to the view.

import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  within,
} from "@testing-library/react";

import { TooltipProvider } from "../ui/tooltip";
import { type PanelItem, RightPanel, usePanelStack } from "./right-panel";

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

const CALENDAR_VIEWS = {
  tasks: () => <p>Tasks body</p>,
  detail: () => <p>Detail body</p>,
  notes: () => <p>Notes body</p>,
};

function renderPanel(props: Partial<React.ComponentProps<typeof RightPanel>> = {}) {
  const onChange = rs.fn();
  const utils = render(
    <TooltipProvider>
      <RightPanel
        module="calendar"
        views={CALENDAR_VIEWS}
        activeId="tasks"
        onChange={onChange}
        {...props}
      />
    </TooltipProvider>,
  );
  return { ...utils, onChange };
}

function openMenu(name: RegExp | string) {
  const trigger = screen.getByRole("button", { name });
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  return screen.getByRole("menu");
}

const altDigit = (n: number, target: EventTarget = window) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: true,
        code: `Digit${n}`,
        key: "¡",
        bubbles: true,
        cancelable: true,
      }),
    );
  });

describe("the title row names the view and switches it", () => {
  it("shows the active view and its body", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "Panel view: Tasks" }).textContent).toContain(
      "Tasks",
    );
    expect(screen.getByText("Tasks body")).toBeTruthy();
    expect(screen.queryByText("Detail body")).toBeNull();
  });

  it("lists about-this views, a hairline, then alongside views, each with ⌥n", () => {
    renderPanel();
    const menu = openMenu("Panel view: Tasks");
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringMatching(/^Detail(⌥|Alt )1$/),
      expect.stringMatching(/^Notes(⌥|Alt )2$/),
      expect.stringMatching(/^Tasks(⌥|Alt )3$/),
    ]);
    expect(items[2].getAttribute("aria-checked")).toBe("true");
    // One hairline, between Notes (about this) and Tasks (alongside).
    const separators = within(menu).getAllByRole("separator");
    expect(separators).toHaveLength(1);
    expect(separators[0].previousElementSibling).toBe(items[1]);
  });

  it("picking a view from the menu asks the page to switch", () => {
    const { onChange } = renderPanel();
    const menu = openMenu("Panel view: Tasks");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Notes/ }));
    expect(onChange).toHaveBeenCalledWith("notes");
  });

  it("a module with one view shows a plain title, not a menu", () => {
    render(
      <RightPanel
        module="tasks"
        views={{ details: () => <p>Task details</p> }}
        activeId="details"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Details" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Panel view/ })).toBeNull();
    expect(screen.getByText("Task details")).toBeTruthy();
  });

  it("only lists the views the page renders", () => {
    renderPanel({ views: { tasks: CALENDAR_VIEWS.tasks, detail: CALENDAR_VIEWS.detail } });
    const menu = openMenu("Panel view: Tasks");
    expect(within(menu).getAllByRole("menuitemradio")).toHaveLength(2);
  });
});

describe("⌥1–9", () => {
  it("picks the view at that position in the menu", () => {
    const { onChange } = renderPanel();
    altDigit(1);
    expect(onChange).toHaveBeenLastCalledWith("detail");
    altDigit(2);
    expect(onChange).toHaveBeenLastCalledWith("notes");
  });

  it("does nothing past the last view, for the open view, or while typing", () => {
    const { onChange } = renderPanel();
    altDigit(4);
    altDigit(3); // Tasks is already open
    const input = document.createElement("input");
    document.body.appendChild(input);
    altDigit(1, input);
    input.remove();
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("the ← item stack", () => {
  const item: PanelItem = {
    key: "task:1",
    title: "Collect assets",
    render: () => <p>Task body</p>,
    open: { label: "Open in Tasks", onOpen: () => {} },
  };

  it("shows the item's name with a back arrow to the view, and its body", () => {
    renderPanel({ items: [item], onBack: () => {} });
    expect(screen.getByRole("heading", { name: "Collect assets" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Back to Tasks" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open in Tasks" })).toBeTruthy();
    expect(screen.getByText("Task body")).toBeTruthy();
    expect(screen.queryByText("Tasks body")).toBeNull();
    expect(screen.queryByRole("button", { name: /Panel view/ })).toBeNull();
  });

  it("the back arrow and Esc step back", () => {
    const onBack = rs.fn();
    renderPanel({ items: [item], onBack });
    fireEvent.click(screen.getByRole("button", { name: "Back to Tasks" }));
    fireEvent.keyDown(screen.getByText("Task body"), { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(2);
  });

  it("Esc already handled by a menu or popover doesn't step back", () => {
    const onBack = rs.fn();
    renderPanel({ items: [item], onBack });
    const body = screen.getByText("Task body");
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    act(() => {
      body.dispatchEvent(event);
    });
    expect(onBack).not.toHaveBeenCalled();
  });

  it("⌥n with an item open closes the items and switches", () => {
    const onBack = rs.fn();
    const onClearItems = rs.fn();
    const { onChange } = renderPanel({ items: [item, item], onBack, onClearItems });
    altDigit(1);
    expect(onClearItems).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledWith("detail");
  });

  it("usePanelStack opens on top, ignores reopening the top, and pops one at a time", () => {
    const { result } = renderHook(() => usePanelStack<{ key: string }>());
    act(() => result.current.push({ key: "task:1" }));
    act(() => result.current.push({ key: "task:1" }));
    act(() => result.current.push({ key: "email:9" }));
    expect(result.current.stack.map((e) => e.key)).toEqual(["task:1", "email:9"]);
    act(() => result.current.back());
    expect(result.current.stack.map((e) => e.key)).toEqual(["task:1"]);
    act(() => result.current.clear());
    expect(result.current.stack).toEqual([]);
  });
});
