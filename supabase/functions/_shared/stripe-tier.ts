/**
 * Stripe price → plan_tier mapping for billing edge functions.
 * Write paths validate against the shared contract before touching profiles.
 */

import {
  parsePlanTier,
  type PlanTier,
} from "./contracts/vocabularies.ts";

/** Higher rank wins when a customer has multiple active subscriptions. */
export const TIER_RANK: Record<PlanTier, number> = {
  free: 0,
  pro: 1,
  founder: 2,
  team: 3,
};

/** Build the env-driven Stripe price → tier map (canonical `founder`, never `founders`). */
export function buildPriceToTier(fallbackFoundersPrice = ""): Record<string, PlanTier> {
  return {
    [Deno.env.get("STRIPE_PRICE_PRO_MONTHLY") ?? "price_pro_monthly"]: "pro",
    [Deno.env.get("STRIPE_PRICE_PRO_YEARLY") ?? "price_pro_yearly"]: "pro",
    [Deno.env.get("STRIPE_PRICE_TEAM_MONTHLY") ?? "price_team_monthly"]: "team",
    [Deno.env.get("STRIPE_PRICE_TEAM_YEARLY") ?? "price_team_yearly"]: "team",
    [Deno.env.get("STRIPE_PRICE_FOUNDERS") ?? fallbackFoundersPrice]: "founder",
  };
}

/** Resolve a Stripe price id to a validated plan tier (least privilege on unknown). */
export function tierFromPriceId(
  priceId: string,
  priceToTier: Record<string, PlanTier>,
): PlanTier {
  const candidate = priceToTier[priceId] ?? "free";
  const parsed = parsePlanTier(candidate);
  if (!parsed.success) {
    console.warn("[stripe-tier] rejecting invalid tier candidate:", candidate);
    return "free";
  }
  return parsed.data;
}

/** Strict write-path guard — never persist a non-canonical plan_tier label. */
export function assertPlanTierForWrite(tier: unknown): PlanTier {
  const parsed = parsePlanTier(tier);
  if (!parsed.success) {
    console.warn("[stripe-tier] rejecting invalid plan_tier write:", tier);
    return "free";
  }
  return parsed.data;
}
