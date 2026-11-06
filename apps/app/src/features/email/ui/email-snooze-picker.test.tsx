import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { EmailSnoozePicker, pickerAnchor } from "./email-snooze-picker";

afterEach(cleanup);

// Wed 2026-07-08 14:30 local.
const NOW = new Date(2026, 6, 8, 14, 30).getTime();

describe("snooze picker (specs/mail-v3.md §8, AC27)", () => {
  it("presets with their times, a typed time with a live preview, and the note", () => {
    const onPick = rs.fn();
    render(<EmailSnoozePicker open onOpenChange={() => {}} onPick={onPick} now={() => NOW} />);
    const dialog = screen.getByRole("dialog", { name: "Snooze until" });
    for (const label of ["Later today", "Tomorrow", "This weekend", "Next week", "Someday"]) {
      screen.getByRole("button", { name: new RegExp(`^${label}`) });
    }
    expect(dialog.textContent).toContain("Returns to the top of Personal at that time.");

    const field = screen.getByRole("textbox", { name: "Snooze until a time you type" });
    fireEvent.change(field, { target: { value: "soonish" } });
    expect(screen.getByRole("status").textContent).toBe("Can't read that");
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onPick).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "thu 9am" } });
    expect(screen.getByRole("status").textContent).not.toBe("Can't read that");
    fireEvent.keyDown(field, { key: "Enter" });
    const at = onPick.mock.calls[0]![0] as Date;
    expect([at.getDate(), at.getHours()]).toEqual([9, 9]);
  });

  it("the remind picker uses the same presets, if no reply", () => {
    const onPick = rs.fn();
    render(
      <EmailSnoozePicker
        mode="remind"
        open
        onOpenChange={() => {}}
        onPick={onPick}
        now={() => NOW}
      />,
    );
    screen.getByRole("dialog", { name: "Remind me if no reply" });
    fireEvent.click(screen.getByRole("button", { name: /^Tomorrow if no reply/ }));
    const at = onPick.mock.calls[0]![0] as Date;
    expect([at.getDate(), at.getHours()]).toEqual([9, 9]);
  });

  it("anchors to the pressed button, else the open reader's button, else the row", () => {
    document.body.innerHTML = `
      <div data-thread-id="t1"><button id="row-snooze">Snooze</button></div>
      <div data-reader-thread="t1"><button id="tb" data-reader-action="snooze">S</button></div>
      <div role="menu"><button id="menu-item">Remind</button></div>`;
    const rowButton = document.getElementById("row-snooze")!;
    expect(pickerAnchor("t1", "snooze", rowButton)).toBe(rowButton);

    // A key (nothing pressed) or a menu item: the reader's button for that action.
    const toolbar = document.getElementById("tb")!;
    toolbar.getBoundingClientRect = () => new DOMRect(10, 20, 30, 40);
    for (const pressed of [null, document.getElementById("menu-item")]) {
      expect(pickerAnchor("t1", "snooze", pressed)?.getBoundingClientRect().x).toBe(10);
    }
    // No reader button for remind here: the row.
    const row = document.querySelector<HTMLElement>('[data-thread-id="t1"]')!;
    row.getBoundingClientRect = () => new DOMRect(5, 6, 7, 8);
    expect(pickerAnchor("t1", "remind", null)?.getBoundingClientRect().x).toBe(5);
    expect(pickerAnchor("nope", "remind", null)).toBeNull();
    document.body.innerHTML = "";
  });
});
