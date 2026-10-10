// Proves AC4 (the rendering half) — each spine op maps to a quiet, attributed
// sentence; unknown ops fall back to the op name; actor resolves to You / label
// / quiet fallback. Mirrors src/features/tasks/activity.test.ts.

import { describe, expect, it } from "@rstest/core";

import { dayShort, time24 } from "../calendar/booking/sentence";
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

describe("storage alerts (AT-1)", () => {
  it("says which level the uploader's file crossed, with the pool's numbers", () => {
    expect(
      spineActivityLine(
        entry("attachments.storage_80", {
          level: 80,
          used_bytes: 1.65 * 1073741824,
          total_bytes: 2 * 1073741824,
        }),
      ),
    ).toBe("filled storage past 80% (1.7 of 2 GB)");
    expect(
      spineActivityLine(
        entry("attachments.storage_95", {
          level: 95,
          used_bytes: 47.6 * 1073741824,
          total_bytes: 50 * 1073741824,
        }),
      ),
    ).toBe("filled storage past 95% (48 of 50 GB)");
  });

  it("still reads without the numbers", () => {
    expect(spineActivityLine(entry("attachments.storage_95"))).toBe("filled storage past 95%");
  });
});

describe("bookings in the host's bell (TX-5)", () => {
  const START = "2026-10-16T12:00:00Z";
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const day = dayShort(new Date(START), zone);
  const time = time24(new Date(START), zone);
  const booked = {
    op: "calendar.booking_create",
    actorType: "user" as const,
    actorId: "host",
    actorLabel: "Anna Carter",
    payload: {
      title: "Intro call",
      guest: "tom@becker.studio",
      guest_name: "Tom Becker",
      start: START,
    },
  };

  it("names the guest, not the host recorded as the actor", () => {
    expect(spineActorName(booked, "host")).toBe("Tom Becker");
    expect(spineActorName({ ...booked, payload: { guest: "tom@becker.studio" } }, "host")).toBe(
      "tom@becker.studio",
    );
    // An older row with no guest falls back to the usual actor.
    expect(spineActorName({ ...booked, payload: {} }, "host")).toBe("You");
  });

  it("reads like the ratified line", () => {
    expect(spineActivityLine(booked)).toBe(`booked Intro call · ${day}, ${time}`);
    expect(spineActivityLine({ ...booked, op: "calendar.booking_cancel" })).toBe(
      `canceled Intro call · ${day}`,
    );
    expect(spineActivityLine(entry("calendar.booking_cancel"))).toBe("canceled a meeting");
  });
});
