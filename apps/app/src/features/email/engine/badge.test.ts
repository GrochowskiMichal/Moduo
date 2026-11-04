import { describe, expect, it } from "@rstest/core";

import { mailViewKey } from "@/lib/runtime.types";
import type { MailThreadRow } from "@/lib/runtime.types.mail-engine";

import { mailBadgeCount, shouldNotifyNewMail } from "./badge";
import { DEFAULT_MAIL_BEHAVIOR, sanitizeMailBehavior } from "./behavior";

const counts = {
  badge: 3,
  byViewKey: {
    [mailViewKey({ kind: "unified", role: "inbox" }, { kind: "personal" })]: 3,
    [mailViewKey({ kind: "unified", role: "inbox" })]: 11,
  },
};

const row = (over: Partial<MailThreadRow> = {}): MailThreadRow => ({
  threadId: "t1",
  accountId: "a1",
  subject: "Hi",
  snippet: "",
  senders: [],
  lastDateMs: 0,
  messageCount: 1,
  unread: true,
  pinned: false,
  hasAttachments: false,
  hasInvite: false,
  tab: "personal",
  priority: false,
  muted: false,
  snoozedUntilMs: null,
  ...over,
});

describe("mail badge (AC35)", () => {
  it("counts Personal by default, All inbox or nothing per the setting", () => {
    expect(mailBadgeCount(counts, DEFAULT_MAIL_BEHAVIOR)).toBe(3);
    expect(mailBadgeCount(counts, { ...DEFAULT_MAIL_BEHAVIOR, badge: "all" })).toBe(11);
    expect(mailBadgeCount(counts, { ...DEFAULT_MAIL_BEHAVIOR, badge: "off" })).toBe(0);
    expect(mailBadgeCount(null, DEFAULT_MAIL_BEHAVIOR)).toBe(0);
  });

  it("new mail is badge-only by default; Personal notify and Priority people opt in", () => {
    expect(shouldNotifyNewMail(row(), DEFAULT_MAIL_BEHAVIOR)).toBe(false);
    expect(shouldNotifyNewMail(row(), { ...DEFAULT_MAIL_BEHAVIOR, notifyPersonal: true })).toBe(
      true,
    );
    expect(
      shouldNotifyNewMail(row({ tab: "newsletters" }), {
        ...DEFAULT_MAIL_BEHAVIOR,
        notifyPersonal: true,
      }),
    ).toBe(false);
    expect(
      shouldNotifyNewMail(row({ priority: true, tab: "notifications" }), DEFAULT_MAIL_BEHAVIOR),
    ).toBe(true);
    expect(
      shouldNotifyNewMail(row({ priority: true }), {
        ...DEFAULT_MAIL_BEHAVIOR,
        notifyPriority: false,
      }),
    ).toBe(false);
    expect(shouldNotifyNewMail(row({ priority: true, muted: true }), DEFAULT_MAIL_BEHAVIOR)).toBe(
      false,
    );
  });

  it("a corrupt stored setting reads as the defaults", () => {
    expect(sanitizeMailBehavior({ badge: "weird", notifyPersonal: 1 })).toEqual(
      DEFAULT_MAIL_BEHAVIOR,
    );
  });
});
