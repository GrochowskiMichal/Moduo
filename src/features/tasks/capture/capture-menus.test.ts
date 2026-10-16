// The capture's `@` menu lists people with the avatar every other surface
// shows: their profile photo when set (MOD-96), else the initials of their own
// name, never of the menu's "(you)" label (call 43).

import { describe, expect, it } from "@rstest/core";

import { commandEntries, mentionEntries, personLabel } from "./capture-menus";

const PHOTO = "https://example.supabase.co/storage/v1/object/public/avatars/profiles/u-sam/a.png";

describe("the @ menu's people (MOD-96)", () => {
  it("carries each person's photo and own name for the avatar", () => {
    const { candidates } = mentionEntries("", [], {
      people: [
        {
          userId: "u-me",
          name: "Alex Rivera",
          fullName: "Alex Rivera",
          isMe: true,
          avatarUrl: null,
        },
        {
          userId: "u-sam",
          name: "Sam Ortiz",
          fullName: "Sam Ortiz",
          isMe: false,
          avatarUrl: PHOTO,
        },
        // No name set: the menu reads "Member", the avatar a gray "?" (call 43).
        { userId: "u-new", name: "Member", fullName: "", isMe: false, avatarUrl: null },
      ],
      teams: [],
      projects: [],
      sections: [],
    });
    expect(candidates.filter((c) => c.kind === "person")).toEqual([
      {
        kind: "person",
        memberId: "u-me",
        label: "Alex Rivera (you)",
        icon: null,
        name: "Alex Rivera",
        avatarUrl: null,
      },
      {
        kind: "person",
        memberId: "u-sam",
        label: "Sam Ortiz",
        icon: null,
        name: "Sam Ortiz",
        avatarUrl: PHOTO,
      },
      {
        kind: "person",
        memberId: "u-new",
        label: "Member",
        icon: null,
        name: "?",
        avatarUrl: null,
      },
    ]);
  });
});

describe("the menus name you as the app does (call #27, MOD-137)", () => {
  it("you with no name read You, never You (you)", () => {
    expect(personLabel({ userId: "u-me", name: "You", fullName: "", isMe: true })).toBe("You");
    expect(
      personLabel({ userId: "u-me", name: "Alex Rivera", fullName: "Alex Rivera", isMe: true }),
    ).toBe("Alex Rivera (you)");
    expect(personLabel({ userId: "u-sam", name: "Sam Ortiz", isMe: false })).toBe("Sam Ortiz");
  });

  it("/remind offers Reminder…, and Reminder <when> once a time is typed, never Remind me", () => {
    const now = new Date(2030, 0, 7, 8, 0);
    const labels = (query: string) =>
      commandEntries(query, [], { now }).candidates.map((c) =>
        "label" in c ? String(c.label) : "",
      );
    const open = labels("remind");
    expect(open).toContain("Reminder…");
    const timed = labels("remind tomorrow 9am");
    expect(timed.some((label) => /^Reminder \S/.test(label))).toBe(true);
    expect([...open, ...timed].some((label) => label.startsWith("Remind me"))).toBe(false);
  });
});
