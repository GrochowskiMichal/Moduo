// GS-10 (specs/global-search.md Q16, AC13): the words a note highlights when
// it opens from a body hit. They follow search__query (GS-1,
// 20261028220000_search_primitives.sql) so the highlight shows what the server
// matched: the query is cut to 256 characters and 32 words, accents and case
// never matter, a word of 3+ letters matches word-starts, a shorter one whole
// words only, and a negated word ("-draft") or the "or" operator matches
// nothing. Pure so it is testable without an editor.

import {
  SEARCH_PREFIX_MIN_LETTERS,
  SEARCH_QUERY_MAX_CHARS,
  SEARCH_QUERY_MAX_WORDS,
} from "@contracts/search";

export type HighlightTerm = { text: string; prefix: boolean };
export type HighlightRange = { start: number; end: number };

/** Letters unaccent folds that NFD can't take apart. */
const FOLD_EXTRA: Record<string, string> = { ł: "l", ø: "o", đ: "d", ı: "i" };

/** Folds text for matching, keeping where each folded char came from. */
function fold(text: string): { folded: string; at: number[] } {
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let plain = text[i]!.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    plain = FOLD_EXTRA[plain] ?? plain;
    for (const ch of plain) {
      folded += ch;
      at.push(i);
    }
  }
  return { folded, at };
}

const WORD = /[\p{L}\p{N}]+/gu;

/** The words of a query to highlight, in order, each once. */
export function searchHighlightTerms(query: string): HighlightTerm[] {
  const pieces = query.slice(0, SEARCH_QUERY_MAX_CHARS).trim().split(/\s+/);
  const out: HighlightTerm[] = [];
  const seen = new Set<string>();
  for (const piece of pieces.slice(0, SEARCH_QUERY_MAX_WORDS)) {
    // websearch syntax: "-word" is negated, a bare "or" joins.
    if (piece.startsWith("-") || piece.toLowerCase() === "or") continue;
    for (const [word] of fold(piece).folded.matchAll(WORD)) {
      if (seen.has(word)) continue;
      seen.add(word);
      out.push({ text: word, prefix: word.length >= SEARCH_PREFIX_MIN_LETTERS });
    }
  }
  return out;
}

/** How much of `word` the terms mark from its start (0: none). */
function matchedLength(word: string, terms: HighlightTerm[]): number {
  let len = 0;
  for (const term of terms) {
    const ok = term.prefix ? word.startsWith(term.text) : word === term.text;
    if (ok) len = Math.max(len, term.text.length);
  }
  return len;
}

/** Ranges in order, overlapping or touching ones joined. */
function mergeRanges(hits: HighlightRange[]): HighlightRange[] {
  const merged: HighlightRange[] = [];
  for (const hit of hits) {
    const last = merged.at(-1);
    if (last && hit.start <= last.end) last.end = Math.max(last.end, hit.end);
    else merged.push({ ...hit });
  }
  return merged;
}

/** Where the terms match in `text` (UTF-16 offsets into the original), in
 * order, overlaps merged. A prefix term marks only the word-start it matched. */
export function searchHighlightRanges(text: string, terms: HighlightTerm[]): HighlightRange[] {
  if (terms.length === 0 || !text) return [];
  const { folded, at } = fold(text);
  const hits: HighlightRange[] = [];
  for (const m of folded.matchAll(WORD)) {
    const len = matchedLength(m[0], terms);
    if (len > 0) hits.push({ start: at[m.index]!, end: at[m.index + len - 1]! + 1 });
  }
  return mergeRanges(hits);
}
