// TV-U4 (AC11.4, default m) — a sorted project view says so under the
// toolbar, and its action goes back to manual order. MOD-95 — a project's
// title opens its details, with its ⋯ beside it.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import { DisplayMenu } from "../../../components/ui/display-menu";
import { FilterButton } from "../../../components/ui/filter-bar";
import { TooltipProvider } from "../../../components/ui/tooltip";
import { sortedByLabel } from "../order";
import { PlanViewHeader, SortedOrderLine } from "./plan-view-header";
import { ViewSaveControl } from "./saved-view-parts";

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

describe("a narrow toolbar keeps the title (MOD-95 follow-up)", () => {
  // jsdom runs no container queries: these pin the rules the browser applies.
  it("gives the title group the first claim on room, and lets the controls wrap under it", () => {
    render(
      <TooltipProvider>
        <PlanViewHeader
          title="Website relaunch for the spring campaign"
          view="list"
          onViewChange={() => {}}
          controls={{
            count: 12,
            project: { onOpenDetails: () => {} },
            filter: <FilterButton dimensions={[]} value={[]} onValueChange={() => {}} />,
            display: <DisplayMenu controls={[]} value={{}} onValueChange={() => {}} />,
          }}
          canEdit
          onRequestCapture={() => {}}
        />
      </TooltipProvider>,
    );
    const title = document.querySelector("[data-slot=plan-title]") as HTMLElement;
    // About ten characters with its ⋯ and count, then all the room left.
    expect(title.className).toContain("basis-40");
    expect(title.className).toContain("grow");
    expect(title.contains(screen.getByText("12"))).toBe(true);
    const toolbar = screen.getByRole("toolbar");
    expect(toolbar.className).toContain("flex-wrap");
    expect(toolbar.parentElement?.className).toContain("@container");
    const controls = document.querySelector("[data-slot=plan-controls]") as HTMLElement;
    expect(controls.className).toContain("ml-auto");
    // Under 36rem Filter and Display hide their words but keep their names.
    for (const name of ["Filter", "Display"]) {
      const button = screen.getByRole("button", { name });
      expect(within(button).getByText(name).className).toContain("@max-xl:sr-only");
    }
  });
});

describe("a saved view's Save in the toolbar (MOD-142)", () => {
  it("sits among the controls, after Search · Filter · Display and before the view switch", () => {
    render(
      <TooltipProvider>
        <PlanViewHeader
          title="Waiting"
          view="list"
          onViewChange={() => {}}
          controls={{
            count: 3,
            filter: <FilterButton dimensions={[]} value={[]} onValueChange={() => {}} />,
            viewSave: (
              <button type="button" data-testid="view-save">
                Save
              </button>
            ),
          }}
          canEdit
          onRequestCapture={() => {}}
        />
      </TooltipProvider>,
    );
    const controls = document.querySelector("[data-slot=plan-controls]") as HTMLElement;
    const save = screen.getByTestId("view-save");
    expect(controls.contains(save)).toBe(true);
    const inOrder = Array.from(controls.querySelectorAll("button, [role=radiogroup]"));
    const at = (el: Element) => inOrder.indexOf(el);
    expect(at(save)).toBeGreaterThan(at(screen.getByRole("button", { name: "Filter" })));
    expect(at(save)).toBeLessThan(at(screen.getByRole("radiogroup", { name: "View" })));
  });

  /** A view with unsaved changes until Save or Revert. */
  function SavingHeader() {
    const [dirty, setDirty] = useState(true);
    const done = () => setDirty(false);
    return (
      <TooltipProvider>
        <PlanViewHeader
          title="Waiting"
          view="list"
          onViewChange={() => {}}
          controls={{
            display: (
              <button type="button" data-testid="display">
                Display
              </button>
            ),
            viewSave: dirty ? (
              <ViewSaveControl
                primary={{ label: "Save", onSelect: done }}
                more={[{ label: "Revert changes", onSelect: done }]}
              />
            ) : undefined,
          }}
          canEdit
          onRequestCapture={() => {}}
        />
      </TooltipProvider>
    );
  }
  const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 80)));

  it("after Save, focus moves to Display, not the page", async () => {
    render(<SavingHeader />);
    const save = screen.getByRole("button", { name: "Save" });
    save.focus();
    fireEvent.click(save);
    await settle();
    expect(screen.queryByTestId("view-changes")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("display"));
  });

  it("after Revert changes from its ▾, focus moves to Display, not the page", async () => {
    render(<SavingHeader />);
    fireEvent.pointerDown(screen.getByRole("button", { name: "More ways to save" }), {
      button: 0,
      pointerType: "mouse",
    });
    const menu = await screen.findByRole("menu");
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Revert changes" }));
    // The menu closes, then Revert runs, then the control goes.
    await settle();
    await settle();
    expect(screen.queryByTestId("view-changes")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("display"));
  });

  it("leaves focus alone when it had moved elsewhere", async () => {
    function Elsewhere() {
      const [dirty, setDirty] = useState(true);
      return (
        <TooltipProvider>
          <button type="button" onClick={() => setDirty(false)}>
            Another place
          </button>
          <PlanViewHeader
            title="Waiting"
            view="list"
            onViewChange={() => {}}
            controls={{
              display: <button type="button">Display</button>,
              viewSave: dirty ? (
                <ViewSaveControl primary={{ label: "Save", onSelect: () => {} }} />
              ) : undefined,
            }}
            canEdit
            onRequestCapture={() => {}}
          />
        </TooltipProvider>
      );
    }
    render(<Elsewhere />);
    const other = screen.getByRole("button", { name: "Another place" });
    other.focus();
    fireEvent.click(other);
    await settle();
    expect(document.activeElement).toBe(other);
  });
});
