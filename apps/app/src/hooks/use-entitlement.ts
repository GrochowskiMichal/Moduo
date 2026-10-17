/**
 * useEntitlement — checks whether the current user's plan grants access to
 * a given feature gate.
 *
 * Usage:
 *   const { allowed, planTier, upgrade } = useEntitlement("cloud_sync");
 *   if (!allowed) return <UpgradePrompt onUpgrade={upgrade} />;
 *
 * Feature gates are defined in FEATURE_GATES below. The plan itself is resolved
 * server-side (Stripe Sync Engine → profiles.plan_tier); this hook only reads it.
 * RLS enforces the hard limits (workspaces, seats) — this is the friendly UI layer.
 */

import { normalizePlanTier } from "@contracts/vocabularies";
import { useCallback } from "react";
import { startCheckout } from "../features/billing/checkout";
import { type PaidPlan, tierRank } from "../features/billing/plans";
import { isDesktopShell, openStripeUrl } from "../features/billing/stripe-url";
import { type PlanTier, useAuth } from "../providers/auth-provider";

export { isDesktopShell, openStripeUrl };

export type FeatureGate =
  | "cloud_sync"
  | "unlimited_workspaces"
  | "team_members"
  | "shared_workspaces"
  | "priority_support"
  | "api_access"
  | "advanced_analytics"
  | "custom_domain";

/** Minimum tier required to access each feature gate (landing comparison table). */
const FEATURE_GATES: Record<FeatureGate, PlanTier> = {
  cloud_sync: "pro",
  unlimited_workspaces: "pro",
  priority_support: "pro",
  api_access: "pro",
  advanced_analytics: "pro",
  shared_workspaces: "duo",
  team_members: "duo",
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

export function useEntitlement(feature: FeatureGate): EntitlementResult {
  const { planTier, accessToken } = useAuth();
  const tier = normalizePlanTier(planTier);
  const requiredTier = FEATURE_GATES[feature];
  const allowed = tierRank(tier) >= tierRank(requiredTier);

  const upgrade = useCallback(() => {
    const plan: PaidPlan =
      requiredTier === "team" ? "team" : requiredTier === "duo" ? "duo" : "pro";
    void startCheckout({ accessToken, plan }).catch((err) => {
      console.error("[useEntitlement] checkout failed:", err);
      void openStripeUrl("https://moduo.app/#pricing");
    });
  }, [accessToken, requiredTier]);

  return { allowed, planTier: tier, requiredTier, upgrade };
}
