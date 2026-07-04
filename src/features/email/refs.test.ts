import { describe, expect, it } from "vitest";

import {
  buildRefUpsertArgs,
  isAwaitingFollowUp,
  isFollowUpDue,
  isSnoozeDue,
  SNIPPET_MAX,
  SUBJECT_MAX,
} from "./refs";

describe("email tissue-ref shaping (AC14)", () => {
  it("bounds subject + snippet, lowercases from, trims the thread key", () => {
    const args = buildRefUpsertArgs({
      threadKey: "  t-1 ",
      accountId: "acct-1",
      fromAddr: "  Alice@Example.COM ",
      fromName: "  Alice  ",
      subject: "S".repeat(SUBJECT_MAX + 50),
      snippet: "x".repeat(SNIPPET_MAX + 50),
      sentAt: "2026-07-04T10:00:00Z",
    });
    expect(args.threadKey).toBe("t-1");
    expect(args.fromAddr).toBe("alice@example.com");
    expect(args.fromName).toBe("Alice");
    expect(args.subject).toHaveLength(SUBJECT_MAX);
    expect(args.subject.endsWith("…")).toBe(true);
    expect(args.snippet).toHaveLength(SNIPPET_MAX);
    expect(args.accountId).toBe("acct-1");
  });

  it("blank optional fields degrade to null/empty, never junk strings", () => {
    const args = buildRefUpsertArgs({
      threadKey: "t",
      fromAddr: "   ",
      fromName: "",
      messageKey: "  ",
      subject: "",
      snippet: "",
    });
    expect(args.fromAddr).toBeNull();
    expect(args.fromName).toBeNull();
    expect(args.messageKey).toBeNull();
    expect(args.accountId).toBeNull();
    expect(args.subject).toBe("");
    expect(args.snippet).toBe("");
    expect(args.sentAt).toBeNull();
  });

  it("snooze is due only when snoozed AND the time has passed", () => {
    const now = Date.parse("2026-07-04T12:00:00Z");
    expect(isSnoozeDue({ isSnoozed: true, snoozeUntil: "2026-07-04T11:00:00Z" }, now)).toBe(true);
    expect(isSnoozeDue({ isSnoozed: true, snoozeUntil: "2026-07-04T13:00:00Z" }, now)).toBe(false);
    expect(isSnoozeDue({ isSnoozed: false, snoozeUntil: "2026-07-04T11:00:00Z" }, now)).toBe(false);
    expect(isSnoozeDue({ isSnoozed: true, snoozeUntil: null }, now)).toBe(false);
  });

  it("follow-up: awaiting until cleared; due when past deadline and uncleared", () => {
    const now = Date.parse("2026-07-04T12:00:00Z");
    expect(isAwaitingFollowUp({ followUpAt: "2026-07-05T00:00:00Z", followUpClearedAt: null })).toBe(true);
    expect(
      isAwaitingFollowUp({ followUpAt: "2026-07-05T00:00:00Z", followUpClearedAt: "2026-07-04T09:00:00Z" }),
    ).toBe(false);
    expect(isAwaitingFollowUp({ followUpAt: null, followUpClearedAt: null })).toBe(false);

    expect(isFollowUpDue({ followUpAt: "2026-07-04T11:00:00Z", followUpClearedAt: null }, now)).toBe(true);
    expect(isFollowUpDue({ followUpAt: "2026-07-04T13:00:00Z", followUpClearedAt: null }, now)).toBe(false);
    // A counterpart reply cleared it → never fires, even past the deadline.
    expect(
      isFollowUpDue({ followUpAt: "2026-07-04T11:00:00Z", followUpClearedAt: "2026-07-04T10:30:00Z" }, now),
    ).toBe(false);
  });
});
