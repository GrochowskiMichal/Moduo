// Chat search's pure half (CV-19, spec §13): the snippet's marks, Polish
// without diacritics for names, the FilterBar's from · in · has a file · date
// and how they travel in the link, paging, and the find bar's stepping. The
// words themselves are matched by the server (`chat_search`); people are found
// here, through the member list, never through message text.

import type { FilterCondition, FilterDimension } from "@/components/ui/filter-model";
import type { ChatSearchHit, ChatSearchQuery } from "../model";

/** The server marks a match with U+E000 … U+E001 (never HTML). */
export const MARK_START = "";
export const MARK_END = "";

export type SnippetPart = { text: string; hit: boolean };

/** Splits a snippet into plain and matched runs; stray marks are dropped. */
export function splitSnippet(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let hit = false;
  let run = "";
  const push = () => {
    if (!run) return;
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += run;
    else parts.push({ text: run, hit });
    run = "";
  };
  for (const ch of snippet) {
    if (ch === MARK_START || ch === MARK_END) {
      push();
      hit = ch === MARK_START;
    } else {
      run += ch;
    }
  }
  push();
  return parts;
}

/** Lower case without diacritics: "Łukasz Żółw" → "lukasz zolw" (ł doesn't decompose). */
export function foldText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").replace(/[łŁ]/g, "l").toLowerCase();
}

/** People whose name has every typed word at a word's start, diacritics ignored. */
export function matchPeople<P extends { name: string }>(people: readonly P[], query: string): P[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return people.filter((p) => {
    const name = foldText(p.name).split(/[\s\-.]+/);
    return words.every((w) => name.some((part) => part.startsWith(w)));
  });
}

// ── The FilterBar: from · in · has a file · date ─────────────────────────────

export const DATE_RANGES = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Past 7 days" },
  { value: "30d", label: "Past 30 days" },
  { value: "365d", label: "Past year" },
] as const;
export type DateRange = (typeof DATE_RANGES)[number]["value"];

export function isDateRange(v: unknown): v is DateRange {
  return DATE_RANGES.some((r) => r.value === v);
}

/** The first instant a date filter keeps (local midnight for "Today"). */
export function dateRangeStart(range: DateRange, now: Date): string {
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 365;
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/** What the link holds of Chat's Search (`/chat?view=search&q=…`). */
export type SearchParams = {
  q?: string;
  from?: string;
  in?: string;
  file?: "1";
  date?: DateRange;
};

export const FILTER_FROM = "from";
export const FILTER_IN = "in";
export const FILTER_FILE = "file";
export const FILTER_DATE = "date";

export function conditionsFromParams(p: SearchParams): FilterCondition[] {
  const out: FilterCondition[] = [];
  if (p.from) out.push({ dimension: FILTER_FROM, operator: "is", values: [p.from] });
  if (p.in) out.push({ dimension: FILTER_IN, operator: "is", values: [p.in] });
  if (p.file) out.push({ dimension: FILTER_FILE, operator: "is", values: ["yes"] });
  if (p.date) out.push({ dimension: FILTER_DATE, operator: "is", values: [p.date] });
  return out;
}

/** The link's filters from the bar's conditions (one value each: the server takes one). */
export function paramsFromConditions(conditions: readonly FilterCondition[]): SearchParams {
  const first = (id: string) =>
    conditions.find((c) => c.dimension === id && c.operator === "is")?.values[0];
  const date = first(FILTER_DATE);
  return {
    ...(first(FILTER_FROM) ? { from: first(FILTER_FROM) } : {}),
    ...(first(FILTER_IN) ? { in: first(FILTER_IN) } : {}),
    ...(first(FILTER_FILE) === "yes" ? { file: "1" as const } : {}),
    ...(isDateRange(date) ? { date } : {}),
  };
}

/** The dimensions the bar offers: each is one pick and "is" (the server takes one value). */
export function searchDimensions(args: {
  people: readonly { userId: string; name: string }[];
  conversations: readonly { id: string; label: string }[];
}): FilterDimension[] {
  return [
    {
      id: FILTER_FROM,
      label: "From",
      operators: ["is"],
      multiple: false,
      options: args.people.map((p) => ({
        value: p.userId,
        label: p.name,
        keywords: [foldText(p.name)],
      })),
    },
    {
      id: FILTER_IN,
      label: "In",
      operators: ["is"],
      multiple: false,
      options: args.conversations.map((c) => ({
        value: c.id,
        label: c.label,
        keywords: [foldText(c.label)],
      })),
    },
    {
      id: FILTER_FILE,
      label: "Has a file",
      operators: ["is"],
      multiple: false,
      options: [{ value: "yes", label: "Yes" }],
    },
    {
      id: FILTER_DATE,
      label: "Date",
      operators: ["is"],
      multiple: false,
      options: DATE_RANGES.map((r) => ({ value: r.value, label: r.label })),
    },
  ];
}

/** The server call for the link's words and filters. */
export function searchQuery(
  workspaceId: string,
  p: SearchParams,
  now: Date,
): Omit<ChatSearchQuery, "before" | "limit"> {
  return {
    workspaceId,
    query: (p.q ?? "").trim(),
    channelId: p.in ?? null,
    fromId: p.from ?? null,
    after: p.date ? dateRangeStart(p.date, now) : null,
    hasFile: p.file === "1",
  };
}

// ── Paging and stepping ─────────────────────────────────────────────────────

/** A page holds at most this many; a full page means there may be more. */
export const SEARCH_PAGE = 50;

/** Appends an older page, dropping anything already shown. */
export function appendPage(shown: readonly ChatSearchHit[], page: readonly ChatSearchHit[]) {
  const seen = new Set(shown.map((h) => h.messageId));
  return [...shown, ...page.filter((h) => !seen.has(h.messageId))];
}

/** The key the next page starts below. */
export function pageCursor(shown: readonly ChatSearchHit[]) {
  const last = shown[shown.length - 1];
  return last ? { createdAt: last.createdAt, messageId: last.messageId } : null;
}

/** The find bar steps through hits newest first: "up" is older (further back). */
export function stepFind(index: number, count: number, direction: "older" | "newer"): number {
  if (count === 0) return -1;
  if (index < 0) return 0;
  return direction === "older" ? Math.min(count - 1, index + 1) : Math.max(0, index - 1);
}

/** "2 of 3"; a full page reads "2 of 50+". */
export function findPosition(index: number, count: number, full: boolean): string {
  if (count === 0) return "No matches";
  return `${index + 1} of ${count}${full ? "+" : ""}`;
}
