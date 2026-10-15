/**
 * A2 · Account deleted. Copy: `.design/transactional-email/email-set.html` (A2).
 * Sent once by `delete-account`, directly and never queued (the address is
 * erased right after, T25), only when the deletion finished.
 *
 * The copy has to say only what deletion really does (PRIV-1/PRIV-2, 2026-10):
 * the account, its workspaces and everything only the person could see go;
 * shared items stay with their workspaces; subscriptions are cancelled before
 * the Stripe customer goes, so "you won't be charged again" holds even when the
 * Stripe step left a warning. The plan line is left out for someone who never
 * had a billing record at Stripe: they had no plan to cancel.
 *
 * The ratified A2 frame has no logo row, unlike every other account email; the
 * kit gives every email the same header (TX-1), so A2 gets the lockup too.
 */

import { singleLine } from "../../escape.ts";
import { type EmailDoc, heading, lockup, muted, paragraph } from "../blocks.ts";
import { dateLong, usableTimeZone } from "../format.ts";

export type AccountDeletedData = {
  /** The deleted address. */
  email: string;
  /** ISO time the account was deleted. */
  deletedAt: string;
  /** The person's own time zone, for the date; anything unusable falls back to UTC. */
  zone: string | null;
  /** A Stripe customer was closed: the email says the plan is cancelled. */
  hadBilling: boolean;
};

export function accountDeletedEmail(data: AccountDeletedData): EmailDoc {
  const email = singleLine(data.email, 254);
  const day = dateLong(new Date(data.deletedAt), usableTimeZone(data.zone));
  const shared = "Things you shared in other people's workspaces stay with those workspaces.";
  return {
    subject: "Your Moduo account is deleted",
    preheader: "This is the last email we'll send to this address.",
    blocks: [
      lockup(),
      heading("Your account is deleted"),
      paragraph(`We deleted your Moduo account and your data on ${day}, as you asked.`),
      paragraph(
        data.hadBilling ? `${shared} Your plan is canceled, and you won't be charged again.` : shared,
      ),
      muted(
        `This is the last email we'll send to ${email}, and we're removing the address from our records now. To come back later, you'd need a new invite.`,
      ),
    ],
    footer: { reason: "You got this email because the Moduo account for this address was deleted." },
  };
}
