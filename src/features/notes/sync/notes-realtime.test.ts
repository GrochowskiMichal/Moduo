import { describe, expect, it } from "@rstest/core";
import * as Y from "yjs";
import {
  coalesceUpdates,
  initialsFor,
  nameFromEmail,
  noteChannelName,
  type PresenceState,
  presenceViewers,
} from "./notes-realtime";

describe("coalesceUpdates", () => {
  it("returns null for an empty burst and the lone update untouched", () => {
    expect(coalesceUpdates([])).toBeNull();
    const only = new Uint8Array([1, 2, 3]);
    expect(coalesceUpdates([only])).toBe(only);
  });

  it("merges a burst so applying the merge equals applying each in order", () => {
    const src = new Y.Doc();
    const updates: Uint8Array[] = [];
    src.on("update", (u: Uint8Array) => updates.push(u));
    const text = src.getText("t");
    text.insert(0, "hello");
    text.insert(5, " world");
    expect(updates.length).toBeGreaterThan(1);

    const merged = coalesceUpdates(updates)!;
    const target = new Y.Doc();
    Y.applyUpdate(target, merged);
    expect(target.getText("t").toString()).toBe("hello world");
  });
});

describe("presenceViewers", () => {
  const state: PresenceState = {
    u1: [{ userId: "u1", name: "Alice", at: 100 }],
    // Same person in two tabs → one viewer, earliest join kept.
    u2: [
      { userId: "u2", name: "Bob", at: 200 },
      { userId: "u2", name: "Bob", at: 50 },
    ],
    self: [{ userId: "self", name: "Me", at: 10 }],
  };

  it("excludes self, de-dupes by user, sorts by name, derives initials", () => {
    const v = presenceViewers(state, "self");
    expect(v.map((x) => x.userId)).toEqual(["u1", "u2"]);
    expect(v[0]).toEqual({ userId: "u1", name: "Alice", initials: "AL" });
    expect(v[1].initials).toBe("BO");
  });

  it("ignores malformed metas and missing fields", () => {
    const messy: PresenceState = {
      a: [{ userId: "a" } as Record<string, unknown>],
      b: [{ name: "NoId", at: 1 }],
      c: [{ userId: 42, name: "Bad" } as unknown as Record<string, unknown>],
    };
    const v = presenceViewers(messy, null);
    expect(v.map((x) => x.userId)).toEqual(["a"]);
    expect(v[0].name).toBe("Someone");
  });
});

describe("initialsFor / nameFromEmail / noteChannelName", () => {
  it("initialsFor handles full names, single handles, and empties", () => {
    expect(initialsFor("Ada Lovelace")).toBe("AL");
    expect(initialsFor("ada.lovelace")).toBe("AL");
    expect(initialsFor("ada")).toBe("AD");
    expect(initialsFor("")).toBe("?");
  });

  it("nameFromEmail takes the local part with a safe fallback", () => {
    expect(nameFromEmail("ada@x.com")).toBe("ada");
    expect(nameFromEmail(null)).toBe("Someone");
    expect(nameFromEmail("")).toBe("Someone");
  });

  it("noteChannelName namespaces by the note id", () => {
    expect(noteChannelName("abc")).toBe("notes:abc");
  });
});
