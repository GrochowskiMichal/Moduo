/**
 * What the sign-in screen says when a code request fails (TX-2, AC9/AC10).
 * Supabase Auth's own text ("For security purposes, you can only request this
 * after 42 seconds.", "email rate limit exceeded", "Error sending magic link
 * email") never reaches the screen for these cases.
 */

import type { OtpSendError } from "@/lib/runtime";

/** The ratified "couldn't send" line (specs/transactional-email.md, flow 1). */
export const OTP_SEND_FAILED_MESSAGE = "We couldn't send your code. Try again in a minute.";
export const OTP_TOO_MANY_MESSAGE = "Too many code requests right now. Try again in a few minutes.";
/** The ratified invite-only line (specs/transactional-email.md, flow 1; TX-4). */
export const OTP_INVITE_ONLY_MESSAGE =
  "Moduo is invite-only right now. Join the waitlist at moduo.app, or ask the person who invited you to use this address.";
/**
 * While sign-ups are still off on the project (before TX-4's dashboard steps),
 * Auth refuses an unconfirmed address as `signup_disabled`, and a dashboard
 * invitee gets in only by clicking their invite link first (TX-2).
 */
export const OTP_SIGNUPS_OFF_MESSAGE =
  "Moduo is invite-only right now. If you were invited, click the link in your invite email first, then ask for a code here. If that link has expired, ask for a new invite.";

/**
 * How long a code works (Auth's OTP expiry, 600 s since TX-2). Matches the email's
 * AUTH_CODE_VALID_MINUTES; otp-send-error.test.ts keeps the two equal.
 */
export const OTP_VALID_MINUTES = 10;

/** Seconds between code requests for one address (Auth's `max_frequency`); the resend countdown. */
export const OTP_RESEND_SECONDS = 60;

export type OtpSendFailure =
  /** Asked again too soon for this address: wait this many seconds. */
  { kind: "wait"; seconds: number; message: string } | { kind: "message"; message: string };

export function otpWaitMessage(seconds: number): string {
  return `You can ask for another code in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`;
}

export function describeOtpSendError(error: OtpSendError): OtpSendFailure {
  const message = error.message ?? "";
  const code = error.code ?? "";

  // An address nobody invited: the before-user-created hook refuses it with the
  // message `invite_only` (TX-4, 20261010150000). Checked before the
  // hook-failure branch below, so a refusal never reads as "couldn't send".
  if (/\binvite_only\b/.test(message)) {
    return { kind: "message", message: OTP_INVITE_ONLY_MESSAGE };
  }
  // Sign-ups still off on the project: only a confirmed address gets a code.
  if (code === "signup_disabled" || /signups? not allowed/i.test(message)) {
    return { kind: "message", message: OTP_SIGNUPS_OFF_MESSAGE };
  }

  // One address asked again inside `max_frequency`: Auth names the wait.
  const wait = /after (\d+) seconds?/i.exec(message);
  if (wait) {
    const seconds = Math.max(1, Math.min(Number(wait[1]), OTP_RESEND_SECONDS * 10));
    return { kind: "wait", seconds, message: otpWaitMessage(seconds) };
  }

  if (error.status === 429 || /rate.?limit/i.test(code) || /rate limit/i.test(message)) {
    return { kind: "message", message: OTP_TOO_MANY_MESSAGE };
  }

  // The Send Email Hook (or Auth's mailer) couldn't send it.
  if (
    (typeof error.status === "number" && error.status >= 500) ||
    code.startsWith("hook_") ||
    code === "unexpected_failure" ||
    /error sending|email_send_failed|hook/i.test(message)
  ) {
    return { kind: "message", message: OTP_SEND_FAILED_MESSAGE };
  }

  return { kind: "message", message: message || OTP_SEND_FAILED_MESSAGE };
}

/** "0:59" for a countdown. */
export function formatCountdown(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
