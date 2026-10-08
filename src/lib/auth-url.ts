/**
 * Moduo never takes a session from the URL.
 *
 * With `detectSessionInUrl: true` (supabase-js's default), auth-js accepts any
 * `#access_token=…&refresh_token=…&expires_in=…&token_type=bearer` fragment on
 * any app URL and replaces the session in that tab. That is a login CSRF: anyone
 * can send `https://app.moduo.app/#access_token=<their own token>…` and the
 * person who opens it is now working in the sender's account. Nothing in the app
 * needs a URL sign-in: people sign in by typing the 6-digit code from the email
 * (`verifyOtp`). So detection is off, and a fragment that still arrives (an
 * invite link, an old magic link, or a forged one) is wiped from the address bar
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

/** What an ignored GoTrue redirect carried: a session, or a link error (e.g. `otp_expired`). */
export type IgnoredAuthLink = "session" | "error";

const SESSION_KEYS = ["access_token", "refresh_token", "provider_token", "provider_refresh_token"];
const ERROR_KEYS = ["error_code", "error_description"];

/** Classifies a `location.hash` as a GoTrue implicit-grant redirect, or null for any other fragment. */
export function authCallbackKind(hash: string): IgnoredAuthLink | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (SESSION_KEYS.some((key) => params.has(key))) return "session";
  if (ERROR_KEYS.some((key) => params.has(key))) return "error";
  return null;
}

let ignoredLink: IgnoredAuthLink | null = null;

/**
 * Drops a GoTrue redirect fragment from the current URL without reading it, so
 * tokens don't sit in the address bar or history. Called once, first thing at
 * boot ([auth-url-boot.ts](./auth-url-boot.ts)), before the router reads the
 * location. Returns, and remembers, what it dropped.
 */
export function scrubAuthCallbackFromUrl(): IgnoredAuthLink | null {
  if (typeof window === "undefined") return null;
  const { hash, pathname, search } = window.location;
  ignoredLink = authCallbackKind(hash);
  if (ignoredLink) window.history.replaceState(window.history.state, "", `${pathname}${search}`);
  return ignoredLink;
}

/** What this page load's boot scrub dropped, if anything (the sign-in page explains it). */
export function ignoredAuthLink(): IgnoredAuthLink | null {
  return ignoredLink;
}

/** Forget the dropped link once someone signs in, so a later sign-out doesn't repeat the notice. */
export function clearIgnoredAuthLink(): void {
  ignoredLink = null;
}
