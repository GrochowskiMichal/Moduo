// TV-U4 (AC11.4, default m) — a sorted project view says so under the
// toolbar, and its action goes back to manual order.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { sortedByLabel } from "../order";
import { SortedOrderLine } from "./plan-view-header";

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
