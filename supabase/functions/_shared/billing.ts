/**
 * Shared Stripe helpers for the billing Edge Functions.
 *
 * Entitlements are NOT written here: the Stripe Sync Engine mirrors
 * stripe.subscriptions and a DB trigger (public.sync_entitlement_from_subscription)
 * resolves profiles.plan_tier. These functions only create Stripe objects.
 * Prices are looked up by lookup_key (pro|duo|team × monthly|yearly), so no
 * STRIPE_PRICE_* secrets are needed.
 */

import Stripe from "https://esm.sh/stripe@14?target=deno";
import type { SupabaseClient, User } from "https://esm.sh/@supabase/supabase-js@2?target=deno";

export const TRIAL_DAYS_NO_CARD = 14;
export const TRIAL_DAYS_WITH_CARD = 30;
export const PAID_PLANS = ["pro", "duo", "team"] as const;
export type PaidPlan = (typeof PAID_PLANS)[number];
export const TEAM_MIN_SEATS = 3;
export const TEAM_MAX_SEATS = 500;

export const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

export function json(body: unknown, init?: ResponseInit): Response {
  return Response.json(body, { ...init, headers: { ...CORS_HEADERS, ...(init?.headers ?? {}) } });
}

export function makeStripe(): Stripe {
  return new Stripe(Deno.env.get("STRIPE_SECRET_KEY") ?? "", {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });
}

export function stripeSecretKeyConfigError(): string | null {
  const k = (Deno.env.get("STRIPE_SECRET_KEY") ?? "").trim();
  if (!k) return "STRIPE_SECRET_KEY is not set in Edge Function secrets.";
  if (k.startsWith("pk_")) return "STRIPE_SECRET_KEY is a publishable key (pk_…); use the secret key.";
  if (!k.startsWith("sk_") && !k.startsWith("rk_")) return "STRIPE_SECRET_KEY must start with sk_ or rk_.";
  return null;
}

export function isPaidPlan(v: unknown): v is PaidPlan {
  return typeof v === "string" && (PAID_PLANS as readonly string[]).includes(v);
}

export function lookupKey(plan: PaidPlan, interval: string | null | undefined): string {
  const s = (interval ?? "monthly").toLowerCase();
  return `${plan}_${s === "yearly" || s === "annual" ? "yearly" : "monthly"}`;
}

export async function priceForLookupKey(stripe: Stripe, key: string): Promise<Stripe.Price> {
  const { data } = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 1 });
  if (!data[0]) throw new Error(`No active Stripe price with lookup_key "${key}".`);
  return data[0];
}

/** Seats a plan needs: Team is per-seat (min 3); Pro and Duo are one flat unit. */
export function quantityFor(plan: PaidPlan, seats: number | undefined): number {
  if (plan !== "team") return 1;
  const n = Number.isFinite(seats) ? Math.floor(seats as number) : TEAM_MIN_SEATS;
  return Math.min(TEAM_MAX_SEATS, Math.max(TEAM_MIN_SEATS, n));
}

const ALLOWED_REDIRECT_ORIGINS = new Set([
  "https://app.moduo.app",
  "https://staging.moduo.app",
  "https://app.staging.moduo.app",
  "https://moduo.app",
  "https://www.moduo.app",
  "http://localhost:8081",
  "http://127.0.0.1:8081",
  "tauri://localhost",
  "http://tauri.localhost",
  "https://tauri.localhost",
]);

/** Stripe redirects the browser to these URLs — only ever to our own origins (no open redirect). */
export function safeRedirect(candidate: string | undefined | null, fallback: string): string {
  if (!candidate) return fallback;
  try {
    const u = new URL(candidate);
    const extra = Deno.env.get("APP_URL");
    if (ALLOWED_REDIRECT_ORIGINS.has(u.origin) || (extra && u.origin === new URL(extra).origin)) {
      return u.toString();
    }
  } catch {
    // fall through
  }
  return fallback;
}

export async function authenticate(
  supabase: SupabaseClient,
  authHeader: string | null,
): Promise<User | null> {
  if (!authHeader) return null;
  const { data: { user }, error } = await supabase.auth.getUser(authHeader.replace(/^Bearer\s+/i, ""));
  return error || !user ? null : user;
}

/** The Stripe customer for this user; created once (idempotent), recreated if the stored id is stale. */
export async function getOrCreateCustomer(
  stripe: Stripe,
  supabase: SupabaseClient,
  user: User,
): Promise<string> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id, display_name")
    .eq("id", user.id)
    .single();

  let customerId: string = profile?.stripe_customer_id ?? "";
  if (customerId) {
    try {
      const c = await stripe.customers.retrieve(customerId);
      if ((c as Stripe.DeletedCustomer).deleted) customerId = "";
    } catch (e) {
      if (/no such customer/i.test(e instanceof Error ? e.message : String(e))) customerId = "";
      else throw e;
    }
  }
  if (!customerId) {
    const customer = await stripe.customers.create(
      {
        email: user.email,
        name: profile?.display_name || undefined,
        metadata: { supabase_user_id: user.id },
      },
      { idempotencyKey: `customer-${user.id}-${Math.floor(Date.now() / 60_000)}` },
    );
    customerId = customer.id;
  }
  await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
  return customerId;
}

export function formatStripeErr(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
