// Proves AC4 (the rendering half) — each spine op maps to a quiet, attributed
// sentence; unknown ops fall back to the op name; actor resolves to You / label
// / quiet fallback. Mirrors src/features/tasks/activity.test.ts.

import { describe, expect, it } from "@rstest/core";

import { spineActivityLine, spineActorName } from "./activity";

function entry(op: string, payload: Record<string, unknown> = {}) {
  return { op, payload };
}

describe("spineActorName", () => {
  const base = { actorType: "user" as const, actorId: "u1", actorLabel: "Maciej" };

  it("says You for the current user", () => {
    expect(spineActorName(base, "u1")).toBe("You");
  });

  it("uses the recorded label for someone else", () => {
    expect(spineActorName(base, "u2")).toBe("Maciej");
  });

  it("falls back quietly per actor type", () => {
    expect(spineActorName({ actorType: "user", actorId: null, actorLabel: null }, "u1")).toBe(
      "Someone",
    );
    expect(spineActorName({ actorType: "agent", actorId: null, actorLabel: null }, "u1")).toBe(
      "An agent",
    );
    expect(spineActorName({ actorType: "api_key", actorId: null, actorLabel: null }, "u1")).toBe(
      "An API client",
    );
  });
});

describe("spineActivityLine", () => {
  it("renders the task notifications (DF-9, TV-D1) in the card voice", () => {
    expect(spineActivityLine(entry("tasks.assigned"))).toBe("assigned this to you");
    expect(spineActivityLine(entry("tasks.completed"))).toBe("completed this");
  });

  it("renders link creation, by kind", () => {
    expect(spineActivityLine(entry("links.create", { relation_kind: "references" }))).toBe(
      "linked this",
    );
    expect(spineActivityLine(entry("links.create", { relation_kind: "follow-up" }))).toBe(
      "added a follow-up",
    );
    expect(spineActivityLine(entry("links.create", { relation_kind: "attachment" }))).toBe(
      "attached this",
    );
    expect(spineActivityLine(entry("links.create", { relation_kind: "blocks" }))).toBe(
      "linked this (blocks)",
    );
  });

  it("treats a contacts link the same way as a spine link", () => {
    expect(spineActivityLine(entry("contacts.link", { relation_kind: "follow-up" }))).toBe(
      "added a follow-up",
    );
  });

  it("renders re-typing and removing a link", () => {
    expect(spineActivityLine(entry("links.set_kind", { from: "references", to: "blocks" }))).toBe(
      "changed a link to blocks",
    );
    expect(spineActivityLine(entry("links.delete"))).toBe("removed a link");
    expect(spineActivityLine(entry("contacts.unlink"))).toBe("removed a link");
  });

  it("renders a comment with its excerpt", () => {
    expect(spineActivityLine(entry("comments.add", { excerpt: "ping me when ready" }))).toBe(
      "commented: “ping me when ready”",
    );
    expect(spineActivityLine(entry("comments.add"))).toBe("left a comment");
  });

  it("never lies by omission — unknown ops fall back to the op name", () => {
    expect(spineActivityLine(entry("links.future_op"))).toBe("links.future_op");
  });
});
