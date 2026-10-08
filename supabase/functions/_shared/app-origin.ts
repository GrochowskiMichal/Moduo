/**
 * Fixed origins for links Moduo sends by email.
 *
 * Never build an emailed link from the request (the Origin header or a body
 * field): public endpoints have no session, so anyone can forge either and
 * make our sender mail a link to their own domain. A caller's hint may only
 * pick between the origins listed here; anything else gets the canonical one.
 * Add a host here (and to vercel.json for /book) before linking to it.
 */

/** Public hosts that serve /book (vercel.json rewrites it to the app shell), plus the dev server. */
export const BOOKING_ORIGINS: readonly string[] = [
  "https://moduo.app",
  "https://www.moduo.app",
  "https://staging.moduo.app",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
];
export const CANONICAL_BOOKING_ORIGIN = "https://moduo.app";

/** Hosts that serve the signed-in web app (/join and the rest), plus the dev server. */
export const APP_ORIGINS: readonly string[] = [
  "https://app.moduo.app",
  "https://app.staging.moduo.app",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
];
export const CANONICAL_APP_ORIGIN = "https://app.moduo.app";

/** The origin of `candidate` when it parses and is on `allowed`, else null. Path, query and userinfo are dropped. */
export function allowListedOrigin(candidate: unknown, allowed: readonly string[]): string | null {
  if (typeof candidate !== "string") return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  return allowed.includes(url.origin) ? url.origin : null;
}

/** Where a booking email's links point: the page's own host when it is one of ours, else moduo.app. */
export function bookingOrigin(hint: unknown): string {
  return allowListedOrigin(hint, BOOKING_ORIGINS) ?? CANONICAL_BOOKING_ORIGIN;
}

/**
 * Where app links (invites) point. `configured` is the APP_URL secret, which
 * only project admins set, so any https origin is trusted (same rule as
 * billing's safeRedirect); plain http only for the listed dev server.
 */
export function appOrigin(configured: string | null | undefined): string {
  if (!configured) return CANONICAL_APP_ORIGIN;
  try {
    const url = new URL(configured.trim());
    if (url.protocol === "https:" || APP_ORIGINS.includes(url.origin)) return url.origin;
  } catch {
    // fall through
  }
  return CANONICAL_APP_ORIGIN;
}

export function bookingCancelUrl(origin: string, token: string): string {
  return `${origin}/book/cancel?token=${encodeURIComponent(token)}`;
}

/** Matches runtime.workspace.inviteUrl and the /join route's `?invite=` search param. */
export function workspaceInviteUrl(origin: string, token: string): string {
  return `${origin}/join?invite=${encodeURIComponent(token)}`;
}
