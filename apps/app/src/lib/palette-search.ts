// GS-3 — the ⌘K palette's pure model over `search_all`'s rows
// (specs/global-search.md §Product behavior 4–7; Q1–Q3, Q8, Q14, Q15).
//
// The server ranks; this file only lays the answer out: one Top result, then
// groups in a fixed order (ranking moves rows inside a group, never the
// groups), up to 3 rows each with "Show all N", and type chips that narrow the
// search. Messages and Conversations come from search_all too (GS-6). Pure so
// it is testable without a runtime.

import type { SearchAllRow } from "@contracts/search";

import type { SnippetSegment } from "./search-snippet";

export type PaletteChipKey = "all" | "tasks" | "notes" | "contacts" | "events" | "chat" | "email";

export type PaletteGroupKey =
  "tasks" | "projects" | "notes" | "contacts" | "events" | "messages" | "conversations" | "email";

type GroupDef = {
  key: PaletteGroupKey;
  heading: string;
  /** The registry/contract types that fold into this group. */
  types: readonly string[];
  chip: Exclude<PaletteChipKey, "all">;
};

/** The groups, in their fixed order (Q2). */
export const PALETTE_GROUPS: readonly GroupDef[] = [
  { key: "tasks", heading: "Tasks", types: ["task"], chip: "tasks" },
  // The registry names a project `bucket`; links still say `project`.
  { key: "projects", heading: "Projects", types: ["bucket", "project"], chip: "tasks" },
  { key: "notes", heading: "Notes", types: ["note"], chip: "notes" },
  { key: "contacts", heading: "Contacts", types: ["contact", "company"], chip: "contacts" },
  { key: "events", heading: "Events", types: ["event"], chip: "events" },
  { key: "messages", heading: "Messages", types: ["chat_message"], chip: "chat" },
  { key: "conversations", heading: "Conversations", types: ["chat_channel"], chip: "chat" },
  { key: "email", heading: "Email", types: ["email_thread", "email"], chip: "email" },
];

/** Every type ⌘K asks `search_all` for. */
export const SEARCH_ALL_TYPES: string[] = PALETTE_GROUPS.flatMap((g) => [...g.types]);

const CHIPS: ReadonlyArray<{ key: PaletteChipKey; label: string; module?: string }> = [
  { key: "all", label: "All" },
  { key: "tasks", label: "Tasks", module: "tasks" },
  { key: "notes", label: "Notes", module: "notes" },
  { key: "contacts", label: "Contacts", module: "contacts" },
  { key: "events", label: "Events", module: "calendar" },
  { key: "chat", label: "Chat", module: "chat" },
  // Email is ungated at alpha, as the nav.
  { key: "email", label: "Email" },
];

export type PaletteChip = { key: PaletteChipKey; label: string };

/** The chips this person may use: a module they can't reach never shows (spec §9). */
export function paletteChips(perms: Partial<Record<string, string>>): PaletteChip[] {
  return CHIPS.filter((c) => !c.module || (perms[c.module] ?? "none") !== "none").map(
    ({ key, label }) => ({ key, label }),
  );
}

/** Tab (+1) and Shift+Tab (−1) between the chips, wrapping. */
export function stepChip(
  chips: readonly PaletteChip[],
  current: PaletteChipKey,
  dir: 1 | -1,
): PaletteChipKey {
  if (chips.length === 0) return "all";
  const at = chips.findIndex((c) => c.key === current);
  if (at < 0) return chips[dir === 1 ? Math.min(1, chips.length - 1) : chips.length - 1].key;
  return chips[(at + dir + chips.length) % chips.length].key;
}

/** "Show all N" selects its group's chip. */
export function chipForGroup(key: PaletteGroupKey): PaletteChipKey {
  return PALETTE_GROUPS.find((g) => g.key === key)?.chip ?? "all";
}

/** The types a chip asks `search_all` for ([] = don't ask it). */
export function chipTypes(chip: PaletteChipKey): string[] {
  if (chip === "all") return SEARCH_ALL_TYPES;
  return PALETTE_GROUPS.filter((g) => g.chip === chip).flatMap((g) => [...g.types]);
}

/** The groups a chip shows (all of them for All). */
export function chipGroups(chip: PaletteChipKey): PaletteGroupKey[] {
  return PALETTE_GROUPS.filter((g) => chip === "all" || g.chip === chip).map((g) => g.key);
}

export type PaletteGroupView = {
  key: PaletteGroupKey;
  heading: string;
  chip: PaletteChipKey;
  rows: SearchAllRow[];
  /** How many of this group's types matched (the server's per-type totals). */
  total: number;
  /** More matched than the palette shows here: offer "Show all N". */
  more: boolean;
};

export type PaletteView = { top: SearchAllRow | null; groups: PaletteGroupView[] };

const groupOf = (type: string) => PALETTE_GROUPS.find((g) => g.types.includes(type));
const sameItem = (a: SearchAllRow, b: SearchAllRow) =>
  a.entity_type === b.entity_type && a.entity_id === b.entity_id;

/** The Top result: the device's task-ID hit, else the row marked top, else the first. */
function pickTop(
  known: readonly SearchAllRow[],
  lead: SearchAllRow | null | undefined,
): SearchAllRow | null {
  return lead ?? known.find((h) => h.top) ?? known[0] ?? null;
}

/** A group's total: the server counts per type, and a group may fold two
 * (contact, company); never fewer than the rows in hand. */
function groupTotal(mine: readonly SearchAllRow[]): number {
  const totals = new Map<string, number>();
  for (const h of mine) {
    totals.set(h.entity_type, Math.max(totals.get(h.entity_type) ?? 0, h.type_total));
  }
  return Math.max(
    [...totals.values()].reduce((a, b) => a + b, 0),
    mine.length,
  );
}

function groupView(
  def: GroupDef,
  mine: readonly SearchAllRow[],
  top: SearchAllRow | null,
  perGroup: number | null,
): PaletteGroupView | null {
  const isTop = (h: SearchAllRow) => top !== null && sameItem(h, top);
  const rest = mine.filter((h) => !isTop(h));
  const rows = perGroup === null ? rest : rest.slice(0, perGroup);
  if (rows.length === 0) return null;
  const total = groupTotal(mine);
  const shown = rows.length + (mine.some(isTop) ? 1 : 0);
  return {
    key: def.key,
    heading: def.heading,
    chip: def.chip,
    rows,
    total,
    more: perGroup !== null && total > shown,
  };
}

/**
 * Lay the server's rows out. With All: the Top result (`lead`, the task this
 * device found by its ID, wins; else the row marked top, else the first), then
 * each group's first `perGroup` rows. With a chip: no Top result, its groups in
 * full. A row the palette can't open (no group) is dropped; the Top result is
 * never repeated in its group.
 */
export function buildPaletteView(
  hits: readonly SearchAllRow[],
  opts: { chip: PaletteChipKey; perGroup?: number; lead?: SearchAllRow | null },
): PaletteView {
  const wanted = new Set(chipGroups(opts.chip));
  const known = hits.filter((h) => {
    const g = groupOf(h.entity_type);
    return g !== undefined && wanted.has(g.key);
  });
  const all = opts.chip === "all";
  const top = all ? pickTop(known, opts.lead) : null;
  const perGroup = all ? (opts.perGroup ?? 3) : null;
  const groups = PALETTE_GROUPS.filter((def) => wanted.has(def.key))
    .map((def) =>
      groupView(
        def,
        known.filter((h) => def.types.includes(h.entity_type)),
        top,
        perGroup,
      ),
    )
    .filter((g): g is PaletteGroupView => g !== null);
  return { top, groups };
}

/** The server counts at most 50 of a type. */
export function showAllLabel(total: number): string {
  return total >= 50 ? "Show all 50+" : `Show all ${total}`;
}

// ── The query ────────────────────────────────────────────────────────────────

/** The words a query asks for: quotes dropped, excluded (`-word`) words out. */
function queryWords(query: string): string[] {
  return query
    .replace(/"/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 0 && !w.startsWith("-"));
}

/**
 * Whether a query is searched at all: two characters or more, and a word that
 * isn't excluded (spec §Edge cases: one-letter, empty or only-negative queries
 * show the empty view).
 */
export function searchableQuery(query: string): boolean {
  const q = query.trim();
  return q.length >= 2 && queryWords(q).length > 0;
}

/** One character folded the way the server's unaccent does: case and accents
 * off, "ł" to "l". One in, one out, so positions in the title hold. */
function fold(ch: string): string {
  const lower = ch.toLowerCase();
  if (lower === "ł") return "l";
  return lower.normalize("NFD").charAt(0);
}

const WORD = /[\p{L}\p{N}]+/gu;

/** The query's words, folded, as the title's words are compared with them. */
function foldedQueryWords(query: string): string[] {
  return queryWords(query)
    .flatMap((w) => w.match(WORD) ?? [])
    .map((w) => Array.from(w, fold).join(""));
}

/** How many letters of a title word the query marks: a word of 3+ letters by
 * its start, a shorter one only whole. 0 = none. */
function markedLength(titleWord: string, words: readonly string[]): number {
  let best = 0;
  for (const w of words) {
    const ok = w.length >= 3 ? titleWord.startsWith(w) : titleWord === w;
    if (ok) best = Math.max(best, Array.from(w).length);
  }
  return best;
}

/** Where the marks fall in the title, as [start, end) offsets. */
function markRanges(title: string, words: readonly string[]): Array<[number, number]> {
  const marks: Array<[number, number]> = [];
  for (const m of title.matchAll(WORD)) {
    const chars = Array.from(m[0]);
    const best = markedLength(chars.map(fold).join(""), words);
    if (best === 0) continue;
    const start = m.index ?? 0;
    marks.push([start, start + chars.slice(0, best).join("").length]);
  }
  return marks;
}

/**
 * The title as plain and marked runs: each title word that a query word starts
 * (3+ letters) or equals (1–2 letters) has that start marked, ignoring case and
 * accents, as the server matched it. A typo match marks nothing.
 */
export function titleSegments(title: string, query: string): SnippetSegment[] {
  const words = foldedQueryWords(query);
  const marks = words.length > 0 ? markRanges(title, words) : [];
  const out: SnippetSegment[] = [];
  let at = 0;
  for (const [start, end] of marks) {
    if (start > at) out.push({ text: title.slice(at, start), marked: false });
    out.push({ text: title.slice(start, end), marked: true });
    at = end;
  }
  if (at < title.length || out.length === 0) out.push({ text: title.slice(at), marked: false });
  return out;
}

// ── The item open now ────────────────────────────────────────────────────────

/**
 * The item a page has open, read from its URL the way entity-open writes it
 * (`/notes?id=…`, `/tasks?id=…`, `/contacts?type=…&id=…`, `/calendar?event=…`,
 * `/email?thread=…`, `/chat?c=…`), for the ranking's context term. Null when
 * nothing is open.
 */
export function openEntityFromUrl(
  pathname: string,
  search: string,
): { type: string; id: string } | null {
  const params = new URLSearchParams(search);
  const page = pathname.split("/").filter(Boolean)[0] ?? "";
  const pick = (type: string, key: string) => {
    const id = params.get(key);
    return id ? { type, id } : null;
  };
  switch (page) {
    case "notes":
      return pick("note", "id");
    case "tasks":
      return pick("task", "id");
    case "contacts": {
      const type = params.get("type");
      return type === "contact" || type === "company" ? pick(type, "id") : null;
    }
    case "calendar":
      return pick("event", "event");
    case "email":
      return pick("email_thread", "thread");
    case "chat":
      return pick("chat_channel", "c");
    default:
      return null;
  }
}
