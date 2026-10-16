// MOD-161 — Home's pages never slide out from under their dot. Focusing a
// widget on a page off screen used to scroll the `overflow: hidden` viewport
// sideways (a Tab walk landed on page 2's widget and left two half pages under
// page 1's dot). The pages off screen are inert, so Tab never reaches them, and
// the viewport clips instead of hiding, so nothing can scroll it. jsdom has no
// layout or `inert` behaviour, so this pins the structure; the Tab walk and the
// "scrollLeft = 300 is a no-op" check ran live.
//
// MOD-163 — a sideways swipe over a widget turns the page (it used to turn only
// over the gaps between widgets), unless the widget scrolls sideways itself:
// that box keeps the swipe, past its end too. jsdom has no layout, so a
// scroller's widths are set by hand; the trackpad swipes ran live.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

const h = rs.hoisted(() => ({ extra: null as null | (() => ReactNode) }));

rs.mock("./grid-canvas", () => ({
  GridCanvas: ({ widgets }: { widgets: { id: string }[] }) => (
    <div>
      <button type="button">{widgets.map((w) => w.id).join(",")}</button>
      {widgets.some((w) => w.id === "a") ? h.extra?.() : null}
    </div>
  ),
}));

import type { DashboardLayout } from "../engine/types";
import { DashboardPager } from "./dashboard-pager";

afterEach(() => {
  cleanup();
  h.extra = null;
});

const layout: DashboardLayout = {
  version: 1,
  pages: [
    { id: "p1", widgets: [{ id: "a", type: "clock", size: "S", x: 0, y: 0, config: {} }] },
    { id: "p2", widgets: [{ id: "b", type: "clock", size: "S", x: 0, y: 0, config: {} }] },
  ],
};

function renderPager(activeIndex: number, onPage: (dir: -1 | 1) => void = () => {}) {
  return render(
    <DashboardPager
      layout={layout}
      activeIndex={activeIndex}
      editing={false}
      drag={null}
      gridRef={() => {}}
      onWidgetPointerDown={() => {}}
      onRemove={() => {}}
      onResize={() => {}}
      onPage={onPage}
    />,
  );
}

/** A box inside page 1's widget whose content is `scrollWidth` wide in a `clientWidth` box. */
function withScroller(overflowX: "auto" | "hidden", scrollWidth: number, clientWidth = 100) {
  h.extra = () => (
    <div data-testid="scroller" style={{ overflowX }}>
      <span data-testid="inside">wide content</span>
    </div>
  );
  return (el: HTMLElement) => {
    Object.defineProperty(el, "scrollWidth", { configurable: true, value: scrollWidth });
    Object.defineProperty(el, "clientWidth", { configurable: true, value: clientWidth });
  };
}

describe("DashboardPager (MOD-161)", () => {
  it("makes every page but the current one inert", () => {
    const { container, rerender } = renderPager(0);
    const viewport = container.firstElementChild as HTMLElement;
    const [first, second] = Array.from(viewport.children) as HTMLElement[];
    expect(first.hasAttribute("inert")).toBe(false);
    expect(second.hasAttribute("inert")).toBe(true);

    rerender(
      <DashboardPager
        layout={layout}
        activeIndex={1}
        editing={false}
        drag={null}
        gridRef={() => {}}
        onWidgetPointerDown={() => {}}
        onRemove={() => {}}
        onResize={() => {}}
        onPage={() => {}}
      />,
    );
    expect(first.hasAttribute("inert")).toBe(true);
    expect(second.hasAttribute("inert")).toBe(false);
  });

  it("hands focus to the new page when it pages from a focused widget", () => {
    const { rerender } = renderPager(0);
    const first = screen.getByRole("button", { name: "a" });
    first.focus();
    expect(document.activeElement).toBe(first);
    rerender(
      <DashboardPager
        layout={layout}
        activeIndex={1}
        editing={false}
        drag={null}
        gridRef={() => {}}
        onWidgetPointerDown={() => {}}
        onRemove={() => {}}
        onResize={() => {}}
        onPage={() => {}}
      />,
    );
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "b" }));
  });

  it("clips the viewport instead of hiding it, so it is no scroll container", () => {
    const { container } = renderPager(0);
    const viewport = container.firstElementChild as HTMLElement;
    expect(viewport.className).toMatch(/\boverflow-clip\b/);
    expect(viewport.className).not.toMatch(/\boverflow-hidden\b/);
  });
});

describe("DashboardPager swipes (MOD-163)", () => {
  it("turns the page on a sideways swipe over a widget, both ways", () => {
    const onPage = rs.fn();
    renderPager(0, onPage);
    fireEvent.wheel(screen.getByRole("button", { name: "a" }), { deltaX: 80, deltaY: 0 });
    expect(onPage).toHaveBeenCalledTimes(1);
    expect(onPage).toHaveBeenLastCalledWith(1);

    cleanup();
    const back = rs.fn();
    renderPager(0, back);
    fireEvent.wheel(screen.getByRole("button", { name: "a" }), { deltaX: -80, deltaY: 0 });
    expect(back).toHaveBeenLastCalledWith(-1);
  });

  it("keeps the threshold: small travel adds up to one turn, and the lockout stops a second", () => {
    const onPage = rs.fn();
    renderPager(0, onPage);
    const widget = screen.getByRole("button", { name: "a" });
    fireEvent.wheel(widget, { deltaX: 25, deltaY: 0 });
    fireEvent.wheel(widget, { deltaX: 25, deltaY: 0 });
    expect(onPage).not.toHaveBeenCalled();
    fireEvent.wheel(widget, { deltaX: 25, deltaY: 0 });
    expect(onPage).toHaveBeenCalledTimes(1);
    // Momentum right after a turn never turns a second page.
    fireEvent.wheel(widget, { deltaX: 80, deltaY: 0 });
    fireEvent.wheel(widget, { deltaX: 80, deltaY: 0 });
    expect(onPage).toHaveBeenCalledTimes(1);
  });

  it("never pages on a mostly vertical wheel, drift and all", () => {
    const onPage = rs.fn();
    renderPager(0, onPage);
    const widget = screen.getByRole("button", { name: "a" });
    for (let i = 0; i < 20; i++) fireEvent.wheel(widget, { deltaX: 30, deltaY: 60 });
    // A stray sideways-leaning event between vertical ones starts from zero.
    fireEvent.wheel(widget, { deltaX: 40, deltaY: 10 });
    fireEvent.wheel(widget, { deltaX: 10, deltaY: 60 });
    fireEvent.wheel(widget, { deltaX: 40, deltaY: 10 });
    expect(onPage).not.toHaveBeenCalled();
  });

  it("leaves a sideways swipe over a widget that scrolls sideways to it, past its end too", () => {
    const size = withScroller("auto", 400);
    const onPage = rs.fn();
    renderPager(0, onPage);
    size(screen.getByTestId("scroller"));
    // From inside its content, at whatever scroll position: the box's own swipe.
    for (let i = 0; i < 5; i++) {
      fireEvent.wheel(screen.getByTestId("inside"), { deltaX: 120, deltaY: 0 });
    }
    expect(onPage).not.toHaveBeenCalled();
    // The rest of the same widget still pages.
    fireEvent.wheel(screen.getByRole("button", { name: "a" }), { deltaX: 80, deltaY: 0 });
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it("pages over a box that could scroll sideways but has nothing to scroll", () => {
    const fits = withScroller("auto", 100);
    const onPage = rs.fn();
    renderPager(0, onPage);
    fits(screen.getByTestId("scroller"));
    fireEvent.wheel(screen.getByTestId("inside"), { deltaX: 80, deltaY: 0 });
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it("pages over a box whose wide content is clipped, not scrolled", () => {
    const clipped = withScroller("hidden", 400);
    const onPage = rs.fn();
    renderPager(0, onPage);
    clipped(screen.getByTestId("scroller"));
    fireEvent.wheel(screen.getByTestId("inside"), { deltaX: 80, deltaY: 0 });
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it("ignores a swipe over a widget's popover, which sits outside the pages", () => {
    h.extra = () => createPortal(<div data-testid="popover">config</div>, document.body);
    const onPage = rs.fn();
    renderPager(0, onPage);
    fireEvent.wheel(screen.getByTestId("popover"), { deltaX: 80, deltaY: 0 });
    expect(onPage).not.toHaveBeenCalled();
  });
});
