// DF-21f AC12 — the web follow-up-due selector: fire only MY awaiting follow-ups
// whose deadline passed; never snooze-due (excluded on web); never someone else's.

import { describe, expect, it } from "@rstest/core";
import type { EmailThreadRef } from "@/lib/runtime.types";
import { selectWebFollowUpDue } from "./due-web-sweep";

const NOW = Date.parse("2026-07-14T12:00:00Z");
const past = "2026-07-14T09:00:00Z";
const future = "2026-07-20T09:00:00Z";

function ref(over: Partial<EmailThreadRef> & Pick<EmailThreadRef, "id">): EmailThreadRef {
  return {
    workspaceId: "w1",
    ownerId: "me",
    accountId: "acc1",
    threadKey: "th-" + over.id,
    messageKey: null,
    fromAddr: null,
    fromName: null,
    subject: "Re: proposal",
    snippet: "",
    sentAt: null,
    isSnoozed: false,
    snoozeUntil: null,
    followUpAt: past,
    followUpClearedAt: null,
    createdAt: past,
    updatedAt: past,
    ...over,
  };
}

describe("selectWebFollowUpDue", () => {
  it("fires my awaiting follow-ups whose deadline has passed", () => {
    const refs = [
      ref({ id: "due", followUpAt: past, followUpClearedAt: null }),
      ref({ id: "not-yet", followUpAt: future }), // deadline in the future
      ref({ id: "cleared", followUpAt: past, followUpClearedAt: past }), // replied → cleared
      ref({ id: "no-followup", followUpAt: null }), // no follow-up set
    ];
    expect(selectWebFollowUpDue(refs, { userId: "me", nowMs: NOW })).toEqual(["due"]);
  });

  it("only sweeps the current user's own refs (email is personal at alpha)", () => {
    const refs = [
      ref({ id: "mine", ownerId: "me", followUpAt: past }),
      ref({ id: "theirs", ownerId: "someone-else", followUpAt: past }),
    ];
    expect(selectWebFollowUpDue(refs, { userId: "me", nowMs: NOW })).toEqual(["mine"]);
  });

  it("never fires snooze-due — a due snooze with no follow-up is ignored on web", () => {
    const refs = [
      // A snoozed thread whose time has come, but NO follow-up armed → web skips it
      // (snooze-due is desktop-only; firing it on web would strand the IMAP mail).
      ref({ id: "snooze-due", isSnoozed: true, snoozeUntil: past, followUpAt: null }),
    ];
    expect(selectWebFollowUpDue(refs, { userId: "me", nowMs: NOW })).toEqual([]);
  });

  it("returns nothing without a signed-in user", () => {
    expect(selectWebFollowUpDue([ref({ id: "due" })], { userId: null, nowMs: NOW })).toEqual([]);
  });
});
