/**
 * Finding a note from the sidebar (DESIGN_BRIEF §2a, specs/notes-refresh.md
 * "until NR-10 the sidebar keeps its full-text search") — pure.
 *
 * Titles match at once from the notes already on this device; the text of
 * notes comes from the server's full-text index a beat later. A note whose
 * title matched isn't listed again under its text. Case and accents never
 * matter ("zolw" finds "Żółw").
 */

import type { Note } from "./model";
import { byPosition } from "./tree";

/** Folds a string for matching, keeping where each folded char came from. */
function fold(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const plain = text[i]!.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace("ł", "l");
    for (const ch of plain) {
      folded += ch;
      at.push(i);
    }
  }
  return { folded, at };
}

/** The words of a query worth matching (one-letter words match everything). */
export function queryWords(query: string): string[] {
  return fold(query)
    .folded.split(/[\s"'(),.:;!?]+/)
    .filter((w) => w.length > 1 || /\d/.test(w));
}

/**
 * Notes whose title holds every word of the query, live ones first, then
 * those whose title starts with it, then sidebar order. Trashed notes never
 * show; archived ones do (they stay searchable, marked).
 */
export function findByTitle(notes: Note[], query: string, limit = 20): Note[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  const first = words[0]!;
  const scored: Array<{ note: Note; rank: number }> = [];
  for (const note of notes) {
    if (note.deletedAt) continue;
    const title = fold(note.title).folded;
    if (!words.every((w) => title.includes(w))) continue;
    const rank = (note.isArchived ? 2 : 0) + (title.startsWith(first) ? 0 : 1);
    scored.push({ note, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || byPosition(a.note, b.note));
  return scored.slice(0, limit).map((s) => s.note);
}

export type SnippetParts = { before: string; match: string; after: string };

/**
 * A line of a note's text around the first word of the query found in it,
 * cut at word boundaries, or the text's start when no word is found (the
 * server matched a form of the word the client can't see). Blocks read as
 * one line, separated by " · " rather than run together.
 */
export function bodySnippet(text: string, query: string, radius = 48): SnippetParts | null {
  const flat = text
    .split(/\n+/)
    .map((line) => line.replace(/^\s*(?:#{1,6}|[-*+]|\d+\.|>|\[[ x]\])\s+/i, "").trim())
    .filter(Boolean)
    .join(" · ");
  if (!flat) return null;
  const { folded, at } = fold(flat);
  let start = -1;
  let len = 0;
  for (const w of queryWords(query)) {
    const i = folded.indexOf(w);
    if (i !== -1 && (start === -1 || i < start)) {
      start = i;
      len = w.length;
    }
  }
  if (start === -1) {
    const head = flat.slice(0, radius * 2);
    return { before: "", match: "", after: head.length < flat.length ? `${trimEnd(head)}…` : head };
  }
  const from = at[start]!;
  const to = (at[start + len - 1] ?? from) + 1;
  let lo = Math.max(0, from - radius);
  let hi = Math.min(flat.length, to + radius);
  if (lo > 0) lo = Math.min(from, flat.indexOf(" ", lo) + 1 || lo);
  if (hi < flat.length) hi = Math.max(to, flat.lastIndexOf(" ", hi));
  return {
    before: `${lo > 0 ? "…" : ""}${flat.slice(lo, from)}`,
    match: flat.slice(from, to),
    after: `${flat.slice(to, hi)}${hi < flat.length ? "…" : ""}`,
  };
}

function trimEnd(text: string): string {
  const cut = text.lastIndexOf(" ");
  return cut > 0 ? text.slice(0, cut) : text;
}

/** Notes found by their text that weren't already found by their title, in the
 * server's order, trashed ones dropped. */
export function bodyOnlyHits<T extends { id: string; deletedAt: string | null }>(
  hits: T[],
  titleHits: Note[],
): T[] {
  const seen = new Set(titleHits.map((n) => n.id));
  return hits.filter((h) => !h.deletedAt && !seen.has(h.id));
}
