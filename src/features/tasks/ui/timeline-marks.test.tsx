// A mark's hover text never stands beside a drag's own date label: it won't
// open while a drag runs, and an open one shuts when a drag starts.

import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { type CanvasStore, createCanvasStore, TimelineCanvasContext } from "./timeline-drag-store";
import { MarkTooltip } from "./timeline-marks";

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never;
});
afterEach(() => cleanup());

const DRAG = { kind: "point", taskIds: new Set(["t1"]), leadId: "t1", delta: 3 } as const;

function renderMark(canvas: CanvasStore) {
  return render(
    <TooltipProvider delayDuration={0}>
      <TimelineCanvasContext.Provider value={canvas}>
        <MarkTooltip label="Due Tue, Oct 20">
          <button type="button">point</button>
        </MarkTooltip>
      </TimelineCanvasContext.Provider>
    </TooltipProvider>,
  );
}

describe("MarkTooltip", () => {
  it("opens on focus when nothing is being dragged", () => {
    renderMark(createCanvasStore());
    fireEvent.focus(screen.getByRole("button", { name: "point" }));
    expect(screen.getByRole("tooltip").textContent).toContain("Due Tue, Oct 20");
  });

  it("stays shut while a drag runs", () => {
    const canvas = createCanvasStore();
    canvas.setDrag(DRAG);
    renderMark(canvas);
    fireEvent.focus(screen.getByRole("button", { name: "point" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shuts the moment a drag starts", () => {
    const canvas = createCanvasStore();
    renderMark(canvas);
    fireEvent.focus(screen.getByRole("button", { name: "point" }));
    expect(screen.getByRole("tooltip")).toBeTruthy();
    act(() => canvas.setDrag(DRAG));
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});
