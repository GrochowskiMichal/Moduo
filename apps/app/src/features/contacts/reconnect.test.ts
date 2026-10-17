import { describe, expect, it } from "@rstest/core";
import type { Contact } from "./model";
import { selectReconnect } from "./reconnect";

// Frozen "now" so day-math is deterministic.
const NOW = new Date("2026-06-28T12:00:00.000Z");
const DAY_MS = 86_400_000;

/** ISO timestamp N days before NOW. */
function daysAgo(n: number): string {
  return new Date(NOW.getTime() - n * DAY_MS).toISOString();
}

/** Minimal Contact factory — only the fields the selector reads matter. */
function makeContact(over: Partial<Contact> & { id: string; name: string }): Contact {
  return {
    workspaceId: "ws",
    ownerId: "owner",
    email: null,
    emails: [],
    phone: null,
    phones: [],
    addresses: [],
    urls: [],
    dates: [],
    title: null,
    companyId: null,
    status: "active",
    custom: {},
    isFavorite: false,
    notesInline: "",
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    deletedAt: null,
    ...over,
  };
}

describe("selectReconnect", () => {
  it("includes a 60-day-stale contact and excludes a 5-day-fresh one", () => {
    const contacts = [
      makeContact({ id: "stale", name: "Stale" }),
      makeContact({ id: "fresh", name: "Fresh" }),
    ];
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: { stale: daysAgo(60), fresh: daysAgo(5) },
      now: NOW,
    });
    const ids = result.map((r) => r.contactId);
    expect(ids).toContain("stale");
    expect(ids).not.toContain("fresh");
    expect(result.find((r) => r.contactId === "stale")?.daysSince).toBe(60);
  });

  it("excludes archived contacts even when very stale", () => {
    const contacts = [
      makeContact({ id: "arch", name: "Archived", status: "archived" }),
      makeContact({ id: "live", name: "Live" }),
    ];
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: { arch: daysAgo(365), live: daysAgo(90) },
      now: NOW,
    });
    expect(result.map((r) => r.contactId)).toEqual(["live"]);
  });

  it("treats a never-touched contact (null in map) as eligible with daysSince null", () => {
    const contacts = [makeContact({ id: "never", name: "Never" })];
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: { never: null },
      now: NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ contactId: "never", lastTouchAt: null, daysSince: null });
  });

  it("treats a contact missing from the map as never-touched (eligible)", () => {
    const contacts = [makeContact({ id: "absent", name: "Absent" })];
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: {},
      now: NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ contactId: "absent", lastTouchAt: null, daysSince: null });
  });

  it("orders oldest-first: never-touched first, then largest daysSince", () => {
    const contacts = [
      makeContact({ id: "d40", name: "D40" }),
      makeContact({ id: "never", name: "Never" }),
      makeContact({ id: "d100", name: "D100" }),
      makeContact({ id: "d60", name: "D60" }),
    ];
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: {
        d40: daysAgo(40),
        never: null,
        d100: daysAgo(100),
        d60: daysAgo(60),
      },
      now: NOW,
    });
    expect(result.map((r) => r.contactId)).toEqual(["never", "d100", "d60", "d40"]);
  });

  it("respects the limit (default 5)", () => {
    const contacts = Array.from({ length: 8 }, (_, i) =>
      makeContact({ id: `c${i}`, name: `C${i}` }),
    );
    const lastTouchByContactId: Record<string, string | null> = {};
    contacts.forEach((c, i) => {
      lastTouchByContactId[c.id] = daysAgo(40 + i);
    });
    const result = selectReconnect({ contacts, lastTouchByContactId, now: NOW });
    expect(result).toHaveLength(5);
    // Should be the five most stale (largest daysSince), oldest-first.
    expect(result.map((r) => r.contactId)).toEqual(["c7", "c6", "c5", "c4", "c3"]);
  });

  it("respects an explicit limit", () => {
    const contacts = [
      makeContact({ id: "a", name: "A" }),
      makeContact({ id: "b", name: "B" }),
      makeContact({ id: "c", name: "C" }),
    ];
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: { a: daysAgo(60), b: daysAgo(90), c: daysAgo(120) },
      now: NOW,
      limit: 2,
    });
    expect(result.map((r) => r.contactId)).toEqual(["c", "b"]);
  });

  it("honors a custom minDays threshold", () => {
    const contacts = [
      makeContact({ id: "d10", name: "D10" }),
      makeContact({ id: "d20", name: "D20" }),
    ];
    // With minDays 7, both 10- and 20-day contacts are stale.
    const wide = selectReconnect({
      contacts,
      lastTouchByContactId: { d10: daysAgo(10), d20: daysAgo(20) },
      now: NOW,
      minDays: 7,
    });
    expect(wide.map((r) => r.contactId)).toEqual(["d20", "d10"]);

    // With minDays 15, only the 20-day contact qualifies.
    const narrow = selectReconnect({
      contacts,
      lastTouchByContactId: { d10: daysAgo(10), d20: daysAgo(20) },
      now: NOW,
      minDays: 15,
    });
    expect(narrow.map((r) => r.contactId)).toEqual(["d20"]);
  });

  it("uses a strict threshold — exactly minDays days is NOT stale enough", () => {
    const contacts = [makeContact({ id: "edge", name: "Edge" })];
    // Exactly 30 days → daysSince 30, not > 30 → excluded.
    const atThreshold = selectReconnect({
      contacts,
      lastTouchByContactId: { edge: daysAgo(30) },
      now: NOW,
    });
    expect(atThreshold).toHaveLength(0);

    // 31 days → included.
    const over = selectReconnect({
      contacts,
      lastTouchByContactId: { edge: daysAgo(31) },
      now: NOW,
    });
    expect(over.map((r) => r.contactId)).toEqual(["edge"]);
  });

  it("floors daysSince from the elapsed milliseconds", () => {
    const contacts = [makeContact({ id: "f", name: "F" })];
    // 45.9 days elapsed → floor to 45.
    const touch = new Date(NOW.getTime() - Math.round(45.9 * DAY_MS)).toISOString();
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: { f: touch },
      now: NOW,
    });
    expect(result[0]?.daysSince).toBe(45);
  });

  it("preserves the original lastTouchAt string on included items", () => {
    const contacts = [makeContact({ id: "x", name: "X" })];
    const touch = daysAgo(50);
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: { x: touch },
      now: NOW,
    });
    expect(result[0]?.lastTouchAt).toBe(touch);
  });

  it("treats unparseable timestamps as never-touched (eligible, daysSince null)", () => {
    const contacts = [makeContact({ id: "bad", name: "Bad" })];
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: { bad: "not-a-date" },
      now: NOW,
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ contactId: "bad", lastTouchAt: null, daysSince: null });
  });

  it("returns an empty array when no contacts qualify", () => {
    const contacts = [
      makeContact({ id: "fresh1", name: "Fresh1" }),
      makeContact({ id: "fresh2", name: "Fresh2" }),
    ];
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: { fresh1: daysAgo(1), fresh2: daysAgo(29) },
      now: NOW,
    });
    expect(result).toEqual([]);
  });

  it("breaks daysSince ties by name for stable ordering", () => {
    const contacts = [
      makeContact({ id: "zoe", name: "Zoe" }),
      makeContact({ id: "amy", name: "Amy" }),
    ];
    const sameTouch = daysAgo(60);
    const result = selectReconnect({
      contacts,
      lastTouchByContactId: { zoe: sameTouch, amy: sameTouch },
      now: NOW,
    });
    expect(result.map((r) => r.contactId)).toEqual(["amy", "zoe"]);
  });
});
