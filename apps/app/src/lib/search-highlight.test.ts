// GS-10 (specs/global-search.md Q16, AC13): the words a note highlights when
// it opens from a body hit follow search__query's rule (GS-1): accents and case
// never matter, a word of 3+ letters matches word-starts, a shorter one whole
// words only, a negated word and "or" match nothing.

import { describe, expect, it } from "@rstest/core";

import { searchHighlightRanges, searchHighlightTerms } from "./search-highlight";

const marked = (text: string, query: string) =>
  searchHighlightRanges(text, searchHighlightTerms(query)).map((r) => text.slice(r.start, r.end));

describe("searchHighlightTerms", () => {
  it("folds accents and case, prefixes words of 3+ letters", () => {
    expect(searchHighlightTerms("Żółw ok")).toEqual([
      { text: "zolw", prefix: true },
      { text: "ok", prefix: false },
    ]);
  });

  it("drops negated words, the 'or' operator and punctuation", () => {
    expect(searchHighlightTerms('"budget plan" or -draft, …')).toEqual([
      { text: "budget", prefix: true },
      { text: "plan", prefix: true },
    ]);
  });

  it("is empty when nothing is searchable", () => {
    expect(searchHighlightTerms("  ")).toEqual([]);
    expect(searchHighlightTerms("-draft")).toEqual([]);
  });

  it("reads at most 32 words of at most 256 characters", () => {
    const words = Array.from({ length: 40 }, (_, i) => `word${i}`).join(" ");
    expect(searchHighlightTerms(words)).toHaveLength(32);
    expect(searchHighlightTerms(`${"a".repeat(300)}`)[0]!.text).toHaveLength(256);
  });
});

describe("searchHighlightRanges", () => {
  it("marks the word-start of a 3+ letter term, accent-insensitively", () => {
    expect(marked("Spotkanie o żółwiach jutro", "zolw")).toEqual(["żółw"]);
    expect(marked("Planning the plan", "plan")).toEqual(["Plan", "plan"]);
  });

  it("never matches inside a word", () => {
    expect(marked("airplane", "plan")).toEqual([]);
  });

  it("matches a short term as a whole word only", () => {
    expect(marked("ok, okay, OK", "ok")).toEqual(["ok", "OK"]);
  });

  it("returns ranges in text order, merged where terms overlap", () => {
    const text = "Quarterly quarter review";
    expect(searchHighlightRanges(text, searchHighlightTerms("quart quarterly review"))).toEqual([
      { start: 0, end: 9 },
      { start: 10, end: 15 },
      { start: 18, end: 24 },
    ]);
  });

  it("is empty without terms", () => {
    expect(searchHighlightRanges("anything", [])).toEqual([]);
  });
});
