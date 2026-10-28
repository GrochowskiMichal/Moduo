process.env.TZ = "Europe/Warsaw";

// A booking link's open times dashed on the week while its view is open
// (CALR-17, specs/calendar-rethink.md AC31). The layer lives in the hours
// grid's own CSS grid, like the placement layer: one outline per open time in
// a shown day, none for times outside the days shown, and never in the way of
// the grid's pointer (it draws, it doesn't catch clicks).

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";

import { BookingOpenLayer } from "./booking-open-layer";

afterEach(cleanup);

const day = (d: number) => new Date(2030, 2, d);
const at = (d: number, h: number, m = 0) => new Date(2030, 2, d, h, m).getTime();

const DAYS = [day(4), day(5), day(6)];

describe("BookingOpenLayer", () => {
  it("draws one dashed outline per open time in the days shown", () => {
    const { container } = render(
      <BookingOpenLayer
        days={DAYS}
        times={[
          { startMs: at(4, 9), endMs: at(4, 9, 30) },
          { startMs: at(4, 10), endMs: at(4, 10, 30) },
          { startMs: at(6, 14), endMs: at(6, 15) },
        ]}
      />,
    );
    const outlines = container.querySelectorAll("[data-open-time]");
    expect(outlines).toHaveLength(3);
    for (const el of outlines) expect(el.className).toContain("border-dashed");
  });

  it("leaves out times on days that aren't shown", () => {
    const { container } = render(
      <BookingOpenLayer
        days={DAYS}
        times={[
          { startMs: at(3, 9), endMs: at(3, 9, 30) },
          { startMs: at(5, 9), endMs: at(5, 9, 30) },
          { startMs: at(9, 9), endMs: at(9, 9, 30) },
        ]}
      />,
    );
    expect(container.querySelectorAll("[data-open-time]")).toHaveLength(1);
  });

  it("is decoration only: hidden from assistive tech and not catching the pointer", () => {
    const { container } = render(
      <BookingOpenLayer days={DAYS} times={[{ startMs: at(4, 9), endMs: at(4, 9, 30) }]} />,
    );
    const outline = container.querySelector("[data-open-time]") as HTMLElement;
    expect(outline.closest("[aria-hidden='true']")).not.toBeNull();
    expect(outline.className).toContain("pointer-events-none");
  });

  it("draws nothing without open times", () => {
    const { container } = render(<BookingOpenLayer days={DAYS} times={[]} />);
    expect(container.querySelectorAll("[data-open-time]")).toHaveLength(0);
  });
});
