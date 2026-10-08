// DS-4 — FilterBar/FilterChip/FilterMenu are generic over a module-provided
// dimension registry: chips read as sentences, each segment edits the
// condition, "+ Filter" goes dimension → value with type-to-jump, and the pure
// model keeps conditions valid and filters items.
import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";

import { FilterBar, FilterButton } from "./filter-bar";
import {
  conditionValueText,
  type FilterCondition,
  type FilterDimension,
  matchesFilters,
  normalizeCondition,
  operatorsFor,
  sanitizeConditions,
  toggleFilterValue,
} from "./filter-model";

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

const ASSIGNEE: FilterDimension = {
  id: "assignee",
  label: "Assignee",
  options: [
    { value: "me", label: "Me" },
    { value: "ola", label: "Ola", keywords: ["ola@example.com"] },
    { value: "none", label: "Unassigned" },
  ],
};
const TAG: FilterDimension = {
  id: "tag",
  label: "Tag",
  options: [
    { value: "ui", label: "UI" },
    { value: "fix", label: "fix" },
    { value: "docs", label: "docs" },
  ],
};
const BLOCKED: FilterDimension = {
  id: "blocked",
  label: "Blocked",
  operators: ["is"],
  multiple: false,
  options: [
    { value: "yes", label: "Yes" },
    { value: "no", label: "No" },
  ],
};
const DIMENSIONS = [ASSIGNEE, TAG, BLOCKED];

describe("filter model", () => {
  it("turns 'is' into 'is any of' at two values and back at one", () => {
    expect(
      normalizeCondition({ dimension: "tag", operator: "is", values: ["ui", "fix"] }, TAG),
    ).toMatchObject({ operator: "any_of" });
    expect(
      normalizeCondition({ dimension: "tag", operator: "any_of", values: ["ui"] }, TAG),
    ).toMatchObject({ operator: "is" });
    expect(
      normalizeCondition({ dimension: "tag", operator: "is_not", values: ["ui", "fix"] }, TAG),
    ).toMatchObject({ operator: "is_not" });
  });

  it("drops a condition with no values and dedupes values", () => {
    expect(normalizeCondition({ dimension: "tag", operator: "is", values: [] }, TAG)).toBeNull();
    expect(
      normalizeCondition({ dimension: "tag", operator: "is", values: ["ui", "ui"] }, TAG)?.values,
    ).toEqual(["ui"]);
  });

  it("keeps one value and the offered operator on a single-pick yes/no dimension", () => {
    expect(
      normalizeCondition(
        { dimension: "blocked", operator: "is_not", values: ["no", "yes"] },
        BLOCKED,
      ),
    ).toEqual({ dimension: "blocked", operator: "is", values: ["yes"] });
    expect(operatorsFor(BLOCKED, 1)).toEqual(["is"]);
  });

  it("offers the operators that fit the value count", () => {
    expect(operatorsFor(TAG, 1)).toEqual(["is", "is_not"]);
    expect(operatorsFor(TAG, 2)).toEqual(["any_of", "is_not"]);
  });

  it("toggles a value onto a dimension's one condition, creating and removing it", () => {
    let conditions = toggleFilterValue([], TAG, "ui");
    expect(conditions).toEqual([{ dimension: "tag", operator: "is", values: ["ui"] }]);
    conditions = toggleFilterValue(conditions, TAG, "fix");
    expect(conditions).toEqual([{ dimension: "tag", operator: "any_of", values: ["ui", "fix"] }]);
    conditions = toggleFilterValue(toggleFilterValue(conditions, TAG, "ui"), TAG, "fix");
    expect(conditions).toEqual([]);
  });

  it("replaces the value on a single-pick dimension", () => {
    const conditions = toggleFilterValue(toggleFilterValue([], BLOCKED, "yes"), BLOCKED, "no");
    expect(conditions).toEqual([{ dimension: "blocked", operator: "is", values: ["no"] }]);
  });

  it("sanitises stored conditions: unknown dimensions, bad operators and junk are dropped", () => {
    const raw = [
      { dimension: "tag", operator: "is", values: ["ui", 4, "fix"] },
      { dimension: "gone", operator: "is", values: ["x"] },
      { dimension: "assignee", operator: "contains", values: ["me"] },
      { dimension: "assignee", operator: "is", values: [] },
      "junk",
      null,
    ];
    expect(sanitizeConditions(raw, DIMENSIONS)).toEqual([
      { dimension: "tag", operator: "any_of", values: ["ui", "fix"] },
    ]);
    expect(sanitizeConditions("{not an array", DIMENSIONS)).toEqual([]);
  });

  it("matches items: is / any of share a value, is not shares none, AND across conditions", () => {
    const task = { assignee: ["me"], tag: ["ui", "docs"] };
    const valuesOf = (t: typeof task, dim: string) => (t as Record<string, string[]>)[dim] ?? [];
    const is = (
      dimension: string,
      values: string[],
      operator: FilterCondition["operator"] = "is",
    ) => ({
      dimension,
      operator,
      values,
    });
    expect(matchesFilters(task, [is("assignee", ["me"])], valuesOf)).toBe(true);
    expect(matchesFilters(task, [is("tag", ["fix", "docs"], "any_of")], valuesOf)).toBe(true);
    expect(matchesFilters(task, [is("tag", ["fix"], "is_not")], valuesOf)).toBe(true);
    expect(matchesFilters(task, [is("tag", ["ui", "fix"], "is_not")], valuesOf)).toBe(false);
    expect(matchesFilters(task, [is("assignee", ["me"]), is("tag", ["fix"])], valuesOf)).toBe(
      false,
    );
    expect(matchesFilters(task, [], valuesOf)).toBe(true);
  });

  it("shortens the chip's value text after two labels", () => {
    expect(
      conditionValueText(
        { dimension: "tag", operator: "any_of", values: ["ui", "fix", "docs"] },
        TAG,
      ),
    ).toBe("UI, fix +1");
  });
});

function Harness({
  initial,
  onChange,
}: {
  initial: FilterCondition[];
  onChange?: (next: FilterCondition[]) => void;
}) {
  const [value, setValue] = useState(initial);
  const update = (next: FilterCondition[]) => {
    setValue(next);
    onChange?.(next);
  };
  return (
    <>
      <FilterButton dimensions={DIMENSIONS} value={value} onValueChange={update} />
      <FilterBar
        dimensions={DIMENSIONS}
        value={value}
        onValueChange={update}
        matchCount={23}
        totalCount={76}
      />
      <output data-testid="state">{JSON.stringify(value)}</output>
    </>
  );
}

const state = () =>
  JSON.parse(screen.getByTestId("state").textContent ?? "[]") as FilterCondition[];

describe("FilterBar", () => {
  it("renders nothing while no filter is active", () => {
    const { container } = render(
      <FilterBar dimensions={DIMENSIONS} value={[]} onValueChange={() => {}} />,
    );
    expect(container.querySelector('[data-slot="filter-bar"]')).toBeNull();
  });

  it("reads each condition as a sentence and shows 'N of M · Clear'", () => {
    render(
      <Harness
        initial={[
          { dimension: "assignee", operator: "is", values: ["me"] },
          { dimension: "tag", operator: "any_of", values: ["ui", "fix"] },
        ]}
      />,
    );
    const assignee = screen.getByRole("group", { name: "Assignee is Me" });
    expect(within(assignee).getByText("Assignee")).toBeTruthy();
    expect(within(assignee).getByText("is")).toBeTruthy();
    expect(within(assignee).getByText("Me")).toBeTruthy();
    expect(screen.getByRole("group", { name: "Tag is any of UI, fix" })).toBeTruthy();
    expect(screen.getByText("23 of 76")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(state()).toEqual([]);
  });

  it("gives a stale dimension no chip, but keeps Clear so it can't hide rows unseen", () => {
    render(<Harness initial={[{ dimension: "gone", operator: "is", values: ["x"] }]} />);
    expect(screen.queryByRole("group")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(state()).toEqual([]);
  });

  it("moves focus to '+ Filter' when a chip is removed", () => {
    render(
      <Harness
        initial={[
          { dimension: "assignee", operator: "is", values: ["me"] },
          { dimension: "tag", operator: "is", values: ["ui"] },
        ]}
      />,
    );
    const remove = screen.getByRole("button", { name: "Remove filter: Assignee is Me" });
    remove.focus();
    fireEvent.click(remove);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Add filter" }));
  });

  it("removes a condition with its ×", () => {
    render(
      <Harness
        initial={[
          { dimension: "assignee", operator: "is", values: ["me"] },
          { dimension: "tag", operator: "is", values: ["ui"] },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove filter: Assignee is Me" }));
    expect(state()).toEqual([{ dimension: "tag", operator: "is", values: ["ui"] }]);
  });

  it("changes the operator from its segment", () => {
    render(<Harness initial={[{ dimension: "assignee", operator: "is", values: ["me"] }]} />);
    fireEvent.keyDown(screen.getByRole("button", { name: "Operator: is" }), { key: "Enter" });
    fireEvent.click(screen.getByRole("menuitemradio", { name: "is not" }));
    expect(state()).toEqual([{ dimension: "assignee", operator: "is_not", values: ["me"] }]);
  });

  it("shows the operator as plain text when the dimension offers only one", () => {
    render(<Harness initial={[{ dimension: "blocked", operator: "is", values: ["yes"] }]} />);
    expect(screen.queryByRole("button", { name: /^Operator/ })).toBeNull();
  });

  it("adds a value from the value segment, and the operator follows the count", () => {
    render(<Harness initial={[{ dimension: "tag", operator: "is", values: ["ui"] }]} />);
    fireEvent.click(screen.getByRole("button", { name: "Tag values: UI" }));
    fireEvent.click(screen.getByRole("option", { name: "fix" }));
    expect(state()).toEqual([{ dimension: "tag", operator: "any_of", values: ["ui", "fix"] }]);
    expect(screen.getByRole("group", { name: "Tag is any of UI, fix" })).toBeTruthy();
  });
});

describe("FilterMenu", () => {
  it("matches what you read, not internal ids", () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    const search = screen.getByRole("combobox", { name: "Filter by" });
    // "up" is in no label, though it is in "jump:…" item ids.
    fireEvent.change(search, { target: { value: "up" } });
    expect(screen.queryAllByRole("option")).toEqual([]);
    expect(screen.getByText("No matches.")).toBeTruthy();
    // "me" finds Assignee › Me, not the Tag dimension (its id is "dimension:tag").
    fireEvent.change(search, { target: { value: "me" } });
    const names = screen
      .getAllByRole("option")
      .map((o) => o.getAttribute("aria-label") ?? o.textContent);
    expect(names).toContain("Assignee › Me");
    expect(names).not.toContain("Tag");
  });

  it("starts on the dimension list again after its parent closes it", () => {
    function Controlled() {
      const [open, setOpen] = useState(true);
      const [value, setValue] = useState<FilterCondition[]>([]);
      return (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)}>
            toggle
          </button>
          <FilterButton
            dimensions={DIMENSIONS}
            value={value}
            onValueChange={setValue}
            open={open}
            onOpenChange={setOpen}
          />
        </>
      );
    }
    render(<Controlled />);
    fireEvent.click(screen.getByRole("option", { name: "Tag" }));
    expect(screen.getByRole("option", { name: "UI" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByRole("option", { name: "Assignee" })).toBeTruthy();
  });

  it("goes dimension → value from the toolbar button, which then counts the filters", () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("option", { name: "Assignee" }));
    fireEvent.click(screen.getByRole("option", { name: "Ola" }));
    expect(state()).toEqual([{ dimension: "assignee", operator: "is", values: ["ola"] }]);
    // A multi-value dimension keeps the menu open for a second pick.
    fireEvent.click(screen.getByRole("option", { name: "Me" }));
    expect(state()).toEqual([{ dimension: "assignee", operator: "any_of", values: ["ola", "me"] }]);
    expect(screen.getByRole("button", { name: "Filter, 1 active" })).toBeTruthy();
  });

  it("jumps straight to a value by typing, matching its keywords too", () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by" }), {
      target: { value: "ola@" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Assignee › Ola/ }));
    expect(state()).toEqual([{ dimension: "assignee", operator: "is", values: ["ola"] }]);
  });

  it("closes after a pick on a single-value dimension", () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("option", { name: "Blocked" }));
    fireEvent.click(screen.getByRole("option", { name: "Yes" }));
    expect(state()).toEqual([{ dimension: "blocked", operator: "is", values: ["yes"] }]);
    expect(screen.queryByRole("option", { name: "No" })).toBeNull();
  });

  it("steps back to the dimension list on Backspace in an empty search", () => {
    render(<Harness initial={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "Filter" }));
    fireEvent.click(screen.getByRole("option", { name: "Tag" }));
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Filter by Tag" }), {
      key: "Backspace",
    });
    expect(screen.getByRole("option", { name: "Assignee" })).toBeTruthy();
  });
});
