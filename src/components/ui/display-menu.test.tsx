// DS-4 — DisplayMenu renders its controls from a module config (segmented,
// select, toggles) and edits one plain value object; Reset restores the
// defaults and is off while nothing differs.
import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Columns3, List } from "lucide-react";
import { useState } from "react";

import { type DisplayControl, DisplayMenu } from "./display-menu";
import { TooltipProvider } from "./tooltip";

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

type View = { layout: string; groupBy: string; completed: string; properties: string[] };
const DEFAULTS: View = {
  layout: "list",
  groupBy: "bucket",
  completed: "hidden",
  properties: ["priority", "due"],
};
const CONTROLS: DisplayControl<View>[] = [
  {
    type: "segmented",
    id: "layout",
    label: "Layout",
    iconOnly: true,
    options: [
      { value: "list", label: "List", icon: List },
      { value: "board", label: "Board", icon: Columns3 },
    ],
  },
  {
    type: "select",
    id: "groupBy",
    label: "Group by",
    options: [
      { value: "none", label: "None" },
      { value: "bucket", label: "Bucket" },
      { value: "priority", label: "Priority" },
    ],
  },
  {
    type: "segmented",
    id: "completed",
    label: "Completed",
    options: [
      { value: "hidden", label: "Hidden" },
      { value: "7d", label: "7 days" },
      { value: "all", label: "All" },
    ],
  },
  {
    type: "toggles",
    id: "properties",
    label: "Show on rows",
    options: [
      { value: "priority", label: "Priority" },
      { value: "energy", label: "Energy" },
      { value: "due", label: "Due" },
    ],
  },
];

function Harness({ initial = DEFAULTS }: { initial?: View }) {
  const [value, setValue] = useState(initial);
  return (
    <TooltipProvider>
      <DisplayMenu
        controls={CONTROLS}
        value={value}
        onValueChange={setValue}
        defaultValue={DEFAULTS}
        defaultOpen
      />
      <output data-testid="state">{JSON.stringify(value)}</output>
    </TooltipProvider>
  );
}

const state = () => JSON.parse(screen.getByTestId("state").textContent ?? "{}") as View;

describe("DisplayMenu", () => {
  it("opens from its default 'Display' trigger", () => {
    render(
      <TooltipProvider>
        <DisplayMenu controls={CONTROLS} value={DEFAULTS} onValueChange={() => {}} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("dialog", { name: "Display options" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Display" }));
    expect(screen.getByRole("dialog", { name: "Display options" })).toBeTruthy();
  });

  it("renders every control from the config, labelled", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Layout" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Group by" }).textContent).toContain("Bucket");
    expect(screen.getByRole("radiogroup", { name: "Completed" })).toBeTruthy();
    const props = screen.getByRole("group", { name: "Show on rows" });
    const pressed = (name: string) =>
      within(props).getByRole("button", { name }).getAttribute("aria-pressed");
    expect(pressed("Priority")).toBe("true");
    expect(pressed("Energy")).toBe("false");
  });

  it("edits a segmented value", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("radio", { name: "7 days" }));
    expect(state().completed).toBe("7d");
    fireEvent.click(screen.getByRole("radio", { name: "Board" }));
    expect(state().layout).toBe("board");
  });

  it("edits a select value", () => {
    render(<Harness />);
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Group by" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Priority" }));
    expect(state().groupBy).toBe("priority");
  });

  it("toggles properties, keeping the config's order", () => {
    render(<Harness />);
    const props = screen.getByRole("group", { name: "Show on rows" });
    fireEvent.click(within(props).getByRole("button", { name: "Energy" }));
    expect(state().properties).toEqual(["priority", "energy", "due"]);
    fireEvent.click(within(props).getByRole("button", { name: "Priority" }));
    expect(state().properties).toEqual(["energy", "due"]);
  });

  it("resets to the defaults, and Reset is off while nothing differs", () => {
    render(<Harness initial={{ ...DEFAULTS, completed: "all", properties: ["due"] }} />);
    const reset = () =>
      screen.getByRole("button", { name: "Reset to default" }) as HTMLButtonElement;
    expect(reset().disabled).toBe(false);
    fireEvent.click(reset());
    expect(state()).toEqual(DEFAULTS);
    expect(reset().disabled).toBe(true);
  });

  it("treats the same properties in another order as unchanged", () => {
    render(<Harness initial={{ ...DEFAULTS, properties: ["due", "priority"] }} />);
    expect(
      (screen.getByRole("button", { name: "Reset to default" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
