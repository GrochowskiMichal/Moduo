import { describe, expect, it } from "@rstest/core";
import * as Y from "yjs";
import {
  coalesceUpdates,
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
  const members: Record<string, { name: string; avatarUrl?: string | null }> = {
    u1: { name: "Alice", avatarUrl: "https://x/alice.png" },
    u2: { name: "Bob" },
    self: { name: "Me" },
  };
  const personOf = (id: string) => members[id] ?? null;

  it("names and pictures viewers from the member list, excludes self, one avatar per person", () => {
    const state: PresenceState = {
      u2: [{ at: 200 }, { at: 50 }], // two tabs → one viewer
      u1: [{ at: 100 }],
      self: [{ at: 10 }],
    };
    expect(presenceViewers(state, "self", personOf)).toEqual([
      { userId: "u1", name: "Alice", avatarUrl: "https://x/alice.png" },
      { userId: "u2", name: "Bob", avatarUrl: null },
    ]);
  });

  it("never shows what a peer sent: a claimed name is ignored, an unknown id is left out", () => {
    const state: PresenceState = {
      u1: [{ name: "The CEO", userId: "u2" }],
      stranger: [{ name: "Alice", at: 1 }],
      u2: [],
    };
    expect(presenceViewers(state, null, personOf)).toEqual([
      { userId: "u1", name: "Alice", avatarUrl: "https://x/alice.png" },
    ]);
  });
});

describe("noteChannelName", () => {
  it("is the private topic shape the realtime.messages policies parse", () => {
    const id = "0b5c3a8e-6f1d-4c2a-9e7b-1a2b3c4d5e6f";
    expect(noteChannelName(id)).toBe(`note:${id}`);
    expect(noteChannelName(id)).toMatch(
      /^note:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
