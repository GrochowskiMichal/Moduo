// TV-P0 (tasks-v3 AC1.12) — a date picker saves once: typing a time or
// clicking a day only moves the draft; closing the picker writes it, once.
import { afterEach, beforeAll, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { DateField, formatTimeText, parseTimeText, TimeInput } from "./date-field";
import { NumberInput } from "./input";

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

describe("DateField Esc", () => {
  it("Esc drops the draft: nothing is written", () => {
    const calls = setup({ withTime: true, value: new Date(2026, 9, 9, 9, 0) });
    const time = screen.getByLabelText("Time");
    fireEvent.change(time, { target: { value: "10:30" } });
    fireEvent.keyDown(time, { key: "Escape" });
    expect(calls).toHaveLength(0);
    expect(screen.queryByLabelText("Time")).toBeNull();
  });
});

describe("DateField closes once", () => {
  it("a second close in the same turn (focus leaving as it unmounts) writes nothing more", () => {
    const calls: Array<Date | null> = [];
    render(
      <DateField
        value={new Date(2026, 9, 9, 9, 0)}
        onChange={(d) => calls.push(d)}
        withTime
        defaultOpen
        aria-label="When"
      />,
    );
    const time = screen.getByLabelText("Time");
    fireEvent.change(time, { target: { value: "10:30" } });
    // Enter saves and closes; the input losing focus as the picker unmounts
    // must not save the same draft again.
    fireEvent.keyDown(time, { key: "Enter" });
    fireEvent.blur(time);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(calls).toHaveLength(1);
  });
});

// DS-6 (the §5.1 fix list): the token time and number fields that replaced the
// native `<input type="time">` / `type="number"`.
describe("parseTimeText / formatTimeText", () => {
  it("reads the ways people type a time", () => {
    expect(parseTimeText("15:00")).toBe("15:00");
    expect(parseTimeText("1530")).toBe("15:30");
    expect(parseTimeText("3pm")).toBe("15:00");
    expect(parseTimeText("3:30 PM")).toBe("15:30");
    expect(parseTimeText("12am")).toBe("00:00");
    expect(parseTimeText("12 p.m.")).toBe("12:00");
    expect(parseTimeText("9")).toBe("09:00");
    expect(parseTimeText("noon")).toBe("12:00");
  });

  it("refuses what isn't a time", () => {
    for (const bad of ["banana", "25:00", "13pm", "10:75", ""])
      expect(parseTimeText(bad)).toBeNull();
  });

  it("writes the one time grammar (call 41)", () => {
    expect(formatTimeText("15:00")).toBe("3:00 PM");
    expect(formatTimeText("00:05")).toBe("12:05 AM");
    expect(formatTimeText("12:30")).toBe("12:30 PM");
  });
});

/** A controlled owner, as every real caller is. */
function OwnedTime({ initial, onSave }: { initial: string; onSave: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <TimeInput
      value={value}
      onValueChange={(v) => {
        onSave(v);
        setValue(v);
      }}
      aria-label="Time"
    />
  );
}

describe("TimeInput", () => {
  it("is a text field, commits a typed time on Enter and reverts junk on blur", () => {
    const onValueChange = rs.fn();
    render(<OwnedTime initial="09:00" onSave={onValueChange} />);
    const field = screen.getByRole("textbox", { name: "Time" }) as HTMLInputElement;
    expect(field.type).toBe("text");
    expect(field.value).toBe("9:00 AM");

    fireEvent.change(field, { target: { value: "3pm" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onValueChange).toHaveBeenLastCalledWith("15:00");
    expect(field.value).toBe("3:00 PM");

    fireEvent.change(field, { target: { value: "banana" } });
    fireEvent.blur(field);
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });

  it("steps by 15 minutes on the arrow keys, wrapping at midnight", () => {
    const onValueChange = rs.fn();
    render(<TimeInput value="23:50" onValueChange={onValueChange} aria-label="Time" />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time" }), { key: "ArrowUp" });
    expect(onValueChange).toHaveBeenLastCalledWith("00:05");
  });
});

describe("a typed value survives a popover closing (no blur on unmount)", () => {
  it("TimeInput and NumberInput commit their readable draft when they unmount", () => {
    const onTime = rs.fn();
    const onNumber = rs.fn();
    const { unmount } = render(
      <>
        <TimeInput value="09:00" onValueChange={onTime} aria-label="Time" />
        <NumberInput value={25} onValueChange={onNumber} aria-label="Minutes" />
      </>,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Time" }), { target: { value: "4pm" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Minutes" }), { target: { value: "40" } });
    unmount();
    expect(onTime).toHaveBeenCalledWith("16:00");
    expect(onNumber).toHaveBeenCalledWith(40);
  });
});

describe("NumberInput", () => {
  it("never sits blank over a value its owner kept (cleared → mapped back)", () => {
    function Owner() {
      const [n, setN] = useState<number | null>(1);
      return <NumberInput value={n} onValueChange={(v) => setN(v ?? 1)} aria-label="Minutes" />;
    }
    render(<Owner />);
    const field = screen.getByRole("textbox", { name: "Minutes" }) as HTMLInputElement;
    fireEvent.change(field, { target: { value: "" } });
    fireEvent.blur(field);
    expect(field.value).toBe("1");
  });

  it("an empty time field steps from 9:00 AM, never NaN", () => {
    const onValueChange = rs.fn();
    render(<TimeInput value="" onValueChange={onValueChange} aria-label="Time" />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Time" }), { key: "ArrowUp" });
    expect(onValueChange).toHaveBeenLastCalledWith("09:15");
  });

  it("takes digits only, clamps on Enter and steps on the arrows", () => {
    const onValueChange = rs.fn();
    render(
      <NumberInput
        value={25}
        onValueChange={onValueChange}
        min={1}
        max={480}
        step={5}
        aria-label="Minutes"
      />,
    );
    const field = screen.getByRole("textbox", { name: "Minutes" }) as HTMLInputElement;
    expect(field.getAttribute("inputmode")).toBe("numeric");

    fireEvent.change(field, { target: { value: "9000" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onValueChange).toHaveBeenLastCalledWith(480);

    fireEvent.change(field, { target: { value: "abc" } });
    fireEvent.blur(field);
    expect(onValueChange).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(field, { key: "ArrowUp" });
    expect(onValueChange).toHaveBeenLastCalledWith(30);
  });
});
