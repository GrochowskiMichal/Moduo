// TV-P0 (tasks-v3 AC1.12) — a date picker saves once: typing a time or
// clicking a day only moves the draft; closing the picker writes it, once.
import { afterEach, beforeAll, describe, expect, it } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { DateField } from "./date-field";

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

function setup(props: { withTime?: boolean; value?: Date | null }) {
  const calls: Array<Date | null> = [];
  render(
    <DateField
      value={props.value ?? null}
      onChange={(d) => calls.push(d)}
      withTime={props.withTime}
      defaultOpen
      aria-label="When"
    />,
  );
  return calls;
}

describe("DateField saves once", () => {
  it("typing a time, segment by segment, writes nothing until the picker closes", () => {
    const calls = setup({ withTime: true, value: new Date(2026, 9, 9, 9, 0) });
    const time = screen.getByLabelText("Time");
    for (const v of ["1", "10", "10:3", "10:30"]) fireEvent.change(time, { target: { value: v } });
    expect(calls).toHaveLength(0);
    fireEvent.keyDown(time, { key: "Enter" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.getHours()).toBe(10);
    expect(calls[0]?.getMinutes()).toBe(30);
  });

  it("closing without a change writes nothing", () => {
    const calls = setup({ withTime: true, value: new Date(2026, 9, 9, 9, 0) });
    fireEvent.keyDown(screen.getByLabelText("Time"), { key: "Enter" });
    expect(calls).toHaveLength(0);
  });

  it("a date-only pick writes once and closes", () => {
    const calls = setup({ withTime: false });
    fireEvent.click(screen.getByRole("button", { name: "Tomorrow" }));
    expect(calls).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Tomorrow" })).toBeNull();
  });

  it("Clear writes null once", () => {
    const calls = setup({ withTime: true, value: new Date(2026, 9, 9, 9, 0) });
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(calls).toEqual([null]);
  });
});
