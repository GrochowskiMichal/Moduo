import { describe, expect, it } from "vitest";

import type { EmailAccountRef, EmailModuleBundle, EmailThreadRef } from "../../lib/runtime.types";
import { shapeEmailInbox } from "./widget";

const NOW = new Date("2026-07-07T12:00:00Z");

function account(over: Partial<EmailAccountRef>): EmailAccountRef {
  return {
    id: "acc1",
    workspaceId: "ws",
    ownerId: "u",
    provider: "gmail",
    address: "a@x.com",
    status: "active",
    signatureHtml: "",
    unreadCount: 0,
    color: null,
    lastSyncAt: null,
    lastError: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function ref(over: Partial<EmailThreadRef>): EmailThreadRef {
  return {
    id: "r1",
    workspaceId: "ws",
    ownerId: "u",
    accountId: "acc1",
    threadKey: "thread:1",
    messageKey: null,
    fromAddr: "sender@x.com",
    fromName: "Sender",
    subject: "Subject",
    snippet: "hi",
    sentAt: null,
    isSnoozed: false,
    snoozeUntil: null,
    followUpAt: null,
    followUpClearedAt: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

function bundle(over: Partial<EmailModuleBundle>): EmailModuleBundle {
  return { accounts: [], refs: [], degraded: false, truncated: [], ...over };
}

describe("shapeEmailInbox", () => {
  it("sorts accounts by unread desc and sums the total", () => {
    const view = shapeEmailInbox(
      bundle({
        accounts: [
          account({ id: "a", address: "a@x.com", unreadCount: 2 }),
          account({ id: "b", address: "b@x.com", unreadCount: 9 }),
          account({ id: "c", address: "c@x.com", unreadCount: 0 }),
        ],
      }),
      { now: NOW },
    );
    expect(view.accounts.map((a) => a.id)).toEqual(["b", "a", "c"]);
    expect(view.totalUnread).toBe(11);
  });

  it("surfaces snoozed threads returning today or overdue, most-due first", () => {
    const view = shapeEmailInbox(
      bundle({
        refs: [
          ref({ id: "later", isSnoozed: true, snoozeUntil: "2026-07-09T09:00:00Z" }), // future day — excluded
          ref({ id: "today", isSnoozed: true, snoozeUntil: "2026-07-07T18:00:00Z" }),
          ref({ id: "overdue", isSnoozed: true, snoozeUntil: "2026-07-07T06:00:00Z" }),
          ref({ id: "notsnoozed", isSnoozed: false, snoozeUntil: "2026-07-07T06:00:00Z" }), // flag off — excluded
        ],
      }),
      { now: NOW },
    );
    expect(view.snoozedDueToday.map((r) => r.refId)).toEqual(["overdue", "today"]);
  });

  it("surfaces follow-ups awaiting a reply, most-urgent first; a cleared one drops", () => {
    const view = shapeEmailInbox(
      bundle({
        refs: [
          ref({ id: "b", followUpAt: "2026-07-10T09:00:00Z" }),
          ref({ id: "a", followUpAt: "2026-07-08T09:00:00Z" }),
          ref({
            id: "cleared",
            followUpAt: "2026-07-08T09:00:00Z",
            followUpClearedAt: "2026-07-07T08:00:00Z",
          }),
        ],
      }),
      { now: NOW },
    );
    expect(view.awaitingFollowUp.map((r) => r.refId)).toEqual(["a", "b"]);
  });

  it("caps each list to the limit and passes through degraded", () => {
    const refs = Array.from({ length: 8 }, (_, i) =>
      ref({ id: `f${i}`, followUpAt: `2026-07-0${i + 1}T09:00:00Z` }),
    );
    const view = shapeEmailInbox(bundle({ refs, degraded: true }), { now: NOW, limit: 3 });
    expect(view.awaitingFollowUp).toHaveLength(3);
    expect(view.degraded).toBe(true);
  });

  it("falls back to the sender address / (No subject) for sparse refs", () => {
    const view = shapeEmailInbox(
      bundle({
        refs: [
          ref({
            fromName: "",
            fromAddr: "x@y.com",
            subject: "",
            followUpAt: "2026-07-08T09:00:00Z",
          }),
        ],
      }),
      { now: NOW },
    );
    expect(view.awaitingFollowUp[0]!.fromName).toBe("x@y.com");
    expect(view.awaitingFollowUp[0]!.subject).toBe("(No subject)");
  });
});
