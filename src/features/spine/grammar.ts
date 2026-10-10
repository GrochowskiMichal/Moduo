// The app's reference grammar (tasks-v3 §10–11, calls 33, 33a; GR-0 folded
// into RF-1): `@` mentions people and things, `#` is tags, `/` runs commands.
// One tokenizer, shared by capture (the task title line, the search box) and
// prose (descriptions, comments, notes), so a symbol means the same thing
// wherever it is typed. Pure: no React, no runtime, no Lexical.
//
// The rules every surface follows:
// - A symbol only counts at the start of the text or after whitespace, so
//   `C#`, `and/or`, `7/11` and an email address stay text.
// - `#` followed by digits only (`#123`) is a number, never a tag.
// - `/today`, `/tomorrow`, `/next week` and `/date` are the date commands. In
//   capture they set the date and leave the title; in prose they insert a
//   date chip that reads "Tomorrow" while that's true (33a).
// - A task handle (`MOD-142`) is recognised only for the workspace's own keys,
//   so `UTF-8` or `COVID-19` never turn into links.

export type Sigil = "@" | "#" | "/";

export const SIGILS: readonly Sigil[] = ["@", "#", "/"];

/** True when a sigil at `index` of `text` starts a token (line start or after whitespace). */
export function isTokenStart(text: string, index: number): boolean {
  if (index <= 0) return true;
  return /\s/.test(text[index - 1] ?? "");
}

/** `#123` is a number and `#` alone is nothing: neither is a tag. */
export function isLiteralWord(sigil: Sigil, word: string): boolean {
  if (!word) return true;
  return sigil === "#" && /^\d+$/.test(word);
}

/** What the caret sits right after: a sigil at a token start and the word typed since. */
export type TriggerQuery = { sigil: Sigil; start: number; query: string };

/**
 * How many words a `/` query may run to: the type's word and a four-word
 * title ("/task Order frames from printer"), or a date command ("/next week").
 */
export const MAX_COMMAND_WORDS = 5;

/**
 * The trigger the caret sits right after in `before` (the text up to the
 * caret), or null. A mention or tag query holds no whitespace; a `/` query may
 * run to a few words ("/next we", "/Order frames from…": the date commands are
 * words, and `/` creates things with a title).
 */
export function triggerAt(before: string, sigils: readonly Sigil[] = SIGILS): TriggerQuery | null {
  let spaces = 0;
  for (let i = before.length - 1; i >= 0; i--) {
    const ch = before[i];
    if (ch === "\n") return null;
    if ((sigils as readonly string[]).includes(ch) && isTokenStart(before, i)) {
      const sigil = ch as Sigil;
      const query = before.slice(i + 1);
      // A command starts right after its `/` ("a / b" is prose, never a menu);
      // `#123` is a number, not a tag being typed.
      const ok =
        sigil === "/"
          ? spaces < MAX_COMMAND_WORDS && /^(?:[^\s/]+(?: [^\s/]*)*)?$/.test(query)
          : spaces === 0 && /^[^\s@#/]*$/.test(query) && !(sigil === "#" && /^\d+$/.test(query));
      return ok ? { sigil, start: i, query } : null;
    }
    // A space ends a mention; only a `/` command can hold a few.
    if (/\s/.test(ch)) {
      spaces += 1;
      if (!sigils.includes("/") || spaces >= MAX_COMMAND_WORDS) return null;
    }
  }
  return null;
}

/** One finished `#word` / `@word` / `/word` in a line of text. */
export type SigilWord = { sigil: Sigil; word: string; start: number; end: number };

/**
 * Every finished sigil word in `text`: a sigil at a token start followed by a
 * word, then whitespace (or the end, when `final`). An unfinished last word
 * (`#des` while typing `#design`) isn't one yet. Literal words (`#123`) and
 * symbols inside words (`C#`) are skipped.
 */
export function findSigilWords(
  text: string,
  opts: { sigils?: readonly Sigil[]; final?: boolean } = {},
): SigilWord[] {
  const sigils = opts.sigils ?? SIGILS;
  const out: SigilWord[] = [];
  // A word runs to whitespace or the next `@` / `#` (a tag may hold a `/`).
  const re = /[@#/][^\s@#]+/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const sigil = m[0][0] as Sigil;
    if (!sigils.includes(sigil) || !isTokenStart(text, m.index)) continue;
    const end = m.index + m[0].length;
    const finished = end < text.length ? /\s/.test(text[end] ?? "") : opts.final === true;
    const word = m[0].slice(1);
    if (!finished || isLiteralWord(sigil, word)) continue;
    out.push({ sigil, word, start: m.index, end });
  }
  return out;
}

// ── date commands (33a) ──────────────────────────────────────────────────────

export type DateCommandId = "today" | "tomorrow" | "next-week" | "date";

export type DateCommand = {
  id: DateCommandId;
  /** What the menu shows. */
  label: string;
  /** The command as typed after `/`. */
  word: string;
  /** Opens a picker instead of naming a day. */
  picker?: boolean;
};

/** The date commands, in the order the `/` menu lists them (first). */
export const DATE_COMMANDS: readonly DateCommand[] = [
  { id: "today", label: "Today", word: "today" },
  { id: "tomorrow", label: "Tomorrow", word: "tomorrow" },
  { id: "next-week", label: "Next week", word: "next week" },
  { id: "date", label: "Date…", word: "date", picker: true },
];

/** A local calendar date as `YYYY-MM-DD`. */
export function isoDay(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * The day a command names, as `YYYY-MM-DD` in the device's zone; null for
 * `/date`, which asks. "Next week" is the coming Monday (the week starts on
 * Monday until Settings → Time & region lands, TV-D14).
 */
export function dateCommandDay(id: DateCommandId, now: Date = new Date()): string | null {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (id === "today") return isoDay(d);
  if (id === "tomorrow") {
    d.setDate(d.getDate() + 1);
    return isoDay(d);
  }
  if (id === "next-week") {
    const toMonday = (8 - d.getDay()) % 7 || 7;
    d.setDate(d.getDate() + toMonday);
    return isoDay(d);
  }
  return null;
}

/** The date commands a `/` query could still become ("to" → Today, Tomorrow). */
export function matchDateCommands(query: string): DateCommand[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...DATE_COMMANDS];
  return DATE_COMMANDS.filter((c) => c.word.startsWith(q) || c.label.toLowerCase().startsWith(q));
}

const SLASH_DATE = /(^|\s)\/(today|tomorrow|next week)(?=\s|$|[.,;:!?])/gi;

function commandFromWord(word: string): DateCommandId {
  const lower = word.toLowerCase();
  return lower === "next week" ? "next-week" : (lower as DateCommandId);
}

/**
 * `/today`, `/tomorrow` and `/next week` in prose written as plain text (a
 * comment), each swapped for what `replace` makes of its day (a date chip's
 * stored form). Text with no command comes back unchanged.
 */
export function replaceSlashDates(
  text: string,
  replace: (day: string) => string,
  now: Date = new Date(),
): string {
  return text.replace(SLASH_DATE, (match, lead: string, word: string) => {
    const day = dateCommandDay(commandFromWord(word), now);
    return day ? `${lead}${replace(day)}` : match;
  });
}

/**
 * `/today`, `/tomorrow` and `/next week` typed in a capture line: the day the
 * last one names and the line without them (a date command leaves the title,
 * 33a). Text with no command comes back unchanged with a null day.
 */
export function takeSlashDates(
  text: string,
  now: Date = new Date(),
): { text: string; day: string | null } {
  const found: { day: string | null } = { day: null };
  const rest = text.replace(SLASH_DATE, (_m, lead: string, word: string) => {
    found.day = dateCommandDay(commandFromWord(word), now);
    return lead;
  });
  if (found.day === null) return { text, day: null };
  return { text: rest.replace(/\s{2,}/g, " ").trim(), day: found.day };
}

// ── task handles (TV-D8 handles, RF-1 auto-links) ──────────────────────────

/** A handle found in text: `MOD-142` with its key and number. */
export type HandleMatch = {
  handle: string;
  key: string;
  number: number;
  start: number;
  end: number;
};

/** Does `value` look like a handle (`MOD-142`, any case)? */
export function looksLikeHandle(value: string): boolean {
  return /^[A-Za-z]{2,5}-\d{1,9}$/.test(value.trim());
}

/**
 * Every `KEY-number` in `text` whose key is one of `keys` (upper case, whole
 * word: letters, digits or a hyphen on either side mean it's part of
 * something else). With no keys there are no handles.
 */
export function findHandles(text: string, keys: readonly string[]): HandleMatch[] {
  if (keys.length === 0) return [];
  const wanted = new Set(keys.map((k) => k.toUpperCase()));
  const out: HandleMatch[] = [];
  const re = /([A-Z]{2,5})-(\d{1,9})/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const before = text[m.index - 1] ?? "";
    const after = text[m.index + m[0].length] ?? "";
    if (/[A-Za-z0-9-]/.test(before) || /[A-Za-z0-9-]/.test(after)) continue;
    if (!wanted.has(m[1])) continue;
    out.push({
      handle: m[0],
      key: m[1],
      number: Number(m[2]),
      start: m.index,
      end: m.index + m[0].length,
    });
  }
  return out;
}
