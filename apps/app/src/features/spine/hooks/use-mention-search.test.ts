// MOD-96: the `@` menu every editor shares (Notes, email compose, task
// descriptions) shows each person's avatar: their profile photo from the
// member row, else the initials of their own name, "?" when they haven't set
// one (never the "ME" of the "Member" label, call 43).

import { describe, expect, it } from "@rstest/core";

import { memberToPerson } from "./use-mention-search";

const PHOTO = "https://example.supabase.co/storage/v1/object/public/avatars/profiles/u-ada/a.png";

const row = (profiles: Record<string, unknown> | null) => ({
  id: "m1",
  workspace_id: "w1",
  user_id: "u-ada",
  role: "editor",
  profiles,
});

describe("memberToPerson (MOD-96)", () => {
  it("carries the member's photo and own name", () => {
    expect(
      memberToPerson(row({ id: "u-ada", display_name: "Ada Lovelace", avatar_url: PHOTO }), ""),
    ).toEqual({
      memberId: "u-ada",
      label: "Ada Lovelace",
      icon: null,
      name: "Ada Lovelace",
      avatarUrl: PHOTO,
    });
  });

  it("someone without a name reads Member, with a ? avatar and no photo", () => {
    expect(memberToPerson(row({ id: "u-ada", display_name: "", avatar_url: null }), "")).toEqual({
      memberId: "u-ada",
      label: "Member",
      icon: null,
      name: "?",
      avatarUrl: null,
    });
    expect(memberToPerson(row(null), "")?.name).toBe("?");
  });

  it("treats a blank photo as none, and still filters by the query", () => {
    const blank = row({ id: "u-ada", display_name: "Ada Lovelace", avatar_url: "  " });
    expect(memberToPerson(blank, "")?.avatarUrl).toBeNull();
    expect(memberToPerson(blank, "lov")?.memberId).toBe("u-ada");
    expect(memberToPerson(blank, "zed")).toBeNull();
    expect(memberToPerson({ profiles: {} }, "")).toBeNull();
  });
});
