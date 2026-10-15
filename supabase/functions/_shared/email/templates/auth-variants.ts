/**
 * The other emails Supabase Auth asks the Send Email Hook for (TX-2, T7). They
 * share A1's kind (`auth_code`) and its log row; neither is in the ratified set,
 * so their copy follows A1's voice and is listed in the email set as "A1 variants".
 *
 * - Dashboard invite ("Add user → Send invitation"): keeps the confirmation link.
 *   Sign-ups are off, so an unconfirmed address can't ask for a code (GoTrue sends
 *   it through sign-up and refuses); clicking this link is what confirms it. The
 *   app never signs anyone in from the link (detectSessionInUrl: false,
 *   docs/decisions/data.md 2026-10-08): the person then signs in with a code.
 *   Replaced by the waitlist invite (B1) when TX-4 turns sign-ups back on.
 * - A neutral code for recovery, email change and reauthentication, which no
 *   screen asks for today.
 */

import { singleLine } from "../../escape.ts";
import { button, codeBox, type EmailDoc, heading, lockup, muted, paragraph, strong } from "../blocks.ts";
import { AUTH_CODE_VALID_MINUTES } from "./auth-code.ts";

function forMinutes(minutes: number): string {
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
}

export type AuthInviteData = {
  /** The invited address. */
  email: string;
  /** Supabase's /auth/v1/verify link for this invite; confirms the address. */
  confirmUrl: string;
  /** How long the link works, in minutes (Auth's OTP expiry). */
  validMinutes?: number;
};

export function authInviteEmail(data: AuthInviteData): EmailDoc {
  if (!data.confirmUrl) throw new Error("auth_invite: no confirmation link");
  const email = singleLine(data.email, 254);
  const minutes = forMinutes(data.validMinutes ?? AUTH_CODE_VALID_MINUTES);
  return {
    subject: "You're invited to Moduo",
    preheader: "Confirm your address, then sign in with a code.",
    blocks: [
      lockup(),
      heading("You're invited"),
      paragraph("You've been invited to Moduo. Confirm this address to get started."),
      button("Confirm your address", data.confirmUrl, `The link works for ${minutes}.`),
      paragraph("Then sign in with ", strong(email), ". We'll email you a code, so there's no password to remember."),
      muted("If the link has expired, ask the person who invited you for a new invite."),
      muted("Not expecting this? Ignore it and nothing happens."),
    ],
    footer: {
      reason: `You got this email because someone invited ${email} to Moduo.`,
    },
  };
}

export type AuthConfirmCodeData = {
  code: string;
  email: string;
  validMinutes?: number;
};

/** A code that confirms something other than a sign-in (recovery, email change, reauthentication). */
export function authConfirmCodeEmail(data: AuthConfirmCodeData): EmailDoc {
  const code = data.code.replace(/[^0-9A-Za-z]/g, "").slice(0, 12);
  if (!code) throw new Error("auth_code: empty code");
  const minutes = forMinutes(data.validMinutes ?? AUTH_CODE_VALID_MINUTES);
  return {
    subject: `${code} is your Moduo confirmation code`,
    preheader: `It works for ${minutes}.`,
    blocks: [
      lockup(),
      heading("Your confirmation code"),
      paragraph("Enter this code in Moduo to confirm the change."),
      codeBox(code),
      muted(
        `It works once, for ${minutes}. If you didn't ask for it, ignore this email and nothing changes.`,
      ),
    ],
    footer: {
      reason: `You got this email because someone asked Moduo for a confirmation code for ${singleLine(data.email, 254)}.`,
    },
  };
}
