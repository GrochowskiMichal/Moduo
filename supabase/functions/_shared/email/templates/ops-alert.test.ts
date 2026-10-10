import { describe, expect, it } from "@rstest/core";

import { renderEmail } from "../render.ts";
import { EMAIL_RUNBOOK_URL, opsAlertEmail, parseOpsAlertPayload } from "./ops-alert.ts";

// The payload email_outbox__health() writes (snake_case, from SQL).
const FAILURES = {
  reason: "failures",
  window_minutes: 10,
  auth_code_failed: 0,
  other_failed: 3,
  errors: [
    { error: "resend_http_500", count: 2 },
    { error: "Invalid `to` field: [address]", count: 1 },
  ],
  detected_at: "2026-10-16T12:05:00Z",
};

describe("ops alert", () => {
  it("reads the health job's payload", () => {
    expect(parseOpsAlertPayload(FAILURES)).toEqual({
      reason: "failures",
      windowMinutes: 10,
      authCodeFailed: 0,
      otherFailed: 3,
      errors: [
        { error: "resend_http_500", count: 2 },
        { error: "Invalid `to` field: [address]", count: 1 },
      ],
      detectedAt: "2026-10-16T12:05:00Z",
    });
  });

  it("leads with sign-in codes when any failed, and with the count otherwise", () => {
    const some = opsAlertEmail(parseOpsAlertPayload(FAILURES));
    expect(some.subject).toBe("Email alert: 3 emails failed in 10 minutes");

    const codes = opsAlertEmail(parseOpsAlertPayload({ ...FAILURES, auth_code_failed: 1, other_failed: 0 }));
    expect(codes.subject).toBe("Email alert: 1 sign-in code failed");
    const { text } = renderEmail(codes);
    expect(text).toContain("switch the Send Email Hook off");
    expect(text).toContain(EMAIL_RUNBOOK_URL);
  });

  it("lists the commonest errors and when it noticed, in UTC", () => {
    const { text } = renderEmail(opsAlertEmail(parseOpsAlertPayload(FAILURES)));
    expect(text).toContain("16 October 2026 at 12:05 UTC");
    expect(text).toContain("resend_http_500 (2×)");
    expect(text).toContain("Invalid `to` field: [address] (1×)");
  });

  it("renders the outbox test", () => {
    const doc = opsAlertEmail(parseOpsAlertPayload({ reason: "test", requested_at: "2026-10-16T12:00:00Z" }));
    expect(doc.subject).toBe("Email test: the outbox works");
    expect(renderEmail(doc).text).toContain("Queued 16 October 2026 at 12:00 UTC.");
    // A test queued without a time still renders.
    expect(opsAlertEmail(parseOpsAlertPayload({ reason: "test" })).blocks.length).toBeGreaterThan(0);
  });

  it("refuses a payload it can't render", () => {
    expect(() => parseOpsAlertPayload({ reason: "other" })).toThrow("unknown reason");
    expect(() => parseOpsAlertPayload({ reason: "failures" })).toThrow("detected_at");
  });

  it("renders the same email twice from the same payload (the idempotency key needs that)", () => {
    const a = renderEmail(opsAlertEmail(parseOpsAlertPayload(FAILURES)));
    const b = renderEmail(opsAlertEmail(parseOpsAlertPayload(FAILURES)));
    expect(a).toEqual(b);
  });
});
