/**
 * Client side of create-checkout-session. One function for the paywall, the upgrade modal
 * and anywhere else that starts or changes a plan. The server decides what actually happens
 * (switch a trial in place, open the portal, or open Checkout); this just carries it out.
 */

import { SUPABASE_URL } from "../../lib/runtime.web";
import type { BillingInterval, PaidPlan } from "./plans";
import { openStripeUrl } from "./stripe-url";

export type CheckoutOutcome = "redirected" | "switched";

export async function startCheckout(args: {
  accessToken: string | null;
  plan: PaidPlan;
  interval?: BillingInterval;
  seats?: number;
  /** Ask for the 30-day trial (card required up front) instead of the 14-day no-card one. */
  withCard?: boolean;
}): Promise<CheckoutOutcome> {
  if (!args.accessToken) throw new Error("Sign in to choose a plan.");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${args.accessToken}` },
    body: JSON.stringify({
      plan: args.plan,
      interval: args.interval ?? "monthly",
      seats: args.seats,
      withCard: args.withCard,
      // Desktop (tauri://) can't be a Stripe return target; the server falls back to its own origin.
      ...(typeof window !== "undefined" && window.location.protocol.startsWith("http")
        ? {
            successUrl: `${window.location.origin}/?upgrade=success`,
            cancelUrl: `${window.location.origin}/?upgrade=cancelled`,
          }
        : {}),
    }),
  });
  const payload = (await res.json().catch(() => null)) as {
    url?: string;
    switched?: boolean;
    error?: string;
  } | null;
  if (!res.ok || payload?.error) throw new Error(payload?.error ?? "Couldn't start checkout.");
  if (payload?.switched) return "switched";
  if (!payload?.url) throw new Error("Checkout didn't return a link. Please try again.");
  await openStripeUrl(payload.url);
  return "redirected";
}

/** Extends a card-holding trial to 30 days. Safe to call any time; the server validates. */
export async function extendTrialIfEligible(accessToken: string | null): Promise<void> {
  if (!accessToken) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/extend-trial`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.warn("[billing] extend-trial failed (non-fatal):", err);
  }
}

/** First sign-in starts the no-card Pro trial. Idempotent server-side; founders are skipped. */
export async function ensureTrial(accessToken: string | null): Promise<void> {
  if (!accessToken) return;
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/start-trial`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    console.warn("[billing] start-trial failed (non-fatal):", err);
  }
}
