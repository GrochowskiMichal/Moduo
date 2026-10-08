/**
 * A1 · Sign-in code. Copy: `.design/transactional-email/email-set.html` (A1).
 * Code only, no sign-in link, so it works on desktop too (Q13); the same email
 * for a first sign-in (Q14); the code is in the subject (Q10).
 */

import { singleLine } from "../../escape.ts";
import { codeBox, type EmailDoc, heading, lockup, muted, paragraph } from "../blocks.ts";

export type AuthCodeData = {
  /** The one-time code Supabase generated. */
  code: string;
  /** The address the code was requested for, named in the footer. */
  email: string;
  /** How long the code works, in minutes (Auth's OTP expiry). */
  validMinutes?: number;
};

export const AUTH_CODE_VALID_MINUTES = 10;

export function authCodeEmail(data: AuthCodeData): EmailDoc {
  // Codes are digits (6 today). Anything else is dropped rather than rendered.
  const code = data.code.replace(/[^0-9A-Za-z]/g, "").slice(0, 12);
  // No code means a bug upstream; the caller's plain-text/error path handles it.
  if (!code) throw new Error("auth_code: empty code");
  const minutes = data.validMinutes ?? AUTH_CODE_VALID_MINUTES;
  const forMinutes = `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  return {
    subject: `${code} is your Moduo code`,
    preheader: `It works for ${forMinutes}.`,
    blocks: [
      lockup(),
      heading("Your sign-in code"),
      paragraph("Enter this code in Moduo to sign in."),
      codeBox(code),
      muted(
        `It works once, for ${forMinutes}. If you didn't ask for it, ignore this email. Nobody can sign in without the code.`,
      ),
    ],
    footer: {
      reason: `You got this email because someone asked to sign in to Moduo with ${singleLine(data.email, 254)}.`,
    },
  };
}
