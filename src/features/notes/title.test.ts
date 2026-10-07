import { describe, expect, it } from "@rstest/core";
import { displayTitle, firstLineTitle, TITLE_MAX_LENGTH } from "./title";

describe("firstLineTitle (AC1)", () => {
  it("takes exactly the first line", () => {
    expect(firstLineTitle("Weekly plan\nsecond line")).toBe("Weekly plan");
    expect(firstLineTitle("only line")).toBe("only line");
  });

  it("handles CRLF and collapses inner whitespace", () => {
    expect(firstLineTitle("A  title\twith   gaps\r\nbody")).toBe("A title with gaps");
  });

  it("empty doc / empty first line → empty title (storage stays honest)", () => {
    expect(firstLineTitle("")).toBe("");
    expect(firstLineTitle("\nbody on line two")).toBe("");
    expect(firstLineTitle("   \nbody")).toBe("");
  });

  it("caps at the boundary without a dangling space", () => {
    const long = "word ".repeat(60); // 300 chars
    const title = firstLineTitle(long);
    expect(title.length).toBeLessThanOrEqual(TITLE_MAX_LENGTH);
    expect(title.endsWith(" ")).toBe(false);
    expect(firstLineTitle("x".repeat(TITLE_MAX_LENGTH))).toHaveLength(TITLE_MAX_LENGTH);
  });
});

describe("displayTitle", () => {
  it("falls back to Untitled for empty/whitespace", () => {
    expect(displayTitle("")).toBe("Untitled");
    expect(displayTitle("   ")).toBe("Untitled");
    expect(displayTitle("Real")).toBe("Real");
  });
});
