import { describe, expect, it } from "@rstest/core";

import { accountDeletedFarewell } from "./account-deleted-send.ts";
import type { OutgoingEmail, SendResult } from "./send.ts";

const FAREWELL = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "tom@becker.studio",
  deletedAt: "2026-10-08T10:30:00Z",
  zone: "Europe/Warsaw",
  hadBilling: true,
};

function recorder(results: SendResult[]) {
  const sent: OutgoingEmail[] = [];
  const send = async (email: OutgoingEmail): Promise<SendResult> => {
    sent.push(email);
    return results.shift() ?? { ok: true, id: "re_1" };
  };
  return { sent, send };
}

describe("accountDeletedFarewell (A2 send)", () => {
  it("sends the rendered A2 from hello@, keyed by the account id", async () => {
    const { sent, send } = recorder([]);
    await accountDeletedFarewell({ apiKey: "re_test", send }).send(FAREWELL);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      from: '"Moduo" <hello@moduo.app>',
      to: "tom@becker.studio",
      subject: "Your Moduo account is deleted",
      idempotencyKey: `A2:${FAREWELL.userId}`,
      tags: [{ name: "kind", value: "account_deleted" }],
    });
    expect(sent[0].text).toContain("on 8 October 2026, as you asked.");
  });

  it("retries a temporary failure once with the same key", async () => {
    const { sent, send } = recorder([{ ok: false, retryable: true, status: 503, error: "resend_http_503" }]);
    await accountDeletedFarewell({ apiKey: "re_test", send }).send(FAREWELL);
    expect(sent).toHaveLength(2);
    expect(sent[1].idempotencyKey).toBe(sent[0].idempotencyKey);
  });

  it("throws when the send fails for good", async () => {
    const { sent, send } = recorder([{ ok: false, retryable: false, status: 422, error: "resend_http_422" }]);
    await expect(accountDeletedFarewell({ apiKey: "re_test", send }).send(FAREWELL)).rejects.toThrow(
      "resend_http_422",
    );
    expect(sent).toHaveLength(1);
  });
});
