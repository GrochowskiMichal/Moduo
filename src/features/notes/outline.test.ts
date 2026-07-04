import { describe, expect, it } from "vitest";
import { extractOutline } from "./outline";

describe("extractOutline", () => {
  it("pulls headings with levels and order", () => {
    const md = "# Title\n\nsome text\n\n## Section A\n\n### Sub\n\n## Section B";
    expect(extractOutline(md)).toEqual([
      { level: 1, text: "Title", index: 1 },
      { level: 2, text: "Section A", index: 2 },
      { level: 3, text: "Sub", index: 3 },
      { level: 2, text: "Section B", index: 4 },
    ]);
  });

  it("ignores # inside fenced code blocks", () => {
    const md = "# Real\n\n```\n# not a heading\n```\n\n## Also real";
    expect(extractOutline(md).map((h) => h.text)).toEqual(["Real", "Also real"]);
  });

  it("empty / heading-less md → []", () => {
    expect(extractOutline("just prose\nno headings")).toEqual([]);
    expect(extractOutline("")).toEqual([]);
  });
});
