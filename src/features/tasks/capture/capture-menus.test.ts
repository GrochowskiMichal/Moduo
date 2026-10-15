// The capture's `@` menu lists people with the avatar every other surface
// shows: their profile photo when set (MOD-96), else the initials of their own
// name, never of the menu's "(you)" label (call 43).

import { describe, expect, it } from "@rstest/core";

import { mentionEntries } from "./capture-menus";

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
