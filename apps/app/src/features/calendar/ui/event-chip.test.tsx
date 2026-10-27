// AC7: every event is the house calendar chip (its calendar's tint and hue
// hairline, title then time); a one-line chip drops the time before the title
// truncates; past dims, selected rings. jsdom lays nothing out, so the
// "time drops first" contract is pinned as structure: one line, title first,
// the start time marked as the part that goes when there's no room.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";

import { EventChipView } from "./event-chip";
import { formatTimeOfDay } from "./time-format";

afterEach(cleanup);

const start = new Date(2026, 9, 22, 9, 0).getTime();
const end = new Date(2026, 9, 22, 10, 0).getTime();

const base = {
  title: "Board prep with Priya",
  startMs: start,
  endMs: end,
  hue: "blue" as const,
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

describe("house chip; title wins over time", () => {
  it("native and mirrored events both take their calendar's tint and hue hairline", () => {
    const { container, rerender } = render(<EventChipView {...base} hue="gray" />);
    expect(chipEl(container).dataset.label).toBe("gray");
    expect(chipEl(container).className).toContain("cal-chip");
    rerender(<EventChipView {...base} hue="amber" readOnly />);
    expect(chipEl(container).dataset.label).toBe("amber");
    expect(chipEl(container).className).toContain("cal-chip");
  });

  it("a tall chip reads title, then the time a step smaller", () => {
    const { container } = render(<EventChipView {...base} />);
    const title = container.querySelector<HTMLElement>("[data-chip-title]");
    const time = container.querySelector<HTMLElement>("[data-chip-time]");
    expect(title?.textContent).toBe("Board prep with Priya");
    expect(time?.textContent).toBe(`${formatTimeOfDay(start)} – ${formatTimeOfDay(end)}`);
    expect(time?.className).toContain("text-2xs");
    // Title comes first in reading order.
    expect(title!.compareDocumentPosition(time!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("a one-line chip shows title then start time, and the time is what drops first", () => {
    const { container } = render(<EventChipView {...base} compact />);
    const line = container.querySelector<HTMLElement>("[data-chip-line]");
    expect(line).not.toBeNull();
    const title = line!.querySelector<HTMLElement>("[data-chip-title]");
    const time = line!.querySelector<HTMLElement>("[data-chip-time]");
    expect(title?.textContent).toBe("Board prep with Priya");
    expect(time?.textContent).toBe(formatTimeOfDay(start));
    expect(time?.dataset.drop).toBe("first");
    expect(title!.compareDocumentPosition(time!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("past events dim and lose the hairline; the selected one has the ring", () => {
    const { container, rerender } = render(<EventChipView {...base} past />);
    expect(chipEl(container).dataset.past).toBe("true");
    rerender(<EventChipView {...base} selected />);
    expect(chipEl(container).dataset.selected).toBe("true");
    expect(chipEl(container).className).toContain("ring-2");
    expect(chipEl(container).dataset.past).toBeUndefined();
  });

  it("an overnight piece carries its continuation note", () => {
    const { getByText } = render(<EventChipView {...base} continuation="→ Thu 7:10" />);
    getByText("→ Thu 7:10");
  });
});
