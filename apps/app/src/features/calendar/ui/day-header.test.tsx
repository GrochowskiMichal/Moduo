// AC6: day headers show the weekday over a large date on one shared baseline,
// today in the pill, and the day's due count beside the date; the count opens
// that day's list, where each task opens or is scheduled (Schedule, S).
// jsdom lays nothing out, so "one baseline" is pinned as structure: the date
// row is the same element with the same classes whether the day is today,
// has a due count or neither.

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { DueChip } from "../lens";
import { DayHeader } from "./day-header";

afterEach(cleanup);

const tue = new Date(2026, 9, 27);

const due: DueChip[] = [
  { taskId: "t1", title: "Send the deck", dayKey: "2026-10-27", done: false },
  { taskId: "t2", title: "Book the venue", dayKey: "2026-10-27", done: false },
  { taskId: "t3", title: "Already done", dayKey: "2026-10-27", done: true },
];

function header(props: Partial<Parameters<typeof DayHeader>[0]> = {}) {
  return render(
    <DayHeader
      day={tue}
      today={false}
      past={false}
      due={[]}
      onOpenTask={() => {}}
      onSchedule={() => {}}
      {...props}
    />,
  );
}

describe("date, today pill, due count on one baseline", () => {
  it("shows the weekday as an eyebrow over the date", () => {
    const { container } = header();
    const weekday = container.querySelector("[data-day-weekday]");
    const date = container.querySelector("[data-day-date]");
    expect(weekday?.textContent).toMatch(/Tue/i);
    expect(date?.textContent).toBe("27");
    // The eyebrow comes first.
    expect(weekday!.compareDocumentPosition(date!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("puts today's date in the pill, and only today's", () => {
    const { container, unmount } = header({ today: true });
    expect(container.querySelector("[data-day-date][data-today-pill]")).not.toBeNull();
    unmount();
    const other = header();
    expect(other.container.querySelector("[data-today-pill]")).toBeNull();
  });

  it("counts the day's open due tasks beside the date", () => {
    const { container } = header({ due });
    const row = container.querySelector("[data-day-date-row]")!;
    const button = screen.getByRole("button", { name: /2 due/ });
    expect(row.contains(button)).toBe(true);
    expect(button.textContent).toMatch(/2 due/);
  });

  it("shows no count when nothing is open", () => {
    header({ due: [due[2]] });
    expect(screen.queryByRole("button", { name: /due/ })).toBeNull();
  });

  it("keeps one date row whether the day is today, has due work or neither", () => {
    const rowClass = (props: Partial<Parameters<typeof DayHeader>[0]>) => {
      const { container, unmount } = header(props);
      const cls = container.querySelector("[data-day-date-row]")!.className;
      const weekdayCls = container.querySelector("[data-day-weekday]")!.className;
      unmount();
      return `${weekdayCls}|${cls}`;
    };
    const plain = rowClass({});
    expect(rowClass({ today: true })).toBe(plain);
    expect(rowClass({ due })).toBe(plain);
    expect(rowClass({ today: true, due })).toBe(plain);
  });

  it("the count opens that day's list; a row opens its task, Schedule schedules it", () => {
    const onOpenTask = rs.fn();
    const onSchedule = rs.fn();
    header({ due, onOpenTask, onSchedule });
    fireEvent.click(screen.getByRole("button", { name: /2 due/ }));
    screen.getByText("Send the deck");
    screen.getByText("Book the venue");
    expect(screen.queryByText("Already done")).toBeNull();

    fireEvent.click(screen.getByText("Book the venue"));
    expect(onOpenTask).toHaveBeenCalledWith("t2");

    const schedules = screen.getAllByRole("button", { name: /Schedule/ });
    expect(schedules).toHaveLength(2);
    fireEvent.click(schedules[0]);
    expect(onSchedule).toHaveBeenCalledWith("t1");
  });

  it("S schedules the task whose row has focus", () => {
    const onSchedule = rs.fn();
    header({ due, onSchedule });
    fireEvent.click(screen.getByRole("button", { name: /2 due/ }));
    const row = screen.getByText("Book the venue").closest("button")!;
    row.focus();
    fireEvent.keyDown(row, { key: "s" });
    expect(onSchedule).toHaveBeenCalledWith("t2");
  });
});
