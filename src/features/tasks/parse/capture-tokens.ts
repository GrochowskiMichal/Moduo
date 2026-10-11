// The capture title's grammar (tasks-v3 §10, calls 33, 33a, 92; TV-U14). Pure:
// no React, no Lexical, no runtime, so the rules are unit-tested here and the
// editor only turns what's typed into segments.
//
// A capture title is text with tokens in it. A token is something the `@`, `#`
// or `/` menu recognised:
// - tokens that SET a property (a person, a team, a tag, a date, a `/`
//   command) leave the title when the task is created and fill their pill (92);
// - tokens that LINK a thing (a contact, note, email, event or task) stay in
//   the title as words and become links ("Call @Anna about @Acme rebrand"
//   still reads as a sentence);
// - a project never stays a token: picking one moves it into the destination
//   row at once (the editor does that).
// Plain date words ("tomorrow 3pm", "every Tuesday") are read by the capture
// parser and leave the title too, unless the person kept them as words (Esc on
// the highlight). An explicit date (a `/` command or a date set on the pill)
// wins over date words, which then stay the person's words.

import type { EntityRef } from "../../../lib/entity-links";
import { findSigilWords } from "../../spine/grammar";
import type { PriorityLevel, RecurrenceRule } from "../model";
import { type ParsedCapture, parseCapture } from "./capture-parser";

/** A recognised token in a capture title. */
export type CaptureToken =
  | { kind: "person"; userId: string; label: string }
  | { kind: "team"; teamId: string; label: string; letters?: string | null }
  /** A tag by id, or a new one to make by name (`tagId: null`). */
  | { kind: "tag"; tagId: string | null; label: string; color?: string | null }
  /** A due day (`YYYY-MM-DD`): `/today`, `/tomorrow`, `/next week`, `/date`, `/due …`. */
  | { kind: "due"; day: string; label: string }
  /** A scheduled time (ISO): `/schedule …`. */
  | { kind: "schedule"; at: string; label: string }
  | { kind: "repeat"; rule: RecurrenceRule; label: string }
  | { kind: "priority"; level: PriorityLevel; label: string }
  | { kind: "estimate"; minutes: number; label: string }
  /** A reminder time (ISO): `/remind 4pm`. */
  | { kind: "remind"; at: string; label: string }
  /** A linked thing: it stays in the title as words and becomes a link. */
  | { kind: "thing"; ref: EntityRef; label: string };

export type CaptureTokenKind = CaptureToken["kind"];

/** One piece of a capture title: words, or a token. */
export type TitleSegment = { text: string } | { token: CaptureToken };

/** Fields that hold one value: a second token of the kind replaces the first. */
export const SINGLE_VALUE_KINDS: ReadonlySet<CaptureTokenKind> = new Set([
  "person",
  "team",
  "due",
  "schedule",
  "repeat",
  "priority",
  "estimate",
  "remind",
]);

/** The token kinds that set a date (one wins over date words). */
const DATE_KINDS: ReadonlySet<CaptureTokenKind> = new Set(["due", "schedule", "repeat"]);

/** Does this token leave the title on save (92)? Everything but a linked thing. */
export function leavesTitle(token: CaptureToken): boolean {
  return token.kind !== "thing";
}

/** What a token reads as when it falls back to words (a replaced one, Esc). */
export function tokenText(token: CaptureToken): string {
  switch (token.kind) {
    case "person":
    case "team":
      return `@${token.label}`;
    case "tag":
      return `#${token.label}`;
    case "thing":
      return token.label;
    default:
      return token.label;
  }
}

/** Dates set by hand on the pills (they beat date words, like a `/` command). */
export type ManualDates = {
  dueDay?: string | null;
  scheduledAt?: string | null;
  recurrence?: RecurrenceRule | null;
};

export type ResolveOptions = {
  now?: Date;
  /** Date phrases the person kept as words (Esc on the highlight). */
  keep?: readonly string[];
  /** Dates set on the pills: when any is set, date words stay words. */
  manualDates?: ManualDates;
};

/** A capture title, read. */
export type ResolvedTitle = {
  /** The title the task gets: words and linked things, without property tokens or dates. */
  title: string;
  /**
   * The words as the date reader saw them: text segments, things' names, one
   * space per property token. `highlights` point into this.
   */
  text: string;
  /** Where each text segment starts in `text` (by segment index; tokens are absent). */
  segmentStarts: Map<number, number>;
  /** Date words that apply, as `[start, end)` in `text` (what capture highlights). */
  highlights: Array<[number, number]>;
  /** The phrases behind `highlights`, in order. */
  phrases: string[];
  /** The last token of each single-value kind. */
  single: Partial<{ [K in CaptureTokenKind]: Extract<CaptureToken, { kind: K }> }>;
  /** Every tag token, first to last, without repeats. */
  tags: Array<Extract<CaptureToken, { kind: "tag" }>>;
  /** Every linked thing, without repeats. */
  things: Array<Extract<CaptureToken, { kind: "thing" }>>;
  /** What the date words say, when they apply (no explicit date anywhere). */
  words: ParsedCapture | null;
};

const collapse = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

/**
 * Read a capture title. Property tokens drop out of the title; linked things
 * stay as their names; date words are read (and leave the title) only when no
 * explicit date is set by a token or a pill.
 */
export function resolveTitle(
  segments: readonly TitleSegment[],
  opts: ResolveOptions = {},
): ResolvedTitle {
  const now = opts.now ?? new Date();
  let text = "";
  const segmentStarts = new Map<number, number>();
  const ignore: Array<[number, number]> = [];
  const single: ResolvedTitle["single"] = {};
  const tags: ResolvedTitle["tags"] = [];
  const things: ResolvedTitle["things"] = [];
  const seenTags = new Set<string>();
  const seenThings = new Set<string>();

  segments.forEach((segment, index) => {
    if ("text" in segment) {
      segmentStarts.set(index, text.length);
      text += segment.text;
      return;
    }
    const token = segment.token;
    if (token.kind === "thing") {
      // Its name stays, but is never read as a date ("Prepare @Monday notes").
      const start = text.length;
      text += token.label;
      ignore.push([start, text.length]);
      const key = `${token.ref.type}:${token.ref.id}`;
      if (!seenThings.has(key)) {
        seenThings.add(key);
        things.push(token);
      }
      return;
    }
    // A property token leaves a gap, so the words on either side stay apart.
    text += " ";
    if (token.kind === "tag") {
      const key = token.tagId ?? `new:${token.label.toLowerCase()}`;
      if (!seenTags.has(key)) {
        seenTags.add(key);
        tags.push(token);
      }
      return;
    }
    (single as any)[token.kind] = token;
  });

  const manual = opts.manualDates ?? {};
  const explicitDate =
    [...DATE_KINDS].some((k) => k in single) ||
    Boolean(manual.dueDay || manual.scheduledAt || manual.recurrence);

  // Offsets below are into the trimmed text; keep the lead to map back.
  const lead = text.length - text.trimStart().length;
  const shifted = ignore.map(([a, b]): [number, number] => [a - lead, b - lead]);
  let words: ParsedCapture | null = null;
  let title: string;
  if (explicitDate) {
    title = collapse(text);
  } else {
    const parsed = parseCapture(text, now, { keep: opts.keep, ignore: shifted });
    if (parsed.matched || parsed.unparsedRecurrence) words = parsed;
    title = collapse(parsed.matched ? parsed.title : text);
  }
  const highlights = (words?.spans ?? []).map(([a, b]): [number, number] => [a + lead, b + lead]);
  return {
    title,
    text,
    segmentStarts,
    highlights,
    phrases: highlights.map(([a, b]) => text.slice(a, b)),
    single,
    tags,
    things,
    words: words?.matched ? words : null,
  };
}

/** The dates a capture ends up with: a token, else the pills, else the words. */
export type CaptureDates = {
  /** `YYYY-MM-DD` (a date alone sets due, 33a). */
  dueDay: string | null;
  /** ISO; a date with a time schedules it. */
  scheduledAt: string | null;
  recurrence: RecurrenceRule | null;
};

/** A local day (`YYYY-MM-DD`) from an ISO time. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export function captureDates(resolved: ResolvedTitle, manual: ManualDates = {}): CaptureDates {
  const { single } = resolved;
  // Per field, a token beats a hand pick; either beats date words.
  if (
    single.due ||
    single.schedule ||
    single.repeat ||
    manual.dueDay ||
    manual.scheduledAt ||
    manual.recurrence
  ) {
    const recurrence = single.repeat?.rule ?? manual.recurrence ?? null;
    return {
      dueDay: single.due?.day ?? manual.dueDay ?? null,
      scheduledAt: single.schedule?.at ?? manual.scheduledAt ?? recurrence?.nextOccurrence ?? null,
      recurrence,
    };
  }
  const words = resolved.words;
  if (!words) return { dueDay: null, scheduledAt: null, recurrence: null };
  return {
    dueDay: words.dueDate ? localDay(words.dueDate) : null,
    scheduledAt: words.scheduledAt,
    recurrence: words.recurrence,
  };
}

// ── typed lines (subtasks, pasted lists) ────────────────────────────────────

/** Who and what a typed line's `@` and `#` words can name. */
export type PlainLineContext = {
  people: ReadonlyArray<{ userId: string; name: string }>;
  teams: ReadonlyArray<{ id: string; name: string; letters?: string | null }>;
  tags: ReadonlyArray<{ id: string; name: string; color?: string | null }>;
};

/** "anna" names "Anna Kowalski" (a first name or the whole name, no spaces). */
function nameMatches(name: string, word: string): boolean {
  const w = word.toLowerCase();
  const full = name.toLowerCase();
  return full.replace(/\s+/g, "") === w || full.split(/\s+/)[0] === w;
}

/**
 * A line typed without menus (a subtask, a pasted line) as segments: `@word`
 * naming exactly one person or team and `#word` naming an existing tag become
 * tokens; anything else (`C#`, `#123`, `and/or`, an `@` nobody answers to)
 * stays text. `/today`-family commands stay in the words, where the date
 * reader takes them (with a clock time, they schedule).
 */
export function segmentsFromLine(line: string, ctx: PlainLineContext): TitleSegment[] {
  const text = line;
  const segments: TitleSegment[] = [];
  let at = 0;
  for (const word of findSigilWords(text, { sigils: ["@", "#"], final: true })) {
    let token: CaptureToken | null = null;
    if (word.sigil === "@") {
      const people = ctx.people.filter((p) => nameMatches(p.name, word.word));
      const teams = ctx.teams.filter((t) => nameMatches(t.name, word.word));
      if (people.length === 1 && teams.length === 0) {
        token = { kind: "person", userId: people[0].userId, label: people[0].name };
      } else if (teams.length === 1 && people.length === 0) {
        const t = teams[0];
        token = { kind: "team", teamId: t.id, label: t.name, letters: t.letters ?? null };
      }
    } else {
      const tag = ctx.tags.find((t) => t.name.toLowerCase() === word.word.toLowerCase());
      if (tag) token = { kind: "tag", tagId: tag.id, label: tag.name, color: tag.color ?? null };
    }
    if (!token) continue;
    if (word.start > at) segments.push({ text: text.slice(at, word.start) });
    segments.push({ token });
    at = word.end;
  }
  if (at < text.length) segments.push({ text: text.slice(at) });
  return segments;
}
