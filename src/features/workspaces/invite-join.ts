/**
 * Accepting a workspace invite across sign-in (DF-24, TX-7).
 *
 * - The pending join: /join stores the invite token before sending a
 *   signed-out person to /auth; the code sign-in (email-auth-panel) and
 *   /auth itself resume at /join with it, before onboarding.
 * - The address check: an invite works only for the address it was sent to
 *   (specs/transactional-email.md S1). `workspace_op_accept_invite` refuses
 *   any other signed-in address with `invite_email_mismatch`, and its hint is
 *   the invited address masked (t•••@becker.studio).
 */

export const PENDING_JOIN_KEY = "moduo:pending_join";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function setPendingJoin(token: string): void {
  storage()?.setItem(PENDING_JOIN_KEY, token);
}

/** The pending invite token, removed as it is read; null when there is none. */
export function takePendingJoin(): string | null {
  const store = storage();
  const token = store?.getItem(PENDING_JOIN_KEY)?.trim() || null;
  if (token) store?.removeItem(PENDING_JOIN_KEY);
  return token;
}

/** The /join URL that accepts `token`. */
export function joinPath(token: string): string {
  return `/join?invite=${encodeURIComponent(token)}`;
}

/** A masked address as the server writes it: "t•••@becker.studio". */
const MASKED_EMAIL = /^[^\s@]{0,1}•••@[^\s@]{1,253}$/u;

export function inviteMismatchMessage(maskedEmail: string | null): string {
  return maskedEmail
    ? `This invite is for ${maskedEmail}. Sign in with that address to join.`
    : "This invite is for a different email address. Sign in with that address to join.";
}

/** The signed-in address isn't the one the invite was sent to. */
export class InviteEmailMismatchError extends Error {
  readonly maskedEmail: string | null;

  constructor(hint: unknown) {
    const masked = typeof hint === "string" && MASKED_EMAIL.test(hint.trim()) ? hint.trim() : null;
    super(inviteMismatchMessage(masked));
    this.name = "InviteEmailMismatchError";
    this.maskedEmail = masked;
  }
}

/** True for the accept function's refusal of another address. */
export function isInviteEmailMismatch(message: string): boolean {
  return /\binvite_email_mismatch\b/.test(message);
}
