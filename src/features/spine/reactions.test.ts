// TV-U13 (REPLAN 88, AC11.8): the six fixed reactions, who reacted, and an
// edit that keeps what a comment stores.

import { COMMENT_REACTIONS } from "@contracts/vocabularies";
import { describe, expect, it } from "@rstest/core";

import { commentBodyWithReferences, editableComment } from "./comments";
import { toggledReactions } from "./hooks/use-comment-thread";
import { groupReactions, REACTION_GLYPHS, REACTION_NAMES, reactedBy } from "./reactions";

const names: Record<string, string> = { u1: "Maciej", u2: "Mike", u3: "Anna" };
const nameOf = (id: string) => names[id] ?? null;

describe("the six reactions", () => {
  it("are fixed, in order, each with a glyph and a spoken name", () => {
    expect([...COMMENT_REACTIONS]).toEqual([
      "thumbs_up",
      "check",
      "eyes",
      "pray",
      "heart",
      "smile",
    ]);
    expect(COMMENT_REACTIONS.map((r) => REACTION_GLYPHS[r]).join("")).toBe("👍✅👀🙏❤️😄");
    for (const r of COMMENT_REACTIONS) expect(REACTION_NAMES[r]).toBeTruthy();
  });

  it("group by reaction in the fixed order, with me first in who reacted", () => {
    const groups = groupReactions(
      [
        { userId: "u2", reaction: "heart" },
        { userId: "u3", reaction: "thumbs_up" },
        { userId: "u1", reaction: "thumbs_up" },
      ],
      "u1",
      nameOf,
    );
    expect(groups).toEqual([
      { reaction: "thumbs_up", count: 2, mine: true, people: ["You", "Anna"] },
      { reaction: "heart", count: 1, mine: false, people: ["Mike"] },
    ]);
    expect(reactedBy(["You", "Anna", "Mike"])).toBe("You, Anna and Mike");
    expect(reactedBy(["Mike"])).toBe("Mike");
  });

  it("toggle mine on and off without touching anyone else's", () => {
    const start = [{ userId: "u2", reaction: "eyes" as const }];
    const on = toggledReactions(start, "u1", "eyes", true);
    expect(on).toHaveLength(2);
    expect(toggledReactions(on, "u1", "eyes", false)).toEqual(start);
    expect(toggledReactions(on, "u1", "eyes", true)).toHaveLength(2);
  });
});

describe("editing a comment keeps what it stores (AC11.8)", () => {
  const ref = { type: "task", id: "11111111-1111-4111-8111-111111111111" };
  const people = [
    { id: "u2", name: "Mike", avatarUrl: null },
    { id: "u3", name: "Anna", avatarUrl: null },
  ];

  it("turns a reference the reader can name back into @Title, and stores it again on save", () => {
    const body = `See moduo://task/${ref.id} @Mike`;
    const editable = editableComment(body, () => "Logo concepts", people);
    expect(editable.text).toBe("See @Logo concepts @Mike");
    expect(editable.things).toEqual([{ ref, label: "Logo concepts" }]);
    expect(editable.mentions).toEqual([{ id: "u2", label: "Mike" }]);
    expect(commentBodyWithReferences(editable.text, editable.things, editable.mentions)).toBe(body);
  });

  it("keeps a reference it can't name, and date chips, as stored", () => {
    const body = `Ping moduo://task/${ref.id} by moduo://date/2026-10-15`;
    expect(editableComment(body, () => null, people).text).toBe(body);
  });
});
