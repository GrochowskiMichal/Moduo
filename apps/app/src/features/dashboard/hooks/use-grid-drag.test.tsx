// MOD-163 — a widget drag never outlives its page. Once a sideways swipe could
// turn Home's page over a widget, a swipe (or ←/→) mid-drag would have
// committed the old page's preview onto the new page, wiping its widgets: the
// drop resolves against the press-time page, while `onCommit` targets the page
// active at release. The page now refuses to turn under a held widget
// (`isGestureLive`), and the hook drops a gesture whose page changed anyway.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import type React from "react";

import type { WidgetInstance } from "../engine/types";
import { useGridDrag, type UseGridDragArgs } from "./use-grid-drag";

afterEach(cleanup);

// Two side by side, so dragging "a" two columns right swaps them (a lone
// widget would compact straight back to its start, a no-op drop).
const widgets: WidgetInstance[] = [
  { id: "a", type: "clock", size: "S", x: 0, y: 0, config: {} },
  { id: "b", type: "clock", size: "S", x: 2, y: 0, config: {} },
];

/** An 800×400 grid: 100 px per column, 100 px per row, no gap (jsdom has no layout). */
function gridElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 }) as DOMRect;
  return el;
}

function pointer(type: string, clientX: number, clientY: number, buttons = 1) {
  const ev = new MouseEvent(type, { clientX, clientY, buttons, bubbles: true, cancelable: true });
  Object.defineProperty(ev, "pointerId", { value: 1 });
  act(() => {
    window.dispatchEvent(ev);
  });
}

function setup(onCommit = rs.fn()) {
  const initialProps: UseGridDragArgs = {
    pageId: "p1",
    widgets,
    editing: true,
    onCommit,
    onLongPress: () => {},
  };
  const hook = renderHook((props: UseGridDragArgs) => useGridDrag(props), { initialProps });
  hook.result.current.gridRef.current = gridElement();
  const press = () =>
    act(() => {
      hook.result.current.startWidgetDrag("a", {
        button: 0,
        pointerId: 1,
        clientX: 50,
        clientY: 50,
        target: document.body,
      } as unknown as React.PointerEvent);
    });
  return { hook, press, initialProps, onCommit };
}

describe("useGridDrag across pages (MOD-163)", () => {
  it("commits a drop on the page it started on", () => {
    const { hook, press, onCommit } = setup();
    press();
    expect(hook.result.current.isGestureLive()).toBe(true);
    pointer("pointermove", 250, 50);
    expect(hook.result.current.drag?.activeId).toBe("a");
    pointer("pointerup", 250, 50, 0);
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit.mock.calls[0][0].find((w: WidgetInstance) => w.id === "a")?.x).toBe(2);
    expect(hook.result.current.isGestureLive()).toBe(false);
  });

  it("drops a drag, uncommitted, when another page becomes active mid-drag", () => {
    const { hook, press, initialProps, onCommit } = setup();
    press();
    pointer("pointermove", 250, 50);
    expect(hook.result.current.drag).not.toBeNull();
    hook.rerender({ ...initialProps, pageId: "p2", widgets: [] });
    expect(hook.result.current.drag).toBeNull();
    expect(hook.result.current.isGestureLive()).toBe(false);
    pointer("pointerup", 250, 50, 0);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("counts a press as live before it passes the slop, so the page can wait", () => {
    const { hook, press } = setup();
    press();
    pointer("pointermove", 52, 50); // inside the 6 px slop: not a drag yet
    expect(hook.result.current.drag).toBeNull();
    expect(hook.result.current.isGestureLive()).toBe(true);
    pointer("pointerup", 52, 50, 0);
    expect(hook.result.current.isGestureLive()).toBe(false);
  });
});
