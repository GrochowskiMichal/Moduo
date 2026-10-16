import { describe, expect, it } from "@rstest/core";
import { presenceViewers } from "./notes-realtime";

describe("presenceViewers", () => {
  const members: Record<string, { name: string; avatarUrl?: string | null }> = {
    u1: { name: "Alice", avatarUrl: "https://x/alice.png" },
    u2: { name: "Bob" },
    self: { name: "Me" },
  };
  const personOf = (id: string) => members[id] ?? null;

  it("names and pictures viewers from the member list, excludes self, one avatar per person", () => {
    expect(presenceViewers(["u2", "u1", "self", "u2"], "self", personOf)).toEqual([
      { userId: "u1", name: "Alice", avatarUrl: "https://x/alice.png" },
      { userId: "u2", name: "Bob", avatarUrl: null },
    ]);
  });

  it("leaves out an id the member list doesn't know", () => {
    expect(presenceViewers(["stranger", "", "u1"], null, personOf).map((v) => v.userId)).toEqual([
      "u1",
    ]);
  });
});
