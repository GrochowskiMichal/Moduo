// AC4: loading paints the shell at once with skeletons in the last known shape
// (one all-day row and Plan groups 2/5/1/3 before anything is known), and the
// grid doesn't move when events arrive. jsdom lays nothing out, so "doesn't
// move" is pinned as structure: the skeleton lane draws the same number of rows
// on the same container as the real lane for the same data, and the shape the
// page remembers is the one the real lane drew.

import { afterEach, beforeEach, describe, expect, it } from "@rstest/core";
import { cleanup, render } from "@testing-library/react";

import type { EventChip } from "../events";
import {
  allDayRowsOf,
  DEFAULT_LOAD_SHAPE,
  readLoadShape,
  sanitizeLoadShape,
  writeLoadShape,
} from "../load-shape";
import { localDayKey } from "../lens";
import { AllDayLane } from "./allday-lane";
import { AllDayLaneSkeleton, PlanSkeleton } from "./calendar-skeleton";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

const days = [0, 1, 2, 3, 4, 5, 6].map((i) => new Date(2026, 9, 26 + i));
const columns = "3rem repeat(7, minmax(0, 1fr))";

function allDayChip(id: string, day: Date, spanDays = 1): EventChip {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  return {
    eventId: id,
    occurrenceKey: id,
    title: id,
    startMs: start,
    endMs: start + spanDays * 86_400_000,
    dayKey: localDayKey(day),
    allDay: true,
    external: false,
    readOnly: false,
    recurring: false,
    sourceAccountId: null,
    color: null,
    continuesFromMs: null,
    continuesToMs: null,
    locked: false,
  };
}

function byDay(chips: EventChip[]): Map<string, EventChip[]> {
  const map = new Map<string, EventChip[]>();
  for (const chip of chips) {
    const list = map.get(chip.dayKey) ?? [];
    list.push(chip);
    map.set(chip.dayKey, list);
  }
  return map;
}

describe("skeleton keeps the last shape", () => {
  it("before anything is known: one all-day row and Plan groups 2/5/1/3", () => {
    expect(DEFAULT_LOAD_SHAPE).toEqual({ allDayRows: 1, planGroups: [2, 5, 1, 3] });
    expect(readLoadShape("u1", "w1")).toEqual(DEFAULT_LOAD_SHAPE);
  });

  it("remembers the shape per person and workspace, and merges a partial write", () => {
    writeLoadShape("u1", "w1", { allDayRows: 2 });
    writeLoadShape("u1", "w1", { planGroups: [3, 0, 6] });
    expect(readLoadShape("u1", "w1")).toEqual({ allDayRows: 2, planGroups: [3, 0, 6] });
    expect(readLoadShape("u1", "w2")).toEqual(DEFAULT_LOAD_SHAPE);
    expect(readLoadShape("u2", "w1")).toEqual(DEFAULT_LOAD_SHAPE);
  });

  it("a stored shape is kept in bounds: three lane rows, six rows a group, four groups", () => {
    expect(sanitizeLoadShape({ allDayRows: 9, planGroups: [40, -2, 1, 2, 3] })).toEqual({
      allDayRows: 3,
      planGroups: [6, 0, 1, 2],
    });
    expect(sanitizeLoadShape("junk")).toEqual(DEFAULT_LOAD_SHAPE);
    expect(sanitizeLoadShape({ allDayRows: 0 })).toEqual({
      allDayRows: 0,
      planGroups: DEFAULT_LOAD_SHAPE.planGroups,
    });
  });

  it("the remembered lane rows are the rows the real lane draws", () => {
    const keys = days.map(localDayKey);
    expect(allDayRowsOf(keys, new Map())).toBe(0);
    const one = byDay([allDayChip("a", days[0]), allDayChip("b", days[2])]);
    expect(allDayRowsOf(keys, one)).toBe(1);
    const crowded = byDay([
      allDayChip("a", days[0]),
      allDayChip("b", days[0]),
      allDayChip("c", days[0]),
      allDayChip("d", days[0]),
    ]);
    // Two rows: one of bars, then "+N more".
    expect(allDayRowsOf(keys, crowded)).toBe(2);
  });

  it("the skeleton lane is the real lane's frame with the same rows, so nothing moves", () => {
    const data = byDay([allDayChip("a", days[0]), allDayChip("b", days[0])]);
    const rows = allDayRowsOf(days.map(localDayKey), data);
    expect(rows).toBe(2);
    const real = render(
      <AllDayLane
        days={days}
        columns={columns}
        allDayByDay={data}
        accountHues={{}}
        selectedOccurrenceKey={null}
        nowMs={0}
        onPick={() => {}}
      />,
    );
    const realLane = real.container.querySelector<HTMLElement>("[data-allday-lane]")!;
    const skeleton = render(<AllDayLaneSkeleton days={days.length} columns={columns} rows={rows} />);
    const skeletonLane = skeleton.container.querySelector<HTMLElement>("[data-allday-lane]")!;
    expect(skeletonLane).not.toBeNull();
    expect(skeletonLane.className).toBe(realLane.className);
    expect(skeletonLane.dataset.alldayRows).toBe(String(rows));
    expect(realLane.dataset.alldayRows).toBe(String(rows));
    expect(skeletonLane.getAttribute("aria-hidden")).toBe("true");
  });

  it("no remembered all-day rows: no skeleton lane", () => {
    const { container } = render(<AllDayLaneSkeleton days={7} columns={columns} rows={0} />);
    expect(container.querySelector("[data-allday-lane]")).toBeNull();
  });

  it("Plan's skeleton draws each remembered group with its rows", () => {
    const { container } = render(<PlanSkeleton groups={[2, 5, 1, 3]} />);
    const groups = [...container.querySelectorAll<HTMLElement>("[data-plan-skeleton-group]")];
    expect(groups).toHaveLength(4);
    expect(groups.map((g) => g.querySelectorAll("[data-plan-skeleton-row]").length)).toEqual([
      2, 5, 1, 3,
    ]);
  });
});
