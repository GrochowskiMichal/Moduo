import { describe, expect, it } from "vitest";
import { findQuoteOffset, formatQuoteComment, parseQuoteComment } from "./quote";

describe("quote-comment body round-trip (AC9)", () => {
  it("formats a quote as a leading blockquote then the text", () => {
    expect(formatQuoteComment("hello world", "my thought")).toBe("> hello world\n\nmy thought");
  });

  it("no quote → plain body", () => {
    expect(formatQuoteComment(null, "just a comment")).toBe("just a comment");
    expect(formatQuoteComment("   ", "c")).toBe("c");
  });

  it("multi-line quote → each line prefixed", () => {
    expect(formatQuoteComment("a\nb", "c")).toBe("> a\n> b\n\nc");
  });

  it("parse splits quote from text", () => {
    expect(parseQuoteComment("> hello world\n\nmy thought")).toEqual({
      quote: "hello world",
      text: "my thought",
    });
  });

  it("parse of a plain body → no quote", () => {
    expect(parseQuoteComment("just a comment")).toEqual({ quote: null, text: "just a comment" });
  });

  it("format→parse round-trips (carries the snippet)", () => {
    const body = formatQuoteComment("the snippet", "the note");
    expect(parseQuoteComment(body)).toEqual({ quote: "the snippet", text: "the note" });
  });
});

describe("findQuoteOffset — scroll-find (AC9)", () => {
  it("finds the quote tolerant of whitespace re-wrapping (moved text)", () => {
    expect(findQuoteOffset("Here is  the\n  Snippet in the doc", "the snippet")).not.toBeNull();
  });

  it("returns null when the text was edited away (degrade to quote-only)", () => {
    expect(findQuoteOffset("completely different text", "the snippet")).toBeNull();
  });

  it("empty quote → null", () => {
    expect(findQuoteOffset("anything", "  ")).toBeNull();
  });
});
