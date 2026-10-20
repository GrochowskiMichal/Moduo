/** The browser's one Supabase client (and its project URL): light enough to
 * import on its own, without loading every module's data access. */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/supabase";
import { clearIgnoredAuthLink, SUPABASE_AUTH_OPTIONS } from "./auth-url";
import { readOnlyFetch } from "./min-build";
import { publicConfig } from "./public-config";
import { createRequestCache } from "./request-cache";

// ── Supabase client ────────────────────────────────────────────────────────────

export const SUPABASE_URL: string =
  publicConfig().supabaseUrl || "https://wtoonrvuqumihpkbvwvs.supabase.co";
export const SUPABASE_PUBLISHABLE_KEY: string =
  publicConfig().supabasePublishableKey || "sb_publishable_NAVl-rzFzPOi5ZU84aC3pA_SOIR00so";

// No session ever comes from the URL (login CSRF): see auth-url.ts. The boot
// scrub of a leftover token fragment runs from main.tsx, before the router.
// Below the minimum client build every write is refused here (TV-D8); reads and
// sign-in pass. See lib/min-build.ts.
export const supabaseClient: SupabaseClient<Database> = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: SUPABASE_AUTH_OPTIONS,
    global: { fetch: readOnlyFetch((...args) => fetch(...args)) },
  },
);

// ── Boot-time read coalescer (DF-12) ─────────────────────────────────────────────
// One cold launch used to fire `/auth/v1/user` ×8 (every user-scoped runtime method
// called `getUser()` on its own) and the profile read ×4 (the auth provider fetched
// it on both bootstrap and INITIAL_SESSION). This shares those reads: one auth/user
// + one profile per boot, deduped across every caller.
export const bootReads = createRequestCache();
export const AUTH_USER_KEY = "auth:user";

// Registered with the client, so it sees the SIGNED_IN of a restored session
// at startup even before the runtime's modules load.
// Drop the whole boot cache (user + profiles) on any identity transition. We keep
// it through INITIAL_SESSION and TOKEN_REFRESHED (same user), so those never
// re-trigger the storm — only a real sign-in/out / user-update clears it.
supabaseClient.auth.onAuthStateChange((event) => {
  if (event === "SIGNED_IN") clearIgnoredAuthLink();
  if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
    bootReads.clear();
  }
});
