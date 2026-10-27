// AC10: the now line runs over the grid (above every event card), and the
// meeting in progress carries it across faintly with a tick, its title on top,
// and says "happening now" to screen readers.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";

import { GRID_LAYER } from "../grid-layout";
import { EventChipView } from "./event-chip";
import { NowLine } from "./now-line";

afterEach(cleanup);

const start = new Date(2026, 9, 22, 10, 0).getTime();
const end = new Date(2026, 9, 22, 11, 0).getTime();

const chip = {
  title: "Legal review with Tom",
  startMs: start,
  endMs: end,
  hue: "blue" as const,
  compact: false,
  readOnly: false,
  recurring: false,
  selected: false,
  past: false,
};

describe("now line and the live meeting", () => {
  it("the line sits over every event card, and the live card over the line", () => {
    expect(GRID_LAYER.now).toBeGreaterThan(GRID_LAYER.chipMax);
    expect(GRID_LAYER.now).toBeGreaterThan(GRID_LAYER.overflow);
    expect(GRID_LAYER.live).toBeGreaterThan(GRID_LAYER.now);
    const { container } = render(<NowLine minutes={10.5 * 60} />);
    const line = container.querySelector<HTMLElement>("[data-now-line]");
    expect(line).not.toBeNull();
    expect(line!.getAttribute("aria-hidden")).toBe("true");
    expect(Number(line!.style.zIndex)).toBe(GRID_LAYER.now);
  });

  it("the meeting in progress carries a faint line and tick at now, and says so", () => {
    const { container, getByText } = render(<EventChipView {...chip} nowFraction={0.5} />);
    const el = container.querySelector<HTMLElement>('[data-chip="event"]');
    expect(el?.dataset.live).toBe("true");
    const tick = container.querySelector<HTMLElement>("[data-now-tick]");
    expect(tick).not.toBeNull();
    expect(tick!.getAttribute("aria-hidden")).toBe("true");
    expect(tick!.style.top).toBe("50%");
    getByText(/happening now/);
    // The title stays readable: it's still the chip's text, not covered by the tick.
    expect(container.querySelector("[data-chip-title]")?.textContent).toBe("Legal review with Tom");
  });

  it("a meeting that isn't in progress carries neither", () => {
    const { container, queryByText } = render(<EventChipView {...chip} />);
    expect(container.querySelector("[data-now-tick]")).toBeNull();
    expect(container.querySelector<HTMLElement>('[data-chip="event"]')?.dataset.live).toBeUndefined();
    expect(queryByText(/happening now/)).toBeNull();
  });
});
