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
import { useState } from "react";

import { TooltipProvider } from "../ui/tooltip";
import { type PanelItem, RightPanel, usePanelStack } from "./right-panel";
import { TitleActions } from "./title-actions";

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

  it("says the page's title when it gives one, and the ▾ still switches (MOD-109)", () => {
    const { onChange } = renderPanel({ activeId: "detail", title: "4 tasks" });
    const trigger = screen.getByRole("button", { name: "Panel view: Detail, 4 tasks" });
    expect(trigger.textContent).toBe("4 tasks");
    expect(screen.getByText("Detail body")).toBeTruthy();
    const menu = openMenu("Panel view: Detail, 4 tasks");
    // The open view stays checked under its own name.
    expect(
      within(menu)
        .getByRole("menuitemradio", { name: /Detail/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(within(menu).getByRole("menuitemradio", { name: /Notes/ }));
    expect(onChange).toHaveBeenCalledWith("notes");
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

describe("focus after going back", () => {
  const top: PanelItem = { key: "email:7", title: "Re: Round 1", render: () => <p>Email body</p> };
  const under: PanelItem = { key: "task:1", title: "Collect assets", render: () => <p>Task</p> };

  function Stacked() {
    const [items, setItems] = useState<PanelItem[]>([under, top]);
    return (
      <TooltipProvider>
        <RightPanel
          module="calendar"
          views={CALENDAR_VIEWS}
          activeId="tasks"
          onChange={() => {}}
          items={items}
          onBack={() => setItems((all) => all.slice(0, -1))}
        />
      </TooltipProvider>
    );
  }

  it("names the item underneath on the back arrow, and keeps focus on the title row", () => {
    render(<Stacked />);
    const back = screen.getByRole("button", { name: "Back to Collect assets" });
    back.focus();
    fireEvent.click(back);
    const next = screen.getByRole("button", { name: "Back to Tasks" });
    expect(document.activeElement).toBe(next);
    fireEvent.click(next);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Panel view: Tasks" }));
  });
});

describe("while a dialog is open over the panel", () => {
  it("⌥n and Esc leave the panel alone", () => {
    const onBack = rs.fn();
    const item: PanelItem = { key: "task:1", title: "Collect assets", render: () => <p>Body</p> };
    const { onChange } = renderPanel({ items: [item], onBack });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("data-state", "open");
    document.body.appendChild(dialog);
    altDigit(1);
    fireEvent.keyDown(screen.getByText("Body"), { key: "Escape" });
    dialog.remove();
    expect(onChange).not.toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("a child that claims Esc in its own handler keeps the item open", () => {
    const onBack = rs.fn();
    const item: PanelItem = {
      key: "task:1",
      title: "Collect assets",
      render: () => (
        <button type="button" onKeyDown={(e) => e.key === "Escape" && e.preventDefault()}>
          Cancel delete
        </button>
      ),
    };
    renderPanel({ items: [item], onBack });
    fireEvent.keyDown(screen.getByRole("button", { name: "Cancel delete" }), { key: "Escape" });
    expect(onBack).not.toHaveBeenCalled();
  });
});

describe("the body's crossfade", () => {
  it("doesn't fade on mount, only after the view changes", () => {
    const { rerender } = render(
      <RightPanel module="calendar" views={CALENDAR_VIEWS} activeId="tasks" onChange={() => {}} />,
    );
    const bodyOf = (text: string) => screen.getByText(text).parentElement as HTMLElement;
    expect(bodyOf("Tasks body").className).not.toMatch(/motion-view/);
    rerender(
      <RightPanel module="calendar" views={CALENDAR_VIEWS} activeId="notes" onChange={() => {}} />,
    );
    expect(bodyOf("Notes body").className).toMatch(/motion-view/);
  });
});

describe("switching views over a deep stack", () => {
  it("without onClearItems, pops every item through onBack", () => {
    const onBack = rs.fn();
    const items: PanelItem[] = [1, 2, 3].map((n) => ({
      key: `task:${n}`,
      title: `Task ${n}`,
      render: () => <p>Task {n}</p>,
    }));
    const { onChange } = renderPanel({ items, onBack });
    altDigit(1);
    expect(onBack).toHaveBeenCalledTimes(3);
    expect(onChange).toHaveBeenCalledWith("detail");
  });
});

describe("the title row's actions slot (MOD-118 follow-up)", () => {
  const withActions = (body: string) => () => (
    <>
      <p>{body}</p>
      <TitleActions>
        <button type="button">Pin</button>
      </TitleActions>
    </>
  );

  it("a view's actions show at the row's right end, not in its body, and leave with it", () => {
    const views = { ...CALENDAR_VIEWS, tasks: withActions("Tasks body") };
    const { rerender } = renderPanel({ views });
    const row = screen.getByRole("button", { name: "Panel view: Tasks" })
      .parentElement as HTMLElement;
    const slot = row.querySelector("[data-slot=panel-title-actions]") as HTMLElement;
    expect(row.lastElementChild).toBe(slot);
    expect(within(slot).getByRole("button", { name: "Pin" })).toBeTruthy();
    expect(screen.getByText("Tasks body").parentElement?.contains(slot)).toBe(false);
    rerender(
      <TooltipProvider>
        <RightPanel module="calendar" views={views} activeId="notes" onChange={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "Pin" })).toBeNull();
    expect(slot.childElementCount).toBe(0);
  });

  it("an item's actions sit after its name, before its Open in …", () => {
    renderPanel({
      items: [
        {
          key: "task:1",
          title: "Collect assets",
          render: withActions("Task body"),
          open: { label: "Open in Tasks", onOpen: () => {} },
        },
      ],
      onBack: () => {},
    });
    const row = screen.getByRole("heading", { name: "Collect assets" })
      .parentElement as HTMLElement;
    expect(
      within(row)
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label") ?? b.textContent),
    ).toEqual(["Back to Tasks", "Pin", "Open in Tasks"]);
  });

  it("with no host around them, they render in place", () => {
    render(
      <section aria-label="Alone">
        <TitleActions>
          <button type="button">Pin</button>
        </TitleActions>
      </section>,
    );
    const alone = screen.getByRole("region", { name: "Alone" });
    expect(within(alone).getByRole("button", { name: "Pin" })).toBeTruthy();
  });
});

// MOD-121 (dogfood call #28): one panel frame. jsdom has no layout, so these pin
// the classes that place the row; the measured insets (fill 9 / 9 from the outer
// edge, text at 17, first lines on one centre) are in the live check.
describe("the title row's frame (MOD-121)", () => {
  const pulled = /(^|\s)-m[lxtrb]?-/;

  // The chip is a small row (28 / 26 / 24), 2 px over the 26 px buttons beside
  // it as round-2b frame 7 draws it; a full row (36) dwarfed them.
  it("is a row tall, and the ▾ chip is a small row tall with no pull into the padding", () => {
    renderPanel();
    const trigger = screen.getByRole("button", { name: "Panel view: Tasks" });
    expect(trigger.style.height).toBe("var(--row-h-sm)");
    expect(trigger.className).toMatch(/(^|\s)px-2(\s|$)/);
    expect(trigger.className).not.toMatch(pulled);
    const row = trigger.closest("div");
    expect(row?.className).toMatch(/(^|\s)min-h-\(--row-h\)(\s|$)/);
  });

  it("a plain title's text sits 8 in, where the chip's text does", () => {
    render(
      <RightPanel
        module="tasks"
        views={{ details: () => <p>Task details</p> }}
        activeId="details"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("heading", { name: "Details" }).className).toMatch(/(^|\s)px-2(\s|$)/);
  });

  it("the back arrow sits at the panel's padding, not pulled into it", () => {
    renderPanel({
      items: [{ key: "task:1", title: "Collect assets", render: () => <p>Task body</p> }],
      onBack: () => {},
    });
    expect(screen.getByRole("button", { name: "Back to Tasks" }).className).not.toMatch(pulled);
  });

  it("the body steps in 4, so a view's text lines up with the title's", () => {
    renderPanel();
    const body = screen.getByText("Tasks body").parentElement;
    expect(body?.className).toMatch(/(^|\s)px-1(\s|$)/);
  });
});
