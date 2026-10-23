/**
 * Connecting an app across sign-in (MCPO-4, specs/mcp-oauth.md AC6).
 *
 * /oauth/consent stores the sign-in's `authorization_id` before sending a
 * signed-out person to /auth; the code sign-in (email-auth-panel) and /auth
 * itself resume at /oauth/consent with it, before a pending invite or
 * onboarding. Supabase Auth lets an app's sign-in live 3 minutes, so a
 * pending consent older than 10 minutes is someone's abandoned attempt.
 */

export const PENDING_CONSENT_KEY = "moduo:pending_consent";

export const PENDING_CONSENT_TTL_MS = 10 * 60 * 1000;

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function setPendingConsent(authorizationId: string, now: number = Date.now()): void {
  const id = authorizationId.trim();
  if (!id) return;
  storage()?.setItem(PENDING_CONSENT_KEY, JSON.stringify({ authorizationId: id, at: now }));
}

function read(raw: string | null | undefined, now: number): string | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as { authorizationId?: unknown; at?: unknown };
    const id = typeof value.authorizationId === "string" ? value.authorizationId.trim() : "";
    const at = typeof value.at === "number" ? value.at : Number.NaN;
    return id && now - at >= 0 && now - at <= PENDING_CONSENT_TTL_MS ? id : null;
  } catch {
    return null;
  }
}

/** Whether a fresh pending consent is waiting, without taking it (/auth's "connect your app" line). */
export function hasPendingConsent(now: number = Date.now()): boolean {
  return read(storage()?.getItem(PENDING_CONSENT_KEY), now) !== null;
}

/** The pending `authorization_id`, removed as it is read; null when there is none or it went stale. */
export function takePendingConsent(now: number = Date.now()): string | null {
  const store = storage();
  const raw = store?.getItem(PENDING_CONSENT_KEY);
  if (raw == null) return null;
  store?.removeItem(PENDING_CONSENT_KEY);
  return read(raw, now);
}

/** The consent page for a sign-in. */
export function consentPath(authorizationId: string): string {
  return `/oauth/consent?authorization_id=${encodeURIComponent(authorizationId)}`;
}
