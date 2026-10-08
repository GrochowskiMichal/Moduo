/**
 * Edge Function: delete-account (DF-19h)
 *
 * Permanently deletes the caller's account. A client can't delete its own auth
 * user or cascade safely, so this runs with the project's default secret key
 * (service-role credentials) and the Stripe secret key.
 *
 * Deploy with verify_jwt = false — the caller's JWT is verified in code (getUser).
 *
 * Guard (ratified): if the caller SOLELY owns a workspace that still has other
 * members, deletion is BLOCKED (would orphan teammates) — the response lists the
 * blocking workspaces so the UI can tell the user to hand off ownership or delete
 * them first. An owned *solo* workspace (no other members) is safe: it is
 * cascade-deleted with the account (FKs: auth.users → profiles → workspaces(owner)
 * → workspace_members, all ON DELETE CASCADE; the caller's own memberships in
 * other workspaces cascade via workspace_members.user_id → profiles).
 *
 * Erasure (2026-10-07): the cascade doesn't reach Stripe, Storage, booking links,
 * integration tokens or the waitlist. ../_shared/account-erasure.ts removes those
 * first and deletes the auth user last, so a failed run can simply be retried.
 * PRIV-3 adds the app's usage analytics at PostHog, first of all; without the
 * POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID secrets that step only logs a warning.
 *
 * Returns:
 *   200 { ok: true }
 *   409 { blocked: true, workspaces: [{ id, name }] }
 *   401 { error }  /  500 { error, step? }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

import {
  deleteAccount,
  type ErasureDb,
  ErasureError,
  erasureErrorMessage,
} from "../_shared/account-erasure.ts";
import { makeStripe, stripeSecretKeyConfigError } from "../_shared/billing.ts";
import { postHogEraserFromEnv } from "../_shared/posthog-erasure.ts";
import { getDefaultSecretKey } from "../_shared/secret-keys.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, init?: ResponseInit) =>
  Response.json(body, { ...init, headers: { ...CORS, ...(init?.headers ?? {}) } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, { status: 405 });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      getDefaultSecretKey(),
      { auth: { persistSession: false } },
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, { status: 401 });

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser(authHeader.replace("Bearer ", ""));
    if (authError || !user) return json({ error: "Unauthorized" }, { status: 401 });

    // supabase-js parses select() column strings at the type level, which can't be
    // checked against ErasureDb (TS2589), so only `from` is cast; storage and auth check.
    const db: ErasureDb = {
      from: (table) => supabase.from(table) as unknown as ReturnType<ErasureDb["from"]>,
      storage: supabase.storage,
      auth: supabase.auth,
    };
    // null when the key is missing: the erasure then refuses to finish for anyone
    // who has a Stripe customer, instead of leaving that record behind.
    const stripe = stripeSecretKeyConfigError() ? null : makeStripe();

    const posthog = postHogEraserFromEnv((name) => Deno.env.get(name));

    const result = await deleteAccount(
      { db, stripe, posthog },
      // An unconfirmed address may be someone else's: it must not delete their waitlist rows.
      { id: user.id, email: user.email_confirmed_at ? (user.email ?? null) : null },
    );
    if (result.status === "blocked") {
      return json({ blocked: true, workspaces: result.workspaces }, { status: 409 });
    }
    if (result.warnings.length > 0) {
      console.warn("[delete-account] deleted with warnings", user.id, result.warnings);
    }
    return json({ ok: true });
  } catch (err) {
    console.error("[delete-account]", err);
    if (err instanceof ErasureError) {
      return json({ error: erasureErrorMessage(err.step), step: err.step }, { status: 500 });
    }
    return json({ error: err instanceof Error ? err.message : "Internal error" }, { status: 500 });
  }
});
