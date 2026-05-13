/**
 * useEntitlement — checks whether the current user's plan grants access to
 * a given feature gate.
 *
 * Usage:
 *   const { allowed, planTier, upgrade } = useEntitlement("cloud_sync");
 *   if (!allowed) return <UpgradePrompt onUpgrade={upgrade} />;
 *
 * Feature gates are defined in FEATURE_GATES below.  Add new gates here as
 * the product grows; components only need to call useEntitlement(featureName).
 */

import { useCallback } from "react";
import { useAuth, type PlanTier } from "../providers/auth-provider";
import { getRuntime } from "../lib/runtime";

export type FeatureGate =
  | "cloud_sync"
  | "unlimited_workspaces"
  | "team_members"
  | "priority_support"
  | "api_access"
  | "advanced_analytics"
  | "custom_domain";

const TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  pro: 1,
  founders: 2,
  team: 3,
};

/** Minimum tier required to access each feature gate. */
const FEATURE_GATES: Record<FeatureGate, PlanTier> = {
  cloud_sync: "pro",
  unlimited_workspaces: "pro",
  team_members: "team",
  priority_support: "pro",
  api_access: "pro",
  advanced_analytics: "pro",
  custom_domain: "team",
};

export type EntitlementResult = {
  /** Whether the current plan allows this feature. */
  allowed: boolean;
  /** The user's current plan tier. */
  planTier: PlanTier;
  /** The minimum tier required for this feature. */
  requiredTier: PlanTier;
  /** Call this to open the upgrade/checkout flow. */
  upgrade: () => void;
};

/**
 * Opens a Stripe URL. On Tauri desktop, opens in the system browser.
 * On web, navigates the current tab (same-tab for checkout flow).
 */
async function openStripeUrl(url: string) {
  const rt = getRuntime();
  if (rt?.capabilities.isDesktop) {
    await rt.window.openExternalUrl(url);
  } else {
    window.location.href = url;
  }
}

/**
 * Opens Stripe Checkout via `create-checkout-session` using plan + interval
 * so the edge function resolves price IDs from Supabase secrets (not client env).
 */
async function redirectToCheckout(
  accessToken: string | null,
  tier: "pro" | "team"
) {
  const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ??
    "https://wtoonrvuqumihpkbvwvs.supabase.co";

  if (!accessToken) {
    await openStripeUrl("https://moduo.app/#pricing");
    return;
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        plan: tier,
        interval: "monthly",
        successUrl: `${window.location.origin}/?upgrade=success`,
        cancelUrl: `${window.location.origin}/?upgrade=cancelled`,
      }),
    });
    const { url, error } = await res.json();
    if (error) throw new Error(error);
    if (url) await openStripeUrl(url);
  } catch (err) {
    console.error("[useEntitlement] checkout redirect failed:", err);
    await openStripeUrl("https://moduo.app/#pricing");
  }
}

export function useEntitlement(feature: FeatureGate): EntitlementResult {
  const { planTier, accessToken } = useAuth();
  const requiredTier = FEATURE_GATES[feature];
  const allowed = TIER_RANK[planTier] >= TIER_RANK[requiredTier];

  const upgrade = useCallback(() => {
    const targetTier = requiredTier === "team" ? "team" : "pro";
    void redirectToCheckout(accessToken, targetTier);
  }, [accessToken, requiredTier]);

  return { allowed, planTier, requiredTier, upgrade };
}
