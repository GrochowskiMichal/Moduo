// The Home Today widget's now-and-next line (CALR-21, specs/calendar-rethink.md
// §Assumptions "Dashboard widget": "the Home Today widget gains the
// now-and-next line with the join key"). Now: the meeting in progress, until
// when, and Join with ⇧⌘J when it has a link; otherwise what's next and when.
// The line opens the meeting; Join opens its link. Nothing on: no line.
process.env.TZ = "Europe/Warsaw";

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { NowNext, NowNextItem } from "@/features/calendar/now-next";
import { HOTKEYS } from "@/lib/hotkeys/registry";

import { TodayNowNext } from "./today-now-next";

afterEach(cleanup);

const at = (h: number, m = 0) => new Date(2026, 10, 4, h, m).getTime();
const legal: NowNextItem = {
  eventId: "legal",
  occurrenceKey: `legal:${at(10)}`,
  title: "Legal review with Tom",
  startMs: at(10),
  endMs: at(11, 15),
  joinUrl: "https://meet.google.com/abc-defg-hij",
};
const ana: NowNextItem = {
  eventId: "ana",
  occurrenceKey: `ana:${at(11, 30)}`,
  title: "1:1 with Ana",
  startMs: at(11, 30),
  endMs: at(12),
  joinUrl: null,
};

describe("the Today widget's now and next", () => {
  it("names the meeting in progress, until when, and Join with ⇧⌘J", () => {
    const data: NowNext = { now: legal, next: ana };
    render(<TodayNowNext data={data} onOpen={() => {}} />);
    expect(screen.getByText("Legal review with Tom")).toBeTruthy();
    expect(screen.getByText(/until 11:15/)).toBeTruthy();
    expect(screen.getByText(/1:1 with Ana/)).toBeTruthy();
    const join = screen.getByRole("button", { name: /Join/ });
    expect(join.textContent).toContain("⇧⌘J");
  });

  it("Join opens the meeting's link in a new tab", () => {
    const open = rs.spyOn(window, "open").mockImplementation(() => null);
    render(<TodayNowNext data={{ now: legal, next: null }} onOpen={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /Join/ }));
    expect(open).toHaveBeenCalledWith("https://meet.google.com/abc-defg-hij", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("a meeting without a link has no Join", () => {
    render(<TodayNowNext data={{ now: ana, next: null }} onOpen={() => {}} />);
    expect(screen.queryByRole("button", { name: /Join/ })).toBeNull();
  });

  it("with nothing on, says what's next and when", () => {
    render(<TodayNowNext data={{ now: null, next: ana }} onOpen={() => {}} />);
    expect(screen.getByText("Next")).toBeTruthy();
    expect(screen.getByText("1:1 with Ana")).toBeTruthy();
    expect(screen.getByText(/11:30/)).toBeTruthy();
  });

  it("clicking the line opens the meeting it names", () => {
    const onOpen = rs.fn();
    render(<TodayNowNext data={{ now: legal, next: ana }} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /Now: Legal review with Tom/ }));
    expect(onOpen).toHaveBeenCalledWith(legal);
  });

  it("nothing on and nothing next: no line", () => {
    const { container } = render(<TodayNowNext data={null} onOpen={() => {}} />);
    expect(container.textContent).toBe("");
  });

  it("⇧⌘J joins from Home too", () => {
    const def = (HOTKEYS as Record<string, { scope: string; keys: readonly unknown[] }>)["home.join"];
    expect(def?.scope).toBe("home");
    expect(def?.keys).toContain("Mod+Shift+J");
  });
});
