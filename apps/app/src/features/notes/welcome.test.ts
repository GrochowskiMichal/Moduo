import { describe, expect, it } from "@rstest/core";

import { buildDocStateFromMarkdown } from "./editor/materialize";
import { firstLineTitle } from "./title";
import { WELCOME_MARKDOWN, WELCOME_TITLE } from "./welcome";

describe("the welcome note's content", () => {
  it("materializes into a doc whose first line is the note's title", () => {
    const built = buildDocStateFromMarkdown("welcome", WELCOME_MARKDOWN);
    expect(built).not.toBeNull();
    // Opening it derives the same title the note was created with, so the
    // first visit can't rename it.
    expect(firstLineTitle(built!.bodyText)).toBe(WELCOME_TITLE);
  });

  it("keeps its checklist as real checkboxes, never live tasks", () => {
    const built = buildDocStateFromMarkdown("welcome", WELCOME_MARKDOWN)!;
    expect(built.bodyMd).toContain("- [x] Open Notes");
    expect(built.bodyMd).not.toContain("moduo:task:");
  });
});
