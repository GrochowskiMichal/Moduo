// The composer's reader (CALR-9, AC16, AC17): one line of text → what, when,
// where and who. Deterministic and local (AI stays MCP-only). Every word it
// reads comes back as a token so the box can highlight it as you type; the
// words it reads as when, where and the calendar leave the title, people stay.

import { firstFreeStart } from "./hops";

export type ComposerPerson = {
  id: string;
  name: string;
  email: string | null;
  /** A workspace member (a teammate), not an outside guest. */
  member: boolean;
};
export type ComposerCalendar = { id: string; name: string; google: boolean };
export type ComposerBusy = { startMs: number; endMs: number; title: string };
export type ComposerTokenKind = "kind" | "day" | "time" | "calendar" | "person" | "where";
export type ComposerToken = { start: number; end: number; kind: ComposerTokenKind };

export type ComposerContext = {
  nowMs: number;
  /** Where the box opened: a day (local midnight) and the start minute, or null for the whole day. */
  base: { dayStartMs: number; startMinute: number | null };
  workStartMinute: number;
  workEndMinute: number;
  /** Your busy time on a day (events, task blocks), by the day's local midnight. */
  busyOn: (dayStartMs: number) => ComposerBusy[];
  /** The calendars an event can go to (#calendar): Your calendar first. */
  calendars: ComposerCalendar[];
  /** Teammates and contacts the box can name. */
  people: ComposerPerson[];
};

export type ComposerKind = "event" | "focus";
export type OnlineProvider = "meet" | "zoom" | "teams";

export type ComposerParse = {
  kind: ComposerKind;
  title: string;
  startMs: number;
  endMs: number;
  /** The time came from the day's first free time, not from the text. */
  firstFree: boolean;
  /** A calendar named with #, else null. */
  calendarId: string | null;
  people: ComposerPerson[];
  place: string | null;
  online: OnlineProvider | null;
  meal: boolean;
  tokens: ComposerToken[];
  /** The day and time words as typed: a ⇥ hop holds until they change. */
  whenKey: string;
};

const MEAL = /\b(lunch|dinner|brunch|coffee|drinks|breakfast)\b/i;
const LONG_MEAL = /\b(lunch|dinner|brunch|breakfast|drinks)\b/i;
const WEEKDAYS: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const WINDOWS: Record<string, [number, number]> = {
  morning: [9 * 60, 12 * 60],
  afternoon: [13 * 60, 17 * 60],
  evening: [18 * 60, 21 * 60],
  tonight: [18 * 60, 22 * 60],
};
const DAY_RE =
  /\b(today|tonight|tomorrow|tmrw|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/;
const DATE_RE =
  /\b(?:(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})|(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/;
const RANGE_RE =
  /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/;
const TIME_RE =
  /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\bat\s+(\d{1,2})(?::(\d{2}))?\b|\b(\d{1,2}):(\d{2})\b|\b(?:at\s+)?noon\b/;
const DUR_RE =
  /\b(?:for\s+)?(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?)\b(?:\s*(\d+)\s*(?:m|min|mins)?\b)?/;
const ONLINE_RE = /\b(?:on|via|over)\s+(google meet|meet|zoom|teams)\b|\b(google meet)\b/;
const OFFICE_RE = /\b(?:at\s+)?the\s+office\b|\b(?:at|in)\s+office\b|\b(in person|onsite)\b/;
const PLACE_RE = /\bat\s+([A-Z][\w'’&.-]*(?:\s+[A-Z][\w'’&.-]*){0,3})/;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const PEOPLE_RE = /\b(with|and)\s+([a-z][a-z'’-]*)|@([a-z][a-z'’-]*)/g;

function addDays(dayStartMs: number, n: number): number {
  const d = new Date(dayStartMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
}

function dayOf(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function atMinute(dayStartMs: number, minute: number): number {
  const d = new Date(dayStartMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, minute).getTime();
}

/** "1", "1pm", "13": minutes from midnight; a bare 8–11 reads as morning, 12–7 as afternoon. */
function clockMinute(hh: string, mm: string | undefined, meridiem: string | undefined): number {
  const h = Number(hh);
  const m = Number(mm ?? 0);
  if (h > 12) return h * 60 + m;
  const pm = meridiem ? meridiem === "pm" : h === 12 || h <= 7;
  return ((h % 12) + (pm ? 12 : 0)) * 60 + m;
}

function firstName(person: ComposerPerson): string {
  return person.name.split(/\s+/)[0] ?? person.name;
}

type Reader = {
  text: string;
  lower: string;
  tokens: ComposerToken[];
  take: (m: RegExpExecArray, kind: ComposerTokenKind) => void;
};

function reader(text: string): Reader {
  const tokens: ComposerToken[] = [];
  const free = (start: number, end: number) => tokens.every((t) => end <= t.start || start >= t.end);
  return {
    text,
    lower: text.toLowerCase(),
    tokens,
    take: (m, kind) => {
      if (free(m.index, m.index + m[0].length)) {
        tokens.push({ start: m.index, end: m.index + m[0].length, kind });
      }
    },
  };
}

/** The named day, if any: today, tomorrow, a weekday (the next one, today included) or a date. */
function readDay(r: Reader, nowMs: number): { dayStartMs: number; window: [number, number] | null } | null {
  const today = dayOf(nowMs);
  let m = DAY_RE.exec(r.lower);
  if (m) {
    r.take(m, "day");
    const w = m[1];
    if (w === "today") return { dayStartMs: today, window: null };
    if (w === "tonight") return { dayStartMs: today, window: WINDOWS.tonight };
    if (w === "tomorrow" || w === "tmrw") return { dayStartMs: addDays(today, 1), window: null };
    const want = WEEKDAYS[w.slice(0, 3)];
    const ahead = (want - new Date(today).getDay() + 7) % 7;
    return { dayStartMs: addDays(today, ahead), window: null };
  }
  m = DATE_RE.exec(r.lower);
  if (!m) return null;
  r.take(m, "day");
  const month = MONTHS.indexOf(m[1] ?? m[4]);
  const date = Number(m[2] ?? m[3]);
  const now = new Date(today);
  let day = new Date(now.getFullYear(), month, date).getTime();
  if (day < today) day = new Date(now.getFullYear() + 1, month, date).getTime();
  return { dayStartMs: day, window: null };
}

/** A start (and maybe an end) minute from a range or a time. */
function readTime(r: Reader): { start: number | null; end: number | null } {
  let m = RANGE_RE.exec(r.lower);
  // "2-3pm", "9:30-11", "at 9 to 10": a range needs a clock mark or an "at"/"from".
  const marked = m && (m[2] || m[3] || m[5] || m[6]);
  const led = m && /\b(at|from)\s+$/.test(r.lower.slice(0, m.index));
  if (m && (marked || led)) {
    const start = clockMinute(m[1], m[2], m[3] ?? m[6]);
    let end = clockMinute(m[4], m[5], m[6] ?? m[3]);
    if (end <= start) end += 12 * 60;
    r.take(m, "time");
    return { start, end };
  }
  m = TIME_RE.exec(r.lower);
  if (!m) return { start: null, end: null };
  r.take(m, "time");
  if (/noon/.test(m[0])) return { start: 12 * 60, end: null };
  if (m[1]) return { start: clockMinute(m[1], m[2], m[3]), end: null };
  if (m[4]) return { start: clockMinute(m[4], m[5], undefined), end: null };
  return { start: clockMinute(m[6], m[7], undefined), end: null };
}

function readDuration(r: Reader): number | null {
  const m = DUR_RE.exec(r.lower);
  if (!m) return null;
  r.take(m, "time");
  const v = Number(m[1]);
  return /^h/.test(m[2]) ? Math.round(v * 60) + (m[3] ? Number(m[3]) : 0) : Math.round(v);
}

function readCalendar(r: Reader, calendars: ComposerCalendar[]): string | null {
  const m = /#([\w-]+)/.exec(r.lower);
  if (!m) return null;
  const word = m[1];
  const hit = calendars.find((c) => {
    const name = c.name.toLowerCase();
    return (
      c.id === word ||
      name.startsWith(word) ||
      name.replace(/\s+/g, "").startsWith(word) ||
      (c.id === "moduo" && ["moduo", "me", "mine"].includes(word))
    );
  });
  if (!hit) return null;
  r.take(m, "calendar");
  return hit.id;
}

function readPeople(r: Reader, directory: ComposerPerson[]): ComposerPerson[] {
  const people: ComposerPerson[] = [];
  const add = (p: ComposerPerson) => {
    if (!people.some((x) => x.id === p.id)) people.push(p);
  };
  for (const m of r.text.matchAll(EMAIL_RE)) {
    const email = m[0].toLowerCase();
    r.take(m as RegExpExecArray, "person");
    add(
      directory.find((p) => p.email?.toLowerCase() === email) ?? {
        id: email,
        name: email,
        email,
        member: false,
      },
    );
  }
  for (const m of r.lower.matchAll(PEOPLE_RE)) {
    const name = m[2] ?? m[3];
    // "@outside" inside an email is not a person.
    if (m[3] && /[\w.]/.test(r.lower[(m.index ?? 0) - 1] ?? "")) continue;
    const exact = m[1] === "and";
    const hit = directory.find((p) => {
      const first = firstName(p).toLowerCase();
      return exact ? first === name : name.length >= 2 && first.startsWith(name);
    });
    if (!hit) continue;
    const start = (m.index ?? 0) + m[0].length - name.length;
    const tok = Object.assign([name], { index: start, input: r.lower }) as RegExpExecArray;
    r.take(tok, "person");
    add(hit);
  }
  return people;
}

function readOnline(r: Reader): OnlineProvider | null {
  const m = ONLINE_RE.exec(r.lower);
  if (!m) return null;
  r.take(m, "where");
  const w = m[1] ?? m[2];
  return w === "zoom" ? "zoom" : w === "teams" ? "teams" : "meet";
}

function readPlace(r: Reader, people: ComposerPerson[], directory: ComposerPerson[]): string | null {
  let m = OFFICE_RE.exec(r.lower);
  if (m) {
    r.take(m, "where");
    return m[1] ? "In person" : "The office";
  }
  m = PLACE_RE.exec(r.text);
  if (!m) return null;
  const name = m[1].trim();
  const first = name.split(/\s+/)[0].toLowerCase().replace(/['’]s$/, "");
  const isDay = DAY_RE.test(first) && DAY_RE.exec(first)?.[0] === first;
  const isPerson = [...people, ...directory].some((p) =>
    firstName(p).toLowerCase().startsWith(first),
  );
  if (isDay || isPerson || first === "noon") return null;
  r.take(m, "where");
  return name;
}

function titleOf(r: Reader, people: ComposerPerson[], kind: ComposerKind): string {
  let title = r.text;
  const cut = r.tokens.filter((t) => t.kind !== "person").sort((a, b) => b.start - a.start);
  for (const t of cut) title = `${title.slice(0, t.start)} ${title.slice(t.end)}`;
  // Emails read as the person's first name (or the address's name part).
  title = title.replace(EMAIL_RE, (email) => {
    const p = people.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    return p && p.name !== p.email ? firstName(p) : (email.split("@")[0] ?? email).split(".")[0];
  });
  title = title.replace(/@([a-z][\w'’-]*)/gi, (whole, n: string) => {
    const p = people.find((x) => firstName(x).toLowerCase().startsWith(n.toLowerCase()));
    return p ? firstName(p) : whole;
  });
  title = title
    .replace(/\s+/g, " ")
    .replace(/\s+(on|at|for|via|in)\s*$/i, "")
    .trim();
  if (!title && kind === "focus") return "Focus time";
  return title.charAt(0).toUpperCase() + title.slice(1);
}

function defaultLength(kind: ComposerKind, lower: string): number {
  if (kind === "focus") return 120;
  return LONG_MEAL.test(lower) ? 60 : 30;
}

export function parseComposer(text: string, ctx: ComposerContext): ComposerParse {
  const r = reader(text);
  let kind: ComposerKind = "event";
  const lead = /^\s*(focus|block)\b:?/.exec(r.lower);
  if (lead) {
    kind = "focus";
    r.take(lead, "kind");
  }
  const named = readDay(r, ctx.nowMs);
  const time = readTime(r);
  const duration = readDuration(r);
  let window = named?.window ?? null;
  if (time.start === null) {
    const w = /\b(morning|afternoon|evening)\b/.exec(r.lower);
    if (w) {
      r.take(w, "time");
      window = WINDOWS[w[1]];
    }
  }
  const calendarId = readCalendar(r, ctx.calendars);
  const people = readPeople(r, ctx.people);
  const online = readOnline(r);
  const place = readPlace(r, people, ctx.people);
  const meal = MEAL.test(r.lower);

  const length =
    duration ??
    (time.start !== null && time.end !== null
      ? time.end - time.start
      : defaultLength(kind, r.lower));
  const dayStartMs = named?.dayStartMs ?? ctx.base.dayStartMs;
  let startMs: number;
  let firstFree = false;
  if (time.start !== null) {
    startMs = atMinute(dayStartMs, time.start);
  } else if (!window && ctx.base.startMinute !== null && dayStartMs === ctx.base.dayStartMs) {
    // Nothing names a time and the day is where the box opened: stay there.
    startMs = atMinute(dayStartMs, ctx.base.startMinute);
  } else {
    // A day without a time lands at that day's first free time.
    const from = window ? window[0] : ctx.workStartMinute;
    const until = window ? window[1] : ctx.workEndMinute;
    const free = firstFreeStart({
      dayStartMs,
      fromMinute: from,
      untilMinute: Math.max(until, from + length),
      lengthMinutes: length,
      nowMs: ctx.nowMs,
      busy: ctx.busyOn(dayStartMs),
    });
    startMs = free ?? atMinute(dayStartMs, from);
    firstFree = true;
  }
  const whenKey = r.tokens
    .filter((t) => t.kind === "day" || t.kind === "time")
    .sort((a, b) => a.start - b.start)
    .map((t) => r.lower.slice(t.start, t.end))
    .join("|");
  return {
    kind,
    title: titleOf(r, people, kind),
    startMs,
    endMs: startMs + length * 60_000,
    firstFree,
    calendarId,
    people,
    place,
    online,
    meal,
    tokens: r.tokens.slice().sort((a, b) => a.start - b.start),
    whenKey,
  };
}

/** The local midnight of an instant (for callers working in days). */
export function composerDayOf(ms: number): number {
  return dayOf(ms);
}
