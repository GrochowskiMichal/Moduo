// CALR-9 contract: the composer reads what and when (AC16, AC17).

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { type ComposerBusy, type ComposerContext, parseComposer } from "./parse";

// Wed 28 Oct 2026, 10:07 local. Working hours 9–18.
const NOW = new Date(2026, 9, 28, 10, 7).getTime();
const day = (d: number) => new Date(2026, 9, d).getTime();
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

const PEOPLE = [
  { id: "u-kai", name: "Kai Ito", email: null, member: true },
  { id: "u-nora", name: "Nora Lund", email: null, member: true },
  { id: "c-priya", name: "Priya Shah", email: "priya@acme.com", member: false },
  { id: "c-mei", name: "Mei Chen", email: "mei@studio.co", member: false },
];
const CALENDARS = [
  { id: "moduo", name: "Your calendar", google: false },
  { id: "cal-work", name: "Work", google: false },
  { id: "acc-g", name: "robin@gmail.com", google: true },
];

function ctx(over: Partial<ComposerContext> = {}, busy: Record<number, ComposerBusy[]> = {}) {
  return {
    nowMs: NOW,
    base: { dayStartMs: day(28), startMinute: 10 * 60 + 15 },
    workStartMinute: 9 * 60,
    workEndMinute: 18 * 60,
    busyOn: (dayStartMs: number) => busy[new Date(dayStartMs).getDate()] ?? [],
    calendars: CALENDARS,
    people: PEOPLE,
    ...over,
  } satisfies ComposerContext;
}

const kinds = (text: string, c = ctx()) =>
  parseComposer(text, c).tokens.map((t) => [text.slice(t.start, t.end), t.kind]);

describe("reads what and when", () => {
  it("keeps where the box opened when nothing names a time", () => {
    const p = parseComposer("Design review", ctx());
    expect(p.title).toBe("Design review");
    expect(p.startMs).toBe(at(28, 10, 15));
    expect(p.endMs).toBe(at(28, 10, 45));
    expect(p.firstFree).toBe(false);
    expect(p.kind).toBe("event");
  });

  it("reads a day, a time and a length, and takes them out of the title", () => {
    const p = parseComposer("Investor prep thu 1pm 90m", ctx());
    expect(p.title).toBe("Investor prep");
    expect(p.startMs).toBe(at(29, 13));
    expect(p.endMs).toBe(at(29, 14, 30));
    expect(kinds("Investor prep thu 1pm 90m")).toEqual([
      ["thu", "day"],
      ["1pm", "time"],
      ["90m", "time"],
    ]);
  });

  it("reads ranges, 24-hour times, noon, hours and tomorrow", () => {
    expect(parseComposer("Standup tomorrow 9:30-10am", ctx())).toMatchObject({
      title: "Standup",
      startMs: at(29, 9, 30),
      endMs: at(29, 10),
    });
    expect(parseComposer("Call fri 14:00 for 2 hours", ctx())).toMatchObject({
      title: "Call",
      startMs: at(30, 14),
      endMs: at(30, 16),
    });
    expect(parseComposer("Lunch today noon", ctx())).toMatchObject({
      startMs: at(28, 12),
      endMs: at(28, 13),
    });
    expect(parseComposer("Review at 3", ctx())).toMatchObject({
      title: "Review",
      startMs: at(28, 15),
    });
  });

  it("puts a bare day at that day's first free time, past what's busy", () => {
    const busy = { 29: [{ startMs: at(29, 9), endMs: at(29, 10, 30), title: "Standup" }] };
    const p = parseComposer("Investor prep thu morning 90m", ctx({}, busy));
    expect(p.startMs).toBe(at(29, 10, 30));
    expect(p.endMs).toBe(at(29, 12));
    expect(p.firstFree).toBe(true);
    const bare = parseComposer("Plan fri", ctx());
    expect(bare.startMs).toBe(at(30, 9));
    expect(bare.firstFree).toBe(true);
  });

  it("today's first free time starts after now", () => {
    const p = parseComposer("Write today afternoon", ctx({ nowMs: at(28, 14, 2) }));
    expect(p.startMs).toBe(at(28, 14, 15));
  });

  it("reads #calendar against the calendars you can write to", () => {
    const p = parseComposer("Retro #work fri 4pm", ctx());
    expect(p.calendarId).toBe("cal-work");
    expect(p.title).toBe("Retro");
    expect(parseComposer("Retro #nope", ctx()).calendarId).toBeNull();
    expect(parseComposer("Retro #nope", ctx()).title).toBe("Retro #nope");
  });

  it("reads people by 'with X and Y', @name and email, and keeps names in the title", () => {
    const p = parseComposer("Sync with Kai and Nora thu 30m", ctx());
    expect(p.people.map((x) => x.id)).toEqual(["u-kai", "u-nora"]);
    expect(p.title).toBe("Sync with Kai and Nora");
    const at2 = parseComposer("Plan @kai tomorrow", ctx());
    expect(at2.people.map((x) => x.id)).toEqual(["u-kai"]);
    expect(at2.title).toBe("Plan Kai");
    const mail = parseComposer("Intro with sam@outside.io fri 11am", ctx());
    expect(mail.people).toEqual([
      { id: "sam@outside.io", name: "sam@outside.io", email: "sam@outside.io", member: false },
    ]);
    expect(mail.title).toBe("Intro with sam");
    expect(kinds("Sync with Kai")).toEqual([["Kai", "person"]]);
  });

  it("reads a place after 'at', the office and in person", () => {
    const p = parseComposer("Coffee with Priya fri 8:30am at Charlotte", ctx());
    expect(p.place).toBe("Charlotte");
    expect(p.title).toBe("Coffee with Priya");
    expect(p.startMs).toBe(at(30, 8, 30));
    expect(p.meal).toBe(true);
    expect(parseComposer("Planning at the office tomorrow", ctx()).place).toBe("The office");
    expect(parseComposer("Planning in person", ctx()).place).toBe("In person");
    // A day or a teammate after "at" is not a place.
    expect(parseComposer("Talk at Kai's desk", ctx()).place).toBeNull();
  });

  it("reads a meeting link: on meet, on zoom, on teams", () => {
    expect(parseComposer("Demo on zoom thu 2pm", ctx())).toMatchObject({
      online: "zoom",
      title: "Demo",
    });
    expect(parseComposer("Demo on meet", ctx()).online).toBe("meet");
    expect(parseComposer("Demo via teams", ctx()).online).toBe("teams");
    expect(parseComposer("Demo on google meet", ctx()).online).toBe("meet");
  });

  it("'Meet Mei for coffee' stays a title", () => {
    const p = parseComposer("Meet Mei for coffee", ctx());
    expect(p.title).toBe("Meet Mei for coffee");
    expect(p.online).toBeNull();
    expect(p.people.map((x) => x.id)).toEqual([]);
    expect(p.meal).toBe(true);
  });

  it("a focus prefix makes focus time, two hours by default", () => {
    const p = parseComposer("focus Write the spec tomorrow 9am", ctx());
    expect(p.kind).toBe("focus");
    expect(p.title).toBe("Write the spec");
    expect(p.endMs - p.startMs).toBe(120 * 60_000);
  });

  it("whenKey changes only with the day and time words", () => {
    const a = parseComposer("Sync thu 1pm", ctx()).whenKey;
    expect(parseComposer("Sync with Kai thu 1pm", ctx()).whenKey).toBe(a);
    expect(parseComposer("Sync thu 2pm", ctx()).whenKey).not.toBe(a);
  });
});
