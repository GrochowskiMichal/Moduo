// A press on a control inside a widget is the control's, never the grid's: a
// held slider thumb (Soundspace volume) or a press inside the widget's own
// popover (portaled out of the widget, but React still bubbles it to the
// widget's onPointerDown) must not count as a long-press into edit mode.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, renderHook } from "@testing-library/react";
import type React from "react";

import type { WidgetInstance } from "../engine/types";
import { useGridDrag } from "./use-grid-drag";

const widgets: WidgetInstance[] = [
  { id: "a", type: "soundspace", size: "M", x: 0, y: 0, config: {} },
];

beforeEach(() => {
  rs.useFakeTimers();
});
afterEach(() => {
  rs.useRealTimers();
  cleanup();
  document.body.innerHTML = "";
});

function setup() {
  const onLongPress = rs.fn();
  const hook = renderHook(() =>
    useGridDrag({ pageId: "p1", widgets, editing: false, onCommit: () => {}, onLongPress }),
  );
  const grid = document.createElement("div");
  grid.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 400, width: 800, height: 400 }) as DOMRect;
  hook.result.current.gridRef.current = grid;
  // The widget's wrapper, which owns onPointerDown.
  const widget = document.createElement("div");
  grid.append(widget);
  document.body.append(grid);
  /** Press on `target` (bubbling to the widget wrapper) and hold past the long-press. */
  const hold = (target: Element) => {
    act(() => {
      hook.result.current.startWidgetDrag("a", {
        button: 0,
        pointerId: 1,
        clientX: 50,
        clientY: 50,
        target,
        currentTarget: widget,
      } as unknown as React.PointerEvent);
    });
    act(() => {
      rs.advanceTimersByTime(600);
    });
  };
  return { widget, hold, onLongPress };
}

describe("useGridDrag: presses on controls", () => {
  it("still enters edit mode on a long-press over plain widget content", () => {
    const { widget, hold, onLongPress } = setup();
    const text = document.createElement("span");
    widget.append(text);
    hold(text);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });

  it("ignores a held slider thumb", () => {
    const { widget, hold, onLongPress } = setup();
    const thumb = document.createElement("span");
    thumb.setAttribute("role", "slider");
    widget.append(thumb);
    hold(thumb);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores a press on a slider's track", () => {
    const { widget, hold, onLongPress } = setup();
    const root = document.createElement("span");
    root.dataset.slot = "slider";
    const track = document.createElement("span");
    root.append(track);
    widget.append(root);
    hold(track);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("ignores a press inside a popover portaled out of the widget", () => {
    const { hold, onLongPress } = setup();
    const portal = document.createElement("div");
    const padding = document.createElement("p");
    portal.append(padding);
    document.body.append(portal);
    hold(padding);
    expect(onLongPress).not.toHaveBeenCalled();
  });
});
