import { describe, expect, it } from "@rstest/core";

import { noteExcerpt } from "./note-excerpt";

describe("noteExcerpt", () => {
  it("leaves out the title line and separates the blocks", () => {
    const text = "Weekly sync, 21 October\n\nAttendees: Ana, Mike\n\nDecisions\n\nNotes ships.";
    expect(noteExcerpt(text, "Weekly sync, 21 October")).toBe(
      "Attendees: Ana, Mike · Decisions · Notes ships.",
    );
  });

  it("keeps a first line that isn't the title, and is null for no text", () => {
    expect(noteExcerpt("Just a thought", "Idea")).toBe("Just a thought");
    expect(noteExcerpt("Idea", "Idea")).toBeNull();
    expect(noteExcerpt(null)).toBeNull();
  });

  it("cuts a long text at a word, about two card lines", () => {
    const long = `Title\n\n${"word ".repeat(80)}`;
    const out = noteExcerpt(long, "Title")!;
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(241);
    expect(out.includes("  ")).toBe(false);
  });
});
