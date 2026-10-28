// The first-week state: "Your week is open", low on the grid, closable (and
// esc), with New event, Connect Google Calendar and three keys. It shows only
// for a calendar that has nothing yet, has loaded cleanly and wasn't closed.

import { afterEach, beforeEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { readFirstWeekClosed, showFirstWeek, writeFirstWeekClosed } from "../first-week";
import { FirstWeekCard } from "./first-week-card";

afterEach(cleanup);
beforeEach(() => window.localStorage.clear());

function card() {
  const onNewEvent = rs.fn();
  const onConnectGoogle = rs.fn();
  const onClose = rs.fn();
  const view = render(
    <FirstWeekCard onNewEvent={onNewEvent} onConnectGoogle={onConnectGoogle} onClose={onClose} />,
  );
  return { ...view, onNewEvent, onConnectGoogle, onClose };
}

describe("the first-week card", () => {
  it("says the week is open and offers New event and Connect Google Calendar", () => {
    const { onNewEvent, onConnectGoogle } = card();
    expect(screen.getByText("Your week is open")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /New event/ }));
    expect(onNewEvent).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Connect Google Calendar/ }));
    expect(onConnectGoogle).toHaveBeenCalledTimes(1);
  });

  it("teaches three keys", () => {
    const { container } = card();
    expect(container.querySelectorAll("[data-first-week-keys] kbd")).toHaveLength(3);
  });

  it("closes from its button and from esc", () => {
    const { onClose } = card();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("esc inside a field or a dialog is not its to take", () => {
    const { onClose } = card();
    const input = document.createElement("input");
    document.body.append(input);
    fireEvent.keyDown(input, { key: "Escape" });
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.append(dialog);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    input.remove();
    dialog.remove();
  });
});

describe("when the first week shows", () => {
  const fresh = {
    loading: false,
    faulted: false,
    eventCount: 0,
    accountCount: 0,
    closed: false,
  };

  it("a calendar with nothing yet, loaded cleanly, shows it", () => {
    expect(showFirstWeek(fresh)).toBe(true);
  });

  it("anything there, a load, a fault or a close keeps it away", () => {
    expect(showFirstWeek({ ...fresh, eventCount: 1 })).toBe(false);
    expect(showFirstWeek({ ...fresh, accountCount: 1 })).toBe(false);
    expect(showFirstWeek({ ...fresh, loading: true })).toBe(false);
    expect(showFirstWeek({ ...fresh, faulted: true })).toBe(false);
    expect(showFirstWeek({ ...fresh, closed: true })).toBe(false);
  });

  it("a close is remembered per person and workspace", () => {
    expect(readFirstWeekClosed("u1", "w1")).toBe(false);
    writeFirstWeekClosed("u1", "w1");
    expect(readFirstWeekClosed("u1", "w1")).toBe(true);
    expect(readFirstWeekClosed("u1", "w2")).toBe(false);
  });
});
