/**
 * Calendar accounts for calendar-google-web: the status action's calendar rows
 * and the reauth mark of a Google login. Pure (no esm.sh imports) so Node tests
 * can import it.
 */

import type { GoogleCalendarInfo } from "../_shared/google-calendar.ts";
import type { GoogleAccessOutcome } from "../_shared/google-token.ts";

export type StatusCalendar = {
  email: string;
  accountId: string;
  summary: string;
  googleCalendarId: string;
  primary: boolean;
  readOnly: boolean;
};

const READ_ONLY_ROLES = new Set(["reader", "freeBusyReader"]);

/** One login's calendars, primary first; an empty list is the primary calendar, writable. */
export function statusCalendars(email: string, listed: GoogleCalendarInfo[]): StatusCalendar[] {
  if (listed.length === 0) {
    return [
      {
        email,
        accountId: `google:${email}:primary`,
        summary: email,
        googleCalendarId: "primary",
        primary: true,
        readOnly: false,
      },
    ];
  }
  return [...listed]
    .sort((a, b) => Number(b.primary) - Number(a.primary))
    .map((cal) => ({
      email,
      accountId: `google:${email}:${cal.id}`,
      summary: cal.summary,
      googleCalendarId: cal.id,
      primary: cal.primary,
      readOnly: READ_ONLY_ROLES.has(cal.accessRole),
    }));
}

type RpcDb = {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ error?: unknown } | unknown>;
};

/** Marks a revoked login's calendars reauth, or clears it on a working token. Never throws. */
export async function recordGoogleAccess(
  db: RpcDb,
  userId: string,
  email: string,
  outcome: GoogleAccessOutcome,
): Promise<void> {
  if (outcome.kind === "unavailable" || !email) return;
  const revoked = outcome.kind === "revoked";
  try {
    const res = (await db.rpc("calendar_op__google_reauth", {
      p_owner_id: userId,
      p_email: email.toLowerCase(),
      p_reauth: revoked,
      p_error: revoked ? outcome.reason : null,
    })) as { error?: { message?: string } | null } | null;
    if (res?.error) console.error("[calendar-google-web] reauth mark refused:", res.error.message ?? res.error);
  } catch (err) {
    console.error("[calendar-google-web] reauth mark failed:", err instanceof Error ? err.message : err);
  }
}
