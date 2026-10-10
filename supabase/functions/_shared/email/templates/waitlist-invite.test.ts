import { describe, expect, it } from "@rstest/core";

import { OUTBOX_TEMPLATES } from "../outbox.ts";
import { renderEmail } from "../render.ts";
import { parseWaitlistInvitePayload, waitlistInviteEmail } from "./waitlist-invite.ts";

// The payload waitlist__queue_invite() writes (snake_case, from SQL).
const JOINED = { email: "tom@becker.studio", joined_at: "2026-10-02T09:14:00Z", manual: false };
const MANUAL = { email: "anna@northwind.studio", joined_at: "2026-10-16T12:00:00Z", manual: true };

describe("waitlist invite (B1)", () => {
  it("reads the trigger's payload", () => {
    expect(parseWaitlistInvitePayload(JOINED)).toEqual({ email: "tom@becker.studio", joinedAt: "2026-10-02T09:14:00Z" });
    expect(parseWaitlistInvitePayload(MANUAL)).toEqual({ email: "anna@northwind.studio", joinedAt: null });
  });

  it("has the ratified subject, preheader and copy", () => {
    const doc = waitlistInviteEmail(parseWaitlistInvitePayload(JOINED));
    expect(doc.subject).toBe("Your Moduo invite is ready");
    expect(doc.preheader).toBe("Sign in with this address and you're in.");
    const { text } = renderEmail(doc);
    expect(text).toContain("Thanks for waiting. Your invite to Moduo is ready.");
    expect(text).toContain("Sign in with tom@becker.studio. We'll email you a code");
    expect(text).toContain("https://app.moduo.app");
    expect(text).toContain("Your first 14 days include everything in Pro.");
    expect(text).toContain("Maciej & Mike");
    // No notarized download yet, so no Mac line.
    expect(text).not.toContain("On a Mac?");
  });

  it("says when the person joined, and something true for a manual invite", () => {
    expect(renderEmail(waitlistInviteEmail(parseWaitlistInvitePayload(JOINED))).text).toContain(
      "You got this email because you joined the Moduo waitlist on 2 October 2026.",
    );
    const manual = renderEmail(waitlistInviteEmail(parseWaitlistInvitePayload(MANUAL))).text;
    expect(manual).toContain("You got this email because the Moduo team invited anna@northwind.studio to Moduo.");
    expect(manual).not.toContain("joined the Moduo waitlist");
  });

  it("refuses a payload it can't render", () => {
    expect(() => parseWaitlistInvitePayload({})).toThrow("email missing");
    expect(() => parseWaitlistInvitePayload({ email: "tom@becker.studio" })).toThrow("joined_at missing");
  });

  it("renders the same email twice from the same payload (the idempotency key needs that)", () => {
    const a = renderEmail(waitlistInviteEmail(parseWaitlistInvitePayload(JOINED)));
    const b = renderEmail(waitlistInviteEmail(parseWaitlistInvitePayload(JOINED)));
    expect(a).toEqual(b);
  });

  it("is a kind the worker can send", () => {
    const queued = OUTBOX_TEMPLATES.waitlist_invite?.(JOINED);
    expect(queued?.doc.subject).toBe("Your Moduo invite is ready");
  });
});
