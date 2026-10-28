// Focus time on the grid (CALR-14, AC23): a quiet band with the calendar focus
// edge (accent while live or selected), a "Focus" eyebrow, and a task mark
// when it holds a task. jsdom lays nothing out, so the band and its edge are
// pinned as structure (data-kind) the global CSS draws from.
process.env.TZ = "Europe/Warsaw";

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";

import { EventChipView } from "./event-chip";

afterEach(cleanup);

const base = {
  title: "Investor deck",
  startMs: new Date(2026, 10, 3, 14, 0).getTime(),
  endMs: new Date(2026, 10, 3, 16, 0).getTime(),
  hue: "gray" as const,
  compact: false,
  readOnly: false,
  recurring: false,
  selected: false,
  past: false,
};

function chipEl(container: HTMLElement): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-chip="event"]');
  if (!el) throw new Error("no event chip rendered");
  return el;
}

describe("focus is a band with the focus edge", () => {
  it("a focus chip is marked as focus, an ordinary one isn't", () => {
    const { container, rerender } = render(<EventChipView {...base} focus />);
    expect(chipEl(container).dataset.kind).toBe("focus");
    rerender(<EventChipView {...base} />);
    expect(chipEl(container).dataset.kind).toBeUndefined();
  });

  it("a tall focus chip carries the Focus eyebrow over its title", () => {
    const { container } = render(<EventChipView {...base} focus />);
    const eyebrow = container.querySelector<HTMLElement>("[data-focus-eyebrow]");
    expect(eyebrow?.textContent).toContain("Focus");
    expect(container.querySelector("[data-chip-title]")?.textContent).toBe("Investor deck");
  });

  it("holding a task, it shows the task mark; holding nothing, it doesn't", () => {
    const { container, rerender } = render(<EventChipView {...base} focus holdsTask />);
    expect(container.querySelector('[data-mark="task"]')).not.toBeNull();
    expect(chipEl(container).title).toContain("holds a task");
    rerender(<EventChipView {...base} focus />);
    expect(container.querySelector('[data-mark="task"]')).toBeNull();
  });

  it("a one-line focus chip reads 'Focus · title'", () => {
    const { container } = render(<EventChipView {...base} focus compact />);
    expect(container.querySelector("[data-chip-title]")?.textContent).toBe("Focus · Investor deck");
  });

  it("a teammate's masked focus time reads just 'Focus time'", () => {
    const { container } = render(<EventChipView {...base} title="Focus time" focus compact />);
    expect(container.querySelector("[data-chip-title]")?.textContent).toBe("Focus time");
  });

  it("selected or live, the edge takes the accent (the CSS reads data-selected / data-live)", () => {
    const { container } = render(<EventChipView {...base} focus selected />);
    expect(chipEl(container).dataset.kind).toBe("focus");
    expect(chipEl(container).dataset.selected).toBe("true");
  });
});
