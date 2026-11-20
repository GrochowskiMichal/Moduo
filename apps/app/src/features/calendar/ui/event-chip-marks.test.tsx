// AC2 on the chip: an event from an account that didn't sync carries the sync
// mark and keeps full strength (timed, one-line and all-day alike). Offline,
// a change waiting to sync carries the cloud-off mark, which is a different
// mark from the stale one.

import { afterEach, describe, expect, it } from "@rstest/core";
import { cleanup, render, screen } from "@testing-library/react";

import type { EventChip } from "../events";
import { localDayKey } from "../lens";
import { AllDayLane } from "./allday-lane";
import { EventChipView } from "./event-chip";

afterEach(cleanup);

const start = new Date(2026, 9, 28, 9, 0).getTime();
const end = new Date(2026, 9, 28, 10, 0).getTime();

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

describe("the stale mark", () => {
  it("a stacked chip of a stale account carries the sync mark at full strength", () => {
    const { container } = render(<EventChipView {...base} stale />);
    expect(screen.getByRole("img", { name: "Not synced" })).toBeTruthy();
    const chip = chipEl(container);
    expect(chip.dataset.stale).toBe("true");
    expect(chip.dataset.past).toBeUndefined();
    expect(chip.className).not.toMatch(/opacity/);
  });

  it("a one-line chip carries it too", () => {
    render(<EventChipView {...base} compact stale />);
    expect(screen.getByRole("img", { name: "Not synced" })).toBeTruthy();
  });

  it("a healthy chip has no mark", () => {
    const { container } = render(<EventChipView {...base} />);
    expect(screen.queryByRole("img", { name: "Not synced" })).toBeNull();
    expect(screen.queryByRole("img", { name: "Waiting to sync" })).toBeNull();
    expect(chipEl(container).dataset.stale).toBeUndefined();
  });
});

describe("the cloud-off mark", () => {
  it("a waiting change carries its own mark, not the stale one", () => {
    const { container } = render(<EventChipView {...base} waiting />);
    expect(screen.getByRole("img", { name: "Waiting to sync" })).toBeTruthy();
    expect(screen.queryByRole("img", { name: "Not synced" })).toBeNull();
    expect(chipEl(container).dataset.waiting).toBe("true");
  });
});

describe("the all-day lane passes the marks through", () => {
  const day = new Date(2026, 9, 28);
  const chip: EventChip = {
    eventId: "e1",
    occurrenceKey: "e1",
    title: "Offsite",
    startMs: day.getTime(),
    endMs: day.getTime() + 86_400_000,
    dayKey: localDayKey(day),
    allDay: true,
    external: true,
    readOnly: true,
    recurring: false,
    sourceAccountId: "work",
    color: null,
    continuesFromMs: null,
    continuesToMs: null,
    locked: false,
  };
  const lane = (props: Partial<Parameters<typeof AllDayLane>[0]>) =>
    render(
      <AllDayLane
        days={[day]}
        columns="3rem 1fr"
        allDayByDay={new Map([[chip.dayKey, [chip]]])}
        accountHues={{}}
        selectedOccurrenceKey={null}
        nowMs={0}
        onPick={() => {}}
        {...props}
      />,
    );

  it("a stale account's all-day bar is marked", () => {
    lane({ staleAccountIds: new Set(["work"]) });
    expect(screen.getByRole("img", { name: "Not synced" })).toBeTruthy();
  });

  it("another account's failure leaves it alone", () => {
    lane({ staleAccountIds: new Set(["family"]) });
    expect(screen.queryByRole("img", { name: "Not synced" })).toBeNull();
  });

  it("a waiting all-day change is marked as waiting", () => {
    lane({ waitingEventIds: new Set(["e1"]) });
    expect(screen.getByRole("img", { name: "Waiting to sync" })).toBeTruthy();
  });
});
