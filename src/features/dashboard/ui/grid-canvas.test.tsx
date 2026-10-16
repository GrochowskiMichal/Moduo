// MOD-163 — Home's grid with the real pager around it: a sideways swipe over a
// widget reaches the pager and turns the page (each widget used to swallow its
// own wheel, so only the gaps paged), and the grid's gap is the panels' token.
// The widget's own body is mocked; jsdom has no layout, so the 8 px itself was
// measured live.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

rs.mock("./widget-frame", () => ({
  WidgetFrame: ({ widget }: { widget: { id: string } }) => (
    <div data-testid={`widget-${widget.id}`}>body</div>
  ),
}));
// jsdom has no matchMedia; the grid's FLIP timing is beside the point here.
rs.mock("../motion", () => ({
  useGridMotion: () => ({ duration: 0, ease: [0, 0, 1, 1] }),
}));

import type { DashboardLayout } from "../engine/types";
import { DashboardPager } from "./dashboard-pager";
import { GridCanvas } from "./grid-canvas";

afterEach(cleanup);

const layout: DashboardLayout = {
  version: 1,
  pages: [
    { id: "p1", widgets: [{ id: "a", type: "clock", size: "S", x: 0, y: 0, config: {} }] },
    { id: "p2", widgets: [{ id: "b", type: "clock", size: "S", x: 0, y: 0, config: {} }] },
  ],
};

describe("GridCanvas in the pager (MOD-163)", () => {
  it("lets a sideways swipe over a widget turn the page", () => {
    const onPage = rs.fn();
    render(
      <DashboardPager
        layout={layout}
        activeIndex={0}
        editing={false}
        drag={null}
        gridRef={() => {}}
        onWidgetPointerDown={() => {}}
        onRemove={() => {}}
        onResize={() => {}}
        onPage={onPage}
      />,
    );
    fireEvent.wheel(screen.getByTestId("widget-a"), { deltaX: 80, deltaY: 0 });
    expect(onPage).toHaveBeenCalledWith(1);
  });

  it("spaces the widgets by the panels' gap token", () => {
    const { container } = render(<GridCanvas widgets={layout.pages[0].widgets} />);
    const grid = container.firstElementChild as HTMLElement;
    expect(grid.className).toMatch(/(^|\s)gap-\(--panel-gap\)(\s|$)/);
  });
});
