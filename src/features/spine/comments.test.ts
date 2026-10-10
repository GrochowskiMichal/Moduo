import { describe, expect, it } from "@rstest/core";

import {
  commentAuthorName,
  filterPeople,
  insertMention,
  keptMentionIds,
  mentionQueryAt,
  mentionStillPresent,
  relativeTime,
  splitMentions,
} from "./comments";

describe("mentions that still notify", () => {
  it("needs the label at a word boundary", () => {
    expect(mentionStillPresent("hi @Anna", "Anna")).toBe(true);
    expect(mentionStillPresent("hi @Annabel", "Anna")).toBe(false);
    expect(mentionStillPresent("@Anna, look", "Anna")).toBe(true);
    expect(mentionStillPresent("no mention", "Anna")).toBe(false);
  });

  it("keeps only people still named in the text, once each", () => {
    const picked = [
      { id: "u2", label: "Mike" },
      { id: "u3", label: "Ola" },
      { id: "u2", label: "Mike" },
    ];
    expect(keptMentionIds("@Mike can you check", picked)).toEqual(["u2"]);
    expect(keptMentionIds("@Mike and @Ola", picked)).toEqual(["u2", "u3"]);
  });
});

describe("the inline @ picker", () => {
  it("opens on an @ at the start or after a space, with the word typed so far", () => {
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("hey @mi", 7)).toEqual({ start: 4, query: "mi" });
    expect(mentionQueryAt("hey @mi there", 7)).toEqual({ start: 4, query: "mi" });
  });

  it("stays closed inside an email address or after the word ends", () => {
    expect(mentionQueryAt("ola@moduo.app", 13)).toBeNull();
    expect(mentionQueryAt("hey @mike ", 10)).toBeNull();
    expect(mentionQueryAt("no at here", 10)).toBeNull();
  });

  it("replaces the typed query with the picked name and a trailing space", () => {
    expect(insertMention("hey @mi", 4, 7, "Mike")).toEqual({ text: "hey @Mike ", caret: 10 });
    expect(insertMention("hey @mi there", 4, 7, "Mike")).toEqual({
      text: "hey @Mike there",
      caret: 10,
    });
  });

  it("lists people whose name starts with the query first", () => {
    const people = [
      { id: "1", name: "Mike Grochowski", avatarUrl: null },
      { id: "2", name: "Jamie", avatarUrl: null },
      { id: "3", name: "Ola", avatarUrl: null },
    ];
    expect(filterPeople(people, "mi").map((p) => p.id)).toEqual(["1", "2"]);
    expect(filterPeople(people, "gro").map((p) => p.id)).toEqual(["1"]);
    expect(filterPeople(people, "").map((p) => p.id)).toEqual(["1", "2", "3"]);
  });
});

describe("rendering a comment", () => {
  it("splits the body around the mentioned names, longest name first", () => {
    expect(splitMentions("ping @Ann Lee and @Ann", ["Ann", "Ann Lee"])).toEqual([
      { text: "ping ", mention: false },
      { text: "@Ann Lee", mention: true },
      { text: " and ", mention: false },
      { text: "@Ann", mention: true },
    ]);
    expect(splitMentions("mail ann@x.io", ["ann"])).toEqual([
      { text: "mail ann@x.io", mention: false },
    ]);
    expect(splitMentions("@Annabel", ["Ann"])).toEqual([{ text: "@Annabel", mention: false }]);
  });

  it("names the author: you, a member, an app, or a former member", () => {
    const nameOf = (id: string) => (id === "u2" ? "Mike" : null);
    const base = { authorKind: "user" as const, authorLabel: null };
    expect(commentAuthorName({ ...base, createdBy: "u1" }, "u1", nameOf)).toBe("You");
    expect(commentAuthorName({ ...base, createdBy: "u2" }, "u1", nameOf)).toBe("Mike");
    expect(commentAuthorName({ ...base, createdBy: "u9" }, "u1", nameOf)).toBe("Former member");
    expect(
      commentAuthorName(
        { createdBy: "u1", authorKind: "api_key", authorLabel: "Claude" },
        "u1",
        nameOf,
      ),
    ).toBe("Claude (app)");
  });

  it("says how long ago, in the quiet short form", () => {
    const now = Date.parse("2026-10-09T12:00:00Z");
    expect(relativeTime("2026-10-09T11:59:40Z", now)).toBe("just now");
    expect(relativeTime("2026-10-09T11:55:00Z", now)).toBe("5m ago");
    expect(relativeTime("2026-10-09T09:00:00Z", now)).toBe("3h ago");
    expect(relativeTime("2026-10-07T12:00:00Z", now)).toBe("2d ago");
  });
});
