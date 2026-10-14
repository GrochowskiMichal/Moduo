// TV-U4 (AC11.4, default m) — a sorted project view says so under the
// toolbar, and its action goes back to manual order. MOD-95 — a project's
// title opens its details, with its ⋯ beside it.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import { TooltipProvider } from "../../../components/ui/tooltip";
import { sortedByLabel } from "../order";
import { PlanViewHeader, SortedOrderLine } from "./plan-view-header";

afterEach(cleanup);

describe("SortedOrderLine", () => {
  it("reads “Sorted by due date · Back to manual order”, and the action switches back", () => {
    const onManualOrder = rs.fn();
    render(<SortedOrderLine label={sortedByLabel("due")} onManualOrder={onManualOrder} />);
    expect(screen.getByText("Sorted by due date")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to manual order" }));
    expect(onManualOrder).toHaveBeenCalledOnce();
  });
});

describe("a project's title and ⋯ (MOD-95, round-2b)", () => {
  const header = (project?: { onOpenDetails: () => void; onEditStatuses?: () => void }) =>
    render(
      <TooltipProvider>
        <PlanViewHeader
          title="Website"
          view="list"
          onViewChange={() => {}}
          controls={{ count: 7, project }}
          canEdit
          onRequestCapture={() => {}}
        />
      </TooltipProvider>,
    );

  it("opens Project details from the title, which stays the page's heading", () => {
    const onOpenDetails = rs.fn();
    header({ onOpenDetails });
    const heading = screen.getByRole("heading", { level: 1, name: "Website" });
    fireEvent.click(within(heading).getByRole("button", { name: "Website" }));
    expect(onOpenDetails).toHaveBeenCalledOnce();
  });

  it("offers Project details and Statuses… in the ⋯", async () => {
    const onOpenDetails = rs.fn();
    const onEditStatuses = rs.fn();
    header({ onOpenDetails, onEditStatuses });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Project actions" }), {
      button: 0,
      pointerType: "mouse",
    });
    const menu = await screen.findByRole("menu");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((i) => i.textContent),
    ).toEqual(["Project details", "Statuses…"]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Statuses…" }));
    expect(onEditStatuses).toHaveBeenCalledOnce();
  });

  it("leaves Statuses… out without edit access, and a plain title elsewhere", async () => {
    header({ onOpenDetails: () => {} });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Project actions" }), {
      button: 0,
      pointerType: "mouse",
    });
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: "Statuses…" })).toBeNull();
    cleanup();
    header();
    const heading = screen.getByRole("heading", { level: 1, name: "Website" });
    expect(within(heading).queryByRole("button")).toBeNull();
    expect(screen.queryByRole("button", { name: "Project actions" })).toBeNull();
  });
});
