import { describe, expect, it } from "@rstest/core";
import { RRule } from "rrule";

import { parseCapture } from "./capture-parser";
import { captureDates, resolveTitle, segmentsFromLine, type TitleSegment } from "./capture-tokens";

// Friday 9 October 2026, 10:00 local — the research probe's reference time.
const FRIDAY_10AM = new Date(2026, 9, 9, 10, 0, 0, 0);

const local = (iso: string | null) => (iso ? new Date(iso) : null);

describe("parseCapture — keeps the words people typed (tasks-v3 AC1.3)", () => {
  it("a bare month is a word, not a date", () => {
    const p = parseCapture("Send March report", FRIDAY_10AM);
    expect(p.title).toBe("Send March report");
    expect(p.dueDate).toBeNull();
    expect(p.scheduledAt).toBeNull();
    expect(p.matched).toBe(false);
  });

  it("a clear day still parses, and its connective goes with it", () => {
    const p = parseCapture("Essay by Dec 15 #school @ola p1", FRIDAY_10AM);
    expect(p.title).toBe("Essay #school @ola p1");
    const due = local(p.dueDate);
    expect(due?.getMonth()).toBe(11);
    expect(due?.getDate()).toBe(15);
  });

  it("numbers that aren't dates stay text", () => {
    for (const text of ["Buy 2 apples", "Plan Q3", "Review PR 123"]) {
      const p = parseCapture(text, FRIDAY_10AM);
      expect(p.title).toBe(text);
      expect(p.matched).toBe(false);
    }
  });
});

describe("parseCapture — a bare hour is daytime", () => {
  it('"at 5" is 5 PM today, not 5 AM tomorrow', () => {
    const p = parseCapture("Call Mike at 5", FRIDAY_10AM);
    expect(p.title).toBe("Call Mike");
    const at = local(p.scheduledAt);
    expect(at?.getHours()).toBe(17);
    expect(at?.getMinutes()).toBe(0);
    expect(at?.getDate()).toBe(9);
  });

  it('"at 5:30" is 17:30; "at 9" stays morning (tomorrow, since 9 AM has passed)', () => {
    const half = local(parseCapture("meet at 5:30", FRIDAY_10AM).scheduledAt);
    expect(half?.getHours()).toBe(17);
    expect(half?.getMinutes()).toBe(30);
    const nine = local(parseCapture("standup at 9", FRIDAY_10AM).scheduledAt);
    expect(nine?.getHours()).toBe(9);
    expect(nine?.getDate()).toBe(10);
  });

  it("an explicit AM/PM, a 24-hour or zero-padded time is taken as typed", () => {
    expect(local(parseCapture("run at 5am", FRIDAY_10AM).scheduledAt)?.getHours()).toBe(5);
    expect(local(parseCapture("call at 17", FRIDAY_10AM).scheduledAt)?.getHours()).toBe(17);
    expect(local(parseCapture("train at 05:30", FRIDAY_10AM).scheduledAt)?.getHours()).toBe(5);
  });

  it("a zero-padded day doesn't make the time 24-hour", () => {
    const at = local(parseCapture("Dentist Oct 15 at 3", FRIDAY_10AM).scheduledAt);
    expect(at?.getHours()).toBe(15);
    const padded = local(parseCapture("Dentist 2026-10-15 at 3", FRIDAY_10AM).scheduledAt);
    expect(padded?.getHours()).toBe(15);
  });

  it("a named day keeps its day with the daytime hour", () => {
    const at = local(parseCapture("Dentist Monday at 3", FRIDAY_10AM).scheduledAt);
    expect(at?.getDay()).toBe(1);
    expect(at?.getHours()).toBe(15);
  });
});

describe("parseCapture — a date and a repeat both stick", () => {
  it('"tomorrow 3pm every week" starts the weekly repeat tomorrow at 3 PM', () => {
    const p = parseCapture("Team sync tomorrow 3pm every week", FRIDAY_10AM);
    expect(p.title).toBe("Team sync");
    const start = local(p.scheduledAt);
    expect(start?.getDate()).toBe(10);
    expect(start?.getHours()).toBe(15);
    expect(p.recurrence).not.toBeNull();
    expect(local(p.recurrence?.dtstart ?? null)?.getDate()).toBe(10);
    expect(RRule.fromString(p.recurrence?.rrule ?? "").options.freq).toBe(RRule.WEEKLY);
  });

  it('"every month on the 1st" repeats on the 1st and leaves the title clean', () => {
    const p = parseCapture("Pay rent every month on the 1st", FRIDAY_10AM);
    expect(p.title).toBe("Pay rent");
    const next = local(p.scheduledAt);
    expect(next?.getDate()).toBe(1);
    expect(next?.getMonth()).toBe(10); // 1 November: October's 1st has passed
    expect(RRule.fromString(p.recurrence?.rrule ?? "").options.bymonthday).toEqual([1]);
  });

  it("an ordinal that names a place isn't a day", () => {
    const p = parseCapture("Clean the office every month on the 3rd floor", FRIDAY_10AM);
    expect(p.title).toBe("Clean the office on the 3rd floor");
    expect(p.recurrence?.rrule).not.toContain("BYMONTHDAY");
  });

  it("a connective before a repeat stays (it's often a verb's)", () => {
    expect(parseCapture("Log on every day", FRIDAY_10AM).title).toBe("Log on");
    expect(parseCapture("On-call handover every friday", FRIDAY_10AM).title).toBe(
      "On-call handover",
    );
  });

  it("words between the repeat and its day stay in the title", () => {
    const p = parseCapture("Pay rent every month for the flat on the 1st", FRIDAY_10AM);
    expect(p.title).toBe("Pay rent for the flat");
    expect(RRule.fromString(p.recurrence?.rrule ?? "").options.bymonthday).toEqual([1]);
  });

  it("a time inside the repeat lends its clock, not its day", () => {
    const p = parseCapture("Standup every weekday at 9", FRIDAY_10AM);
    expect(p.title).toBe("Standup");
    const next = local(p.scheduledAt);
    expect(next?.getHours()).toBe(9);
    expect(next?.getDay()).toBe(1); // Friday 9 AM has passed → Monday
  });

  it('"every friday at 5" is today at 5 PM', () => {
    const next = local(parseCapture("Timesheet every friday at 5", FRIDAY_10AM).scheduledAt);
    expect(next?.getDate()).toBe(9);
    expect(next?.getHours()).toBe(17);
  });

  it("an unknown repeat is flagged, never guessed", () => {
    const p = parseCapture("Water plants every so often", FRIDAY_10AM);
    expect(p.recurrence).toBeNull();
    expect(p.unparsedRecurrence).toBe(true);
    expect(p.title).toBe("Water plants every so often");
  });
});

describe("parseCapture — the `/` date commands (33a, RF-1's grammar)", () => {
  it("/tomorrow sets the due date and leaves the title", () => {
    const p = parseCapture("Send the March report /tomorrow", FRIDAY_10AM);
    expect(p.title).toBe("Send the March report");
    expect(local(p.dueDate)?.toDateString()).toBe(new Date(2026, 9, 10).toDateString());
    expect(p.scheduledAt).toBeNull();
  });

  it("/next week is the coming Monday; an explicit command wins over date words", () => {
    const p = parseCapture("Prepare Monday notes /next week", FRIDAY_10AM);
    expect(p.title).toBe("Prepare Monday notes");
    expect(local(p.dueDate)?.toDateString()).toBe(new Date(2026, 9, 12).toDateString());
  });

  it("a time with the command schedules on that day; a repeat keeps its own start", () => {
    const timed = parseCapture("Call Anna at 3pm /tomorrow", FRIDAY_10AM);
    expect(timed.title).toBe("Call Anna");
    const at = local(timed.scheduledAt);
    expect(at?.toDateString()).toBe(new Date(2026, 9, 10).toDateString());
    expect(at?.getHours()).toBe(15);
    const worded = parseCapture("Call Anna Friday at 3pm /tomorrow", FRIDAY_10AM);
    expect(worded.title).toBe("Call Anna Friday");
    for (const odd of [
      "Call Anna at 3 p.m. /tomorrow",
      "Call Anna at 3 o'clock /tomorrow",
      "Call Anna 3PM-4PM /tomorrow",
    ]) {
      const p = parseCapture(odd, FRIDAY_10AM);
      expect(p.title).toBe("Call Anna");
    }
    expect(local(worded.scheduledAt)?.toDateString()).toBe(new Date(2026, 9, 10).toDateString());
    const repeat = parseCapture("Standup every Monday /next week", FRIDAY_10AM);
    expect(repeat.recurrence).not.toBeNull();
    expect(repeat.title).toBe("Standup");
  });

  it("a repeat typed with a command starts on the command's day", () => {
    const p = parseCapture("Pay rent /tomorrow every month", FRIDAY_10AM);
    expect(p.recurrence).not.toBeNull();
    expect(p.title).toBe("Pay rent");
    expect(local(p.recurrence?.dtstart ?? null)?.toDateString()).toBe(
      new Date(2026, 9, 10).toDateString(),
    );
  });

  it("a slash inside a word is text (and/or)", () => {
    expect(parseCapture("Decide and/or delegate", FRIDAY_10AM).title).toBe(
      "Decide and/or delegate",
    );
  });
});

describe("parseCapture — keeps the words people typed: Esc on a highlight (AC10.5)", () => {
  it("reports where the recognised words are, for the highlight", () => {
    const text = "Call Anna tomorrow 3pm";
    const p = parseCapture(text, FRIDAY_10AM);
    expect(p.spans.map(([a, b]) => text.slice(a, b))).toEqual(["tomorrow 3pm"]);
    expect(parseCapture("Send March report", FRIDAY_10AM).spans).toEqual([]);
  });

  it("a kept phrase stays words and is never read as a date", () => {
    const p = parseCapture("Prepare Monday notes", FRIDAY_10AM, { keep: ["Monday"] });
    expect(p.title).toBe("Prepare Monday notes");
    expect(p.matched).toBe(false);
    expect(p.dueDate).toBeNull();
  });

  it("keeping one phrase leaves the others read", () => {
    const p = parseCapture("Prepare Monday notes tomorrow", FRIDAY_10AM, { keep: ["monday"] });
    expect(p.title).toBe("Prepare Monday notes");
    expect(local(p.dueDate)?.getDate()).toBe(10);
  });

  it("an ignored range (a linked thing's name) is never a date", () => {
    const p = parseCapture("Read Friday recap at 5", FRIDAY_10AM, { ignore: [[5, 17]] });
    expect(p.title).toBe("Read Friday recap");
    expect(local(p.scheduledAt)?.getHours()).toBe(17);
    expect(local(p.scheduledAt)?.getDate()).toBe(9);
  });
});

describe("capture title tokens — grammar tokens (AC10.3, AC10.4)", () => {
  const CTX = {
    people: [
      { userId: "u-sam", name: "Sam Ortiz" },
      { userId: "u-ana", name: "Ana Lee" },
    ],
    teams: [{ id: "t-design", name: "Design", letters: "DS" }],
    tags: [{ id: "g-client", name: "client", color: "blue" }],
  };

  it("@person assigns and leaves the title", () => {
    const r = resolveTitle(
      [
        { text: "Review the brief " },
        { token: { kind: "person", userId: "u-sam", label: "Sam Ortiz" } },
      ],
      { now: FRIDAY_10AM },
    );
    expect(r.title).toBe("Review the brief");
    expect(r.single.person?.userId).toBe("u-sam");
  });

  it("@Anna (a contact) stays in the title as words and becomes a link", () => {
    const anna = { type: "contact", id: "c-anna" };
    const r = resolveTitle(
      [
        { text: "Call " },
        { token: { kind: "thing", ref: anna, label: "Anna Kowalski" } },
        { text: " about the launch" },
      ],
      { now: FRIDAY_10AM },
    );
    expect(r.title).toBe("Call Anna Kowalski about the launch");
    expect(r.things.map((t) => t.ref)).toEqual([anna]);
  });

  it("/tomorrow sets the due date and leaves the title, typed or picked", () => {
    const typed = resolveTitle(segmentsFromLine("Send invoice /tomorrow", CTX), {
      now: FRIDAY_10AM,
    });
    expect(typed.title).toBe("Send invoice");
    expect(captureDates(typed).dueDay).toBe("2026-10-10");
    const picked = resolveTitle(
      [{ text: "Send invoice " }, { token: { kind: "due", day: "2026-10-10", label: "Tomorrow" } }],
      { now: FRIDAY_10AM },
    );
    expect(picked.title).toBe("Send invoice");
    expect(captureDates(picked).dueDay).toBe("2026-10-10");
  });

  it("C#, #123 and and/or stay text", () => {
    for (const text of ["Learn C# basics", "Fix #123", "Decide and/or delegate"]) {
      const r = resolveTitle(segmentsFromLine(text, CTX), { now: FRIDAY_10AM });
      expect(r.title).toBe(text);
      expect(r.tags).toEqual([]);
    }
  });

  it("a typed line: @first-name assigns, @Team routes, #tag tags; an unknown @ stays", () => {
    const r = resolveTitle(segmentsFromLine("Banner @design @sam #client for @nobody", CTX), {
      now: FRIDAY_10AM,
    });
    expect(r.title).toBe("Banner for @nobody");
    expect(r.single.team?.teamId).toBe("t-design");
    expect(r.single.person?.userId).toBe("u-sam");
    expect(r.tags.map((t) => t.tagId)).toEqual(["g-client"]);
  });

  it("an explicit date wins: date words then stay the person's words", () => {
    const r = resolveTitle(
      [
        { text: "Prepare Monday notes " },
        { token: { kind: "due", day: "2026-10-14", label: "Oct 14" } },
      ],
      { now: FRIDAY_10AM },
    );
    expect(r.title).toBe("Prepare Monday notes");
    expect(r.highlights).toEqual([]);
    expect(captureDates(r).dueDay).toBe("2026-10-14");
    // A date set on the pill counts the same.
    const pill = resolveTitle([{ text: "Prepare Monday notes" }], {
      now: FRIDAY_10AM,
      manualDates: { dueDay: "2026-10-20" },
    });
    expect(pill.title).toBe("Prepare Monday notes");
    expect(captureDates(pill, { dueDay: "2026-10-20" }).dueDay).toBe("2026-10-20");
  });

  it("date words leave the title, highlighted where they are; Esc keeps them", () => {
    const segments: TitleSegment[] = [
      { text: "Call " },
      { token: { kind: "person", userId: "u-ana", label: "Ana Lee" } },
      { text: " tomorrow 3pm" },
    ];
    const r = resolveTitle(segments, { now: FRIDAY_10AM });
    expect(r.title).toBe("Call");
    expect(r.phrases).toEqual(["tomorrow 3pm"]);
    const at = new Date(captureDates(r).scheduledAt ?? "");
    expect(at.getDate()).toBe(10);
    expect(at.getHours()).toBe(15);
    const kept = resolveTitle(segments, { now: FRIDAY_10AM, keep: ["tomorrow 3pm"] });
    expect(kept.title).toBe("Call tomorrow 3pm");
    expect(kept.highlights).toEqual([]);
  });

  it("a thing named like a date stays a name", () => {
    const r = resolveTitle(
      [
        { text: "Read " },
        { token: { kind: "thing", ref: { type: "note", id: "n1" }, label: "Monday notes" } },
      ],
      { now: FRIDAY_10AM },
    );
    expect(r.title).toBe("Read Monday notes");
    expect(captureDates(r).dueDay).toBeNull();
  });

  it("the last token of a single-value field wins; tags add up", () => {
    const r = resolveTitle(
      [
        { token: { kind: "priority", level: "low", label: "Low" } },
        { text: "Ship it " },
        { token: { kind: "tag", tagId: "a", label: "one" } },
        { token: { kind: "tag", tagId: null, label: "two" } },
        { token: { kind: "tag", tagId: "a", label: "one" } },
        { token: { kind: "priority", level: "high", label: "High" } },
      ],
      { now: FRIDAY_10AM },
    );
    expect(r.title).toBe("Ship it");
    expect(r.single.priority?.level).toBe("high");
    expect(r.tags.map((t) => t.label)).toEqual(["one", "two"]);
  });
});
