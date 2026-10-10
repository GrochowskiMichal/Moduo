// DS-6 (the §5.1 fix list): the token time and number fields that replaced the
// native `<input type="time">` / `type="number"`.
import { describe, expect, it, rs } from "@rstest/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import { formatTimeText, parseTimeText, TimeInput } from "./date-field";
import { NumberInput } from "./input";

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
