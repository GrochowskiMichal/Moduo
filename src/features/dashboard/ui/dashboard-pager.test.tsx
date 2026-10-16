// MOD-161 — Home's pages never slide out from under their dot. Focusing a
// widget on a page off screen used to scroll the `overflow: hidden` viewport
// sideways (a Tab walk landed on page 2's widget and left two half pages under
// page 1's dot). The pages off screen are inert, so Tab never reaches them, and
// the viewport clips instead of hiding, so nothing can scroll it. jsdom has no
// layout or `inert` behaviour, so this pins the structure; the Tab walk and the
// "scrollLeft = 300 is a no-op" check ran live.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";

rs.mock("./grid-canvas", () => ({
  GridCanvas: ({ widgets }: { widgets: { id: string }[] }) => (
    <button type="button">{widgets.map((w) => w.id).join(",")}</button>
  ),
}));

import type { DashboardLayout } from "../engine/types";
import { DashboardPager } from "./dashboard-pager";

afterEach(cleanup);

const layout: DashboardLayout = {
  version: 1,
  pages: [
    { id: "p1", widgets: [{ id: "a", type: "clock", size: "S", x: 0, y: 0, config: {} }] },
    { id: "p2", widgets: [{ id: "b", type: "clock", size: "S", x: 0, y: 0, config: {} }] },
  ],
};

function renderPager(activeIndex: number) {
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
      onPage={() => {}}
    />,
  );
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

  it("clips the viewport instead of hiding it, so it is no scroll container", () => {
    const { container } = renderPager(0);
    const viewport = container.firstElementChild as HTMLElement;
    expect(viewport.className).toMatch(/\boverflow-clip\b/);
    expect(viewport.className).not.toMatch(/\boverflow-hidden\b/);
  });
});
