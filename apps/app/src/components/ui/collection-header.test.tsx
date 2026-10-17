// MOD-152 · The collection header the task details, the Project view, time
// entries and templates share: its count is the tertiary text level (round-2b
// `.shead .num`, the frames' `--text-3`), and 4 px sit between it and the rows
// under it, never under an empty collection.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import { CollectionHeader } from "./collection-header";

afterEach(cleanup);

/** The 4 px rule: it applies when the next sibling holds something. */
const SPACED = "[&:has(+:not(:empty))]:mb-1";

describe("CollectionHeader", () => {
  it("puts its count on the tertiary level, the label on the primary", () => {
    render(<CollectionHeader label="Subtasks" count="1/3" />);
    const header = document.querySelector("[data-slot=collection-header]") as HTMLElement;
    expect(header.className).toContain("text-foreground");
    expect(header.className).toContain("text-sm");
    expect(header.className).toContain("font-medium");
    const count = screen.getByText("1/3");
    expect(count.className).toContain("text-subtle-foreground");
    expect(count.className).not.toContain("text-muted-foreground");
    expect(count.className).toContain("tabular-nums");
  });

  it("leaves 4 px under itself only when rows follow", () => {
    render(
      <>
        <section>
          <CollectionHeader label="With rows" count={1} />
          <ul>
            <li>A row</li>
          </ul>
        </section>
        <section>
          <CollectionHeader label="Empty list" count={0} />
          <ul />
        </section>
        <section>
          <CollectionHeader label="Alone" />
        </section>
      </>,
    );
    const [withRows, empty, alone] = [
      ...document.querySelectorAll<HTMLElement>("[data-slot=collection-header]"),
    ];
    for (const header of [withRows, empty, alone]) expect(header.className).toContain(SPACED);
    // The selector the class compiles to, as the browser reads it.
    expect(withRows.matches(":has(+ :not(:empty))")).toBe(true);
    expect(empty.matches(":has(+ :not(:empty))")).toBe(false);
    expect(alone.matches(":has(+ :not(:empty))")).toBe(false);
  });
});
