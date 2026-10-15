/**
 * Sends A2 ("account deleted") for delete-account (TX-8, T25): rendered here and
 * sent straight to Resend, never through the outbox, because the address is
 * erased in the same request and must leave no record behind.
 *
 * The idempotency key is the account id, so two deletion requests racing to the
 * end send one email between them (Resend keeps keys for 24 hours). One retry for
 * a temporary failure; anything else throws, and deleteAccount turns that into a
 * warning (the account is already gone by then).
 */

import type { ErasureFarewell, FarewellEmail } from "../account-erasure.ts";
import { renderEmail } from "./render.ts";
import { ACCOUNT_SENDER_ADDRESS, formatFrom, type SendDeps, type SendResult, sendViaResend } from "./send.ts";
import { accountDeletedEmail } from "./templates/account-deleted.ts";

export function accountDeletedFarewell(
  deps: SendDeps & { send?: typeof sendViaResend },
): ErasureFarewell {
  const send = deps.send ?? sendViaResend;
  return {
    async send(farewell: FarewellEmail): Promise<void> {
      const { userId, ...data } = farewell;
      const rendered = renderEmail(accountDeletedEmail(data));
      const email = {
        from: formatFrom("Moduo", ACCOUNT_SENDER_ADDRESS),
        to: data.email,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        tags: [{ name: "kind", value: "account_deleted" }],
        idempotencyKey: `A2:${userId}`,
      };
      let result: SendResult = await send(email, deps);
      if (!result.ok && result.retryable) result = await send(email, deps);
      if (!result.ok) throw new Error(result.error);
    },
  };
}
