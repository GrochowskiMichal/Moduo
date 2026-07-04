// In-house natural-language recurrence for native events (specs/calendar.md
// assumption 5): a constrained vocabulary — NOT RRule.fromText (documented-
// incomplete) — with a live plain-English echo as the consent gesture.
// Un-parseable input returns null; the UI shows the polite fallback and saves
// nothing (never a silent wrong guess — the capture parser's posture).
//
// The pinned phrase set (unit-tested): "every tuesday and thursday at 9" ·
// "every other friday" · "first monday of the month" · presets ("every day",
// "weekdays", "every week", "every month") · "every N days/weeks/months".

export type ParsedNLRecurrence = {
  /** RFC 5545 RRULE body (no "RRULE:" prefix) — expansion-ready. */
  rrule: string;
  /** "at 9" style suffix — the consumer re-anchors the event's start time. */
  timeOfDay: { hour: number; minute: number } | null;
  /** The plain-English echo shown before saving. */
  echo: string;
};

const WEEKDAYS: Record<string, { code: string; label: string; order: number }> = {
  monday: { code: "MO", label: "Mon", order: 0 },
  mon: { code: "MO", label: "Mon", order: 0 },
  tuesday: { code: "TU", label: "Tue", order: 1 },
  tues: { code: "TU", label: "Tue", order: 1 },
  tue: { code: "TU", label: "Tue", order: 1 },
  wednesday: { code: "WE", label: "Wed", order: 2 },
  wed: { code: "WE", label: "Wed", order: 2 },
  thursday: { code: "TH", label: "Thu", order: 3 },
  thurs: { code: "TH", label: "Thu", order: 3 },
  thur: { code: "TH", label: "Thu", order: 3 },
  thu: { code: "TH", label: "Thu", order: 3 },
  friday: { code: "FR", label: "Fri", order: 4 },
  fri: { code: "FR", label: "Fri", order: 4 },
  saturday: { code: "SA", label: "Sat", order: 5 },
  sat: { code: "SA", label: "Sat", order: 5 },
  sunday: { code: "SU", label: "Sun", order: 6 },
  sun: { code: "SU", label: "Sun", order: 6 },
};

const ORDINALS: Record<string, { pos: string; label: string }> = {
  first: { pos: "1", label: "first" },
  second: { pos: "2", label: "second" },
  third: { pos: "3", label: "third" },
  fourth: { pos: "4", label: "fourth" },
  last: { pos: "-1", label: "last" },
};

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});

function formatTime(hour: number, minute: number): string {
  return TIME_FMT.format(new Date(2000, 0, 1, hour, minute));
}

/** "at 9" / "at 9:30" / "at 9am" / "at noon" — the pinned time suffixes. */
function extractTime(input: string): {
  rest: string;
  time: { hour: number; minute: number } | null;
} {
  const m = /\s+(?:at|@)\s+(noon|midnight|(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)\s*$/i.exec(
    input,
  );
  if (!m) return { rest: input.trim(), time: null };
  const rest = input.slice(0, m.index).trim();
  const word = m[1].toLowerCase();
  if (word === "noon") return { rest, time: { hour: 12, minute: 0 } };
  if (word === "midnight") return { rest, time: { hour: 0, minute: 0 } };
  let hour = Number(m[2]);
  const minute = m[3] ? Number(m[3]) : 0;
  const meridiem = m[4]?.toLowerCase() ?? null;
  if (hour > 23 || minute > 59) return { rest: input.trim(), time: null };
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  return { rest, time: { hour, minute } };
}

function weekdayList(raw: string): Array<{ code: string; label: string; order: number }> | null {
  const parts = raw
    .split(/\s*(?:,|and|&|\+)\s*/i)
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const out: Array<{ code: string; label: string; order: number }> = [];
  for (const part of parts) {
    const wd = WEEKDAYS[part];
    if (!wd) return null;
    if (!out.some((o) => o.code === wd.code)) out.push(wd);
  }
  return out.sort((a, b) => a.order - b.order);
}

function withTimeEcho(echo: string, time: { hour: number; minute: number } | null): string {
  return time ? `${echo} · ${formatTime(time.hour, time.minute)}` : echo;
}

/** Parse the constrained NL vocabulary. Null = couldn't read it (fallback UI). */
export function parseRecurrenceNL(input: string): ParsedNLRecurrence | null {
  const { rest, time } = extractTime(input.trim().toLowerCase());
  if (!rest) return null;
  const done = (rrule: string, echo: string): ParsedNLRecurrence => ({
    rrule,
    timeOfDay: time,
    echo: withTimeEcho(echo, time),
  });

  if (/^(every ?day|daily|each day)$/.test(rest)) {
    return done("FREQ=DAILY", "every day");
  }
  if (/^(?:(?:every|each) weekdays?|weekdays)$/.test(rest)) {
    return done("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR", "every weekday");
  }
  if (/^(every week|weekly)$/.test(rest)) {
    return done("FREQ=WEEKLY", "every week");
  }
  if (/^(every month|monthly)$/.test(rest)) {
    return done("FREQ=MONTHLY", "every month");
  }
  if (/^(every year|yearly|annually)$/.test(rest)) {
    return done("FREQ=YEARLY", "every year");
  }

  let m = /^every other (day|week|month)$/.exec(rest);
  if (m) {
    const unit = m[1];
    const freq = unit === "day" ? "DAILY" : unit === "week" ? "WEEKLY" : "MONTHLY";
    return done(`FREQ=${freq};INTERVAL=2`, `every other ${unit}`);
  }

  m = /^every (\d{1,2}) (days?|weeks?|months?)$/.exec(rest);
  if (m) {
    const n = Number(m[1]);
    if (n < 1) return null;
    const unit = m[2].replace(/s$/, "");
    const freq = unit === "day" ? "DAILY" : unit === "week" ? "WEEKLY" : "MONTHLY";
    const echo = n === 1 ? `every ${unit}` : `every ${n} ${unit}s`;
    return done(n === 1 ? `FREQ=${freq}` : `FREQ=${freq};INTERVAL=${n}`, echo);
  }

  m = /^every other (\w+)$/.exec(rest);
  if (m && WEEKDAYS[m[1]]) {
    const wd = WEEKDAYS[m[1]];
    const full = wd.label === "Mon" ? "Monday"
      : wd.label === "Tue" ? "Tuesday"
      : wd.label === "Wed" ? "Wednesday"
      : wd.label === "Thu" ? "Thursday"
      : wd.label === "Fri" ? "Friday"
      : wd.label === "Sat" ? "Saturday" : "Sunday";
    return done(`FREQ=WEEKLY;INTERVAL=2;BYDAY=${wd.code}`, `every other ${full}`);
  }

  m = /^(first|second|third|fourth|last) (\w+) of (?:the |every |each )?month$/.exec(rest);
  if (m && ORDINALS[m[1]] && WEEKDAYS[m[2]]) {
    const ord = ORDINALS[m[1]];
    const wd = WEEKDAYS[m[2]];
    return done(
      `FREQ=MONTHLY;BYDAY=${ord.pos}${wd.code}`,
      `monthly on the ${ord.label} ${wd.label}`,
    );
  }

  m = /^(?:every|each) (.+)$/.exec(rest);
  if (m) {
    const days = weekdayList(m[1]);
    if (days) {
      const labels = days.map((d) => d.label);
      const phrase =
        labels.length === 1
          ? labels[0]
          : `${labels.slice(0, -1).join(", ")} & ${labels[labels.length - 1]}`;
      return done(
        `FREQ=WEEKLY;BYDAY=${days.map((d) => d.code).join(",")}`,
        `weekly on ${phrase}`,
      );
    }
  }

  return null;
}
