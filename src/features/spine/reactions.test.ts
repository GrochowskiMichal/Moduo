// TV-U13 (AC11.8) and CV-7c (CH16a): any emoji, your quick row, who reacted,
// and an edit that keeps what a comment stores.

import { DEFAULT_QUICK_REACTIONS } from "@contracts/vocabularies";
import { describe, expect, it } from "@rstest/core";

import { commentBodyWithReferences, editableComment } from "./comments";
import { toggledReactions } from "./hooks/use-comment-thread";
import {
  groupMessageReactions,
  groupReactions,
  reactedBy,
  reactionName,
  resolveQuickRow,
} from "./reactions";

const names: Record<string, string> = { u1: "Maciej", u2: "Mike", u3: "Anna" };
const nameOf = (id: string) => names[id] ?? null;

describe("your quick row (CH16a)", () => {
  it("is Moduo's six when you set none", () => {
    expect(resolveQuickRow(null).join("")).toBe("👍✅👀🙏❤️😄");
    expect(resolveQuickRow([])).toEqual([...DEFAULT_QUICK_REACTIONS]);
  });

  it("keeps yours in order, skips what can't be used, and fills from the six", () => {
    expect(resolveQuickRow(["🎉", "👀"])).toEqual(["🎉", "👀", "👍", "✅", "🙏", "❤️"]);
    // A custom emoji missing here (CV-20) or anything not a key is skipped.
    expect(resolveQuickRow([":gone:", "🎉", "🎉", "party"])).toEqual([
      "🎉",
      "👍",
      "✅",
      "👀",
      "🙏",
      "❤️",
    ]);
    expect(resolveQuickRow(["🎉", "🔥", "🚀", "🙌", "💯", "🤔", "👏"])).toHaveLength(6);
  });

  it("names Moduo's six for screen readers; any other emoji reads as itself", () => {
    for (const k of DEFAULT_QUICK_REACTIONS) expect(reactionName(k)).not.toBe(k);
    expect(reactionName("👍")).toBe("Thumbs up");
    expect(reactionName("🎉")).toBe("🎉");
  });
});

describe("who reacted", () => {
  it("groups a comment's marks by emoji, first used first, me first in who", () => {
    const groups = groupReactions(
      [
        { userId: "u2", reaction: "❤️" },
        { userId: "u3", reaction: "🎉" },
        { userId: "u1", reaction: "🎉" },
      ],
      "u1",
      nameOf,
    );
    expect(groups).toEqual([
      { key: "❤️", count: 1, mine: false, people: ["Mike"] },
      { key: "🎉", count: 2, mine: true, people: ["You", "Anna"] },
    ]);
    expect(reactedBy(["You", "Anna", "Mike"])).toBe("You, Anna and Mike");
    expect(reactedBy(["Mike"])).toBe("Mike");
  });

  it("groups a message's reactions the same way, skipping empty ones", () => {
    expect(
      groupMessageReactions(
        { "👍": ["u2", "u1"], "👀": [], "🎉": ["x"], party: ["u2"] },
        "u1",
        nameOf,
      ),
    ).toEqual([
      { key: "👍", count: 2, mine: true, people: ["You", "Mike"] },
      { key: "🎉", count: 1, mine: false, people: ["Former member"] },
    ]);
  });

  it("toggle mine on and off without touching anyone else's", () => {
    const start = [{ userId: "u2", reaction: "👀" }];
    const on = toggledReactions(start, "u1", "👀", true);
    expect(on).toHaveLength(2);
    expect(toggledReactions(on, "u1", "👀", false)).toEqual(start);
    expect(toggledReactions(on, "u1", "👀", true)).toHaveLength(2);
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
