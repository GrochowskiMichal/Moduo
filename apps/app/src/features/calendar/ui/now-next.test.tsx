// AC11: the toolbar's now-and-next line shows the current meeting, until when,
// what's next and ⇧⌘J; as the room narrows it drops "then", the key and
// "until" in that order, then the whole pill, and it never prints past its
// own box. jsdom lays nothing out, so the drop order is pinned on the width
// rule and the box on its classes (shrinks, clips, truncates the title).

import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { nowAndNext, type NowNext, type NowNextItem, nowNextParts } from "../now-next";
import { NowNextPill } from "./now-next";

afterEach(cleanup);

const at = (h: number, m = 0) => new Date(2026, 9, 27, h, m).getTime();

const legal: NowNextItem = {
  eventId: "e1",
  occurrenceKey: `e1:${at(10)}`,
  title: "Legal review with Tom",
  startMs: at(10),
  endMs: at(11, 15),
  joinUrl: "https://meet.google.com/abc-defg-hij",
};
const oneOnOne: NowNextItem = {
  eventId: "e2",
  occurrenceKey: `e2:${at(11, 30)}`,
  title: "1:1 with Ana",
  startMs: at(11, 30),
  endMs: at(12),
  joinUrl: null,
};
const lunch: NowNextItem = {
  eventId: "e3",
  occurrenceKey: `e3:${at(13)}`,
  title: "Lunch",
  startMs: at(13),
  endMs: at(14),
  joinUrl: null,
};

describe("now and next drops parts in order", () => {
  it("names the meeting in progress and the next one", () => {
    const out = nowAndNext([lunch, oneOnOne, legal], at(10, 30));
    expect(out?.now?.eventId).toBe("e1");
    expect(out?.next?.eventId).toBe("e2");
  });

  it("with nothing on, says what's next", () => {
    const out = nowAndNext([lunch, oneOnOne, legal], at(11, 20));
    expect(out?.now).toBeNull();
    expect(out?.next?.eventId).toBe("e2");
  });

  it("of two meetings in progress, the one that began last is now", () => {
    const late: NowNextItem = { ...oneOnOne, eventId: "e4", startMs: at(10, 15), endMs: at(11) };
    expect(nowAndNext([legal, late], at(10, 30))?.now?.eventId).toBe("e4");
  });

  it("is absent with nothing on and nothing next", () => {
    expect(nowAndNext([legal], at(12))).toBeNull();
    expect(nowAndNext([], at(12))).toBeNull();
  });

  it("drops then, the key, until and the pill, in that order, as the width shrinks", () => {
    const wide = nowNextParts(4000);
    expect(wide).toEqual({ pill: true, until: true, key: true, then: true });
    expect(nowNextParts(0)).toEqual({ pill: false, until: false, key: false, then: false });

    const goneAt: Record<string, number> = {};
    let prev = wide;
    for (let w = 4000; w >= 0; w -= 5) {
      const parts = nowNextParts(w);
      for (const k of ["pill", "until", "key", "then"] as const) {
        // Once a part goes it never comes back at a narrower width.
        if (!prev[k]) expect(parts[k]).toBe(false);
        if (prev[k] && !parts[k]) goneAt[k] = w;
        // A part never shows without the pill.
        if (parts[k]) expect(parts.pill).toBe(true);
      }
      prev = parts;
    }
    expect(goneAt.then).toBeGreaterThan(goneAt.key);
    expect(goneAt.key).toBeGreaterThan(goneAt.until);
    expect(goneAt.until).toBeGreaterThan(goneAt.pill);
  });

  it("shows every part when there is room", () => {
    const data: NowNext = { now: legal, next: oneOnOne };
    render(
      <NowNextPill
        data={data}
        parts={{ pill: true, until: true, key: true, then: true }}
        onOpen={() => {}}
      />,
    );
    screen.getByText("Legal review with Tom");
    screen.getByText(/until 11:15/);
    screen.getByText(/1:1 with Ana/);
    screen.getByText(/then/);
    screen.getByText("⇧⌘J");
  });

  it("leaves out each part the width drops", () => {
    const data: NowNext = { now: legal, next: oneOnOne };
    render(
      <NowNextPill
        data={data}
        parts={{ pill: true, until: true, key: false, then: false }}
        onOpen={() => {}}
      />,
    );
    screen.getByText("Legal review with Tom");
    screen.getByText(/until 11:15/);
    expect(screen.queryByText(/1:1 with Ana/)).toBeNull();
    expect(screen.queryByText("⇧⌘J")).toBeNull();
    cleanup();
    render(
      <NowNextPill
        data={data}
        parts={{ pill: true, until: false, key: false, then: false }}
        onOpen={() => {}}
      />,
    );
    screen.getByText("Legal review with Tom");
    expect(screen.queryByText(/until/)).toBeNull();
  });

  it("renders nothing when the pill is dropped", () => {
    const { container } = render(
      <NowNextPill
        data={{ now: legal, next: oneOnOne }}
        parts={{ pill: false, until: false, key: false, then: false }}
        onOpen={() => {}}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("shows the join key only for a meeting with a link", () => {
    render(
      <NowNextPill
        data={{ now: { ...legal, joinUrl: null }, next: null }}
        parts={{ pill: true, until: true, key: true, then: true }}
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByText("⇧⌘J")).toBeNull();
  });

  it("with nothing on, the pill says what's next", () => {
    render(
      <NowNextPill
        data={{ now: null, next: oneOnOne }}
        parts={{ pill: true, until: true, key: true, then: true }}
        onOpen={() => {}}
      />,
    );
    screen.getByText(/Next/);
    screen.getByText(/1:1 with Ana/);
  });

  it("stays inside its box and opens the meeting on click", () => {
    const onOpen = rs.fn();
    const { container } = render(
      <NowNextPill
        data={{ now: legal, next: oneOnOne }}
        parts={{ pill: true, until: true, key: true, then: true }}
        onOpen={onOpen}
      />,
    );
    const pill = container.querySelector<HTMLElement>("[data-now-next]")!;
    expect(pill.className).toMatch(/\bmin-w-0\b/);
    expect(pill.className).toMatch(/\boverflow-hidden\b/);
    expect(pill.className).toMatch(/\bmax-w-full\b/);
    const title = screen.getByText("Legal review with Tom");
    expect(title.className).toMatch(/\btruncate\b/);
    fireEvent.click(pill);
    expect(onOpen).toHaveBeenCalledWith(legal);
  });
});
