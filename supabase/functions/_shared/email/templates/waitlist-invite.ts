/**
 * B1 · Waitlist invite. Copy: `.design/transactional-email/email-set.html` (B1).
 * Queued by the waitlist triggers when a row becomes `invited` (TX-4,
 * 20261010150000_tx4_invite_only_gate.sql): one email per invite, no expiry and
 * no reminder (Q20, Q21).
 *
 * The payload is written by SQL in snake_case; `parseWaitlistInvitePayload`
 * checks it. Rendering depends on the payload alone (no clock), so a retry
 * renders the same email and Resend's idempotency key holds.
 *
 * Not in the ratified copy: the footer for a `manual` invite (someone invited
 * with `waitlist_invite_email` who never joined the list), which can't say
 * "you joined the waitlist on …".
 */

import { CANONICAL_APP_ORIGIN } from "../../app-origin.ts";
import { singleLine } from "../../escape.ts";
import { button, type EmailDoc, heading, link, lockup, paragraph, signoff, strong } from "../blocks.ts";
import { dateLong } from "../format.ts";

/**
 * The public download link for the notarized Mac app. The "On a Mac?" line
 * appears only once there is one (ratified note on B1); until then it is null.
 */
export const MAC_DOWNLOAD_URL: string | null = null;

export type WaitlistInviteData = {
  /** The invited address: the one to sign in with. */
  email: string;
  /** ISO time the person joined the waitlist; null for a manual invite. */
  joinedAt: string | null;
};

/** The payload a queued B1 row carries, checked. Throws on a shape the template can't render. */
export function parseWaitlistInvitePayload(payload: Record<string, unknown>): WaitlistInviteData {
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error("waitlist_invite: email missing");
  if (payload.manual === true) return { email, joinedAt: null };
  const joinedAt = typeof payload.joined_at === "string" ? payload.joined_at : "";
  if (Number.isNaN(Date.parse(joinedAt))) throw new Error("waitlist_invite: joined_at missing");
  return { email, joinedAt };
}

export function waitlistInviteEmail(data: WaitlistInviteData): EmailDoc {
  const email = singleLine(data.email, 254);
  const reason = data.joinedAt
    ? `You got this email because you joined the Moduo waitlist on ${dateLong(new Date(data.joinedAt), "UTC")}.`
    : `You got this email because the Moduo team invited ${email} to Moduo.`;
  return {
    subject: "Your Moduo invite is ready",
    preheader: "Sign in with this address and you're in.",
    blocks: [
      lockup(),
      heading("You're in"),
      paragraph("Thanks for waiting. Your invite to Moduo is ready."),
      paragraph(
        "Moduo keeps your tasks, notes, calendar, email and contacts in one place, linked to each other.",
      ),
      paragraph("Sign in with ", strong(email), ". We'll email you a code, so there's no password to remember."),
      button("Open Moduo", CANONICAL_APP_ORIGIN, "app.moduo.app"),
      ...(MAC_DOWNLOAD_URL ? [link("On a Mac? Download the desktop app", MAC_DOWNLOAD_URL)] : []),
      paragraph(
        "Your first 14 days include everything in Pro. After that you can stay on Free or pick a plan. Nothing is charged during the beta.",
      ),
      paragraph(
        "It's early, so some things will break. When they do, reply to this email. We read everything, and one of us writes back.",
      ),
      signoff("Maciej & Mike"),
    ],
    footer: { reason },
  };
}
