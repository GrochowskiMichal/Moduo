/**
 * Moduo never takes a session from the URL.
 *
 * With `detectSessionInUrl: true` (supabase-js's default), auth-js accepts any
 * `#access_token=…&refresh_token=…&expires_in=…&token_type=bearer` fragment on
 * any app URL and replaces the session in that tab. That is a login CSRF: anyone
 * can send `https://app.moduo.app/#access_token=<their own token>…` and the
 * person who opens it is now working in the sender's account. Nothing in the app
 * needs a URL sign-in: people sign in by typing the 6-digit code from the email
 * (`verifyOtp`). So detection is off, and a token fragment that still arrives
 * (an old invite or magic link, or a forged one) is wiped from the address bar
 * and history at boot, without being read. Decision: docs/decisions/data.md
 * 2026-10-08. If a URL callback is ever needed, it has to be PKCE (a code plus a
 * verifier this browser stored), never the implicit fragment.
 */

import type { SupabaseClientOptions } from "@supabase/supabase-js";

export const SUPABASE_AUTH_OPTIONS = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: false,
} as const satisfies NonNullable<SupabaseClientOptions<"public">["auth"]>;

/** Keys of a GoTrue implicit-grant redirect fragment, success or error. */
const AUTH_FRAGMENT_KEYS = [
  "access_token",
  "refresh_token",
  "provider_token",
  "provider_refresh_token",
  "error_code",
  "error_description",
] as const;

/** True when a `location.hash` is a GoTrue sign-in redirect (tokens or a link error). */
export function isAuthCallbackFragment(hash: string): boolean {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return false;
  const params = new URLSearchParams(raw);
  return AUTH_FRAGMENT_KEYS.some((key) => params.has(key));
}

let authLinkIgnored = false;

/**
 * Drops a sign-in fragment from the current URL without reading it, so tokens
 * don't sit in the address bar or history. Runs once when the Supabase client is
 * created, before the router reads the location. Returns whether it dropped one.
 */
export function scrubAuthCallbackFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  const { hash, pathname, search } = window.location;
  if (!isAuthCallbackFragment(hash)) return false;
  window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  authLinkIgnored = true;
  return true;
}

/** Whether this page load arrived with a sign-in link that was ignored (the sign-in page says so). */
export function authLinkWasIgnored(): boolean {
  return authLinkIgnored;
}
