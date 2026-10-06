/**
 * The plan catalog — mirrors the landing pricing exactly (one source for the paywall,
 * upgrade modal and Settings → Billing). Prices here are display copy; what a user is
 * actually charged comes from the Stripe prices with lookup keys `<plan>_<interval>`.
 */

import type { PlanTier } from "@contracts/vocabularies";

export type PaidPlan = "pro" | "duo" | "team";
export type BillingInterval = "monthly" | "yearly";

export const TRIAL_DAYS_NO_CARD = 14;
export const TRIAL_DAYS_WITH_CARD = 30;
export const TEAM_MIN_SEATS = 3;

export type PlanCard = {
  id: PlanTier;
  name: string;
  /** Short audience line shown under the name (landing wording). */
  audience: (interval: BillingInterval) => string;
  /** Per-month price in whole dollars. */
  monthly: number;
  yearly: number;
  /** "/mo", "/mo for two", "/seat/mo". */
  suffix: string;
  features: string[];
  /** Landing "Founding price" line, when the plan has one. */
  founding?: string;
  badge?: string;
};

export const PLAN_CARDS: PlanCard[] = [
  {
    id: "free",
    name: "Free",
    audience: () => "For one person, on web and desktop",
    monthly: 0,
    yearly: 0,
    suffix: "",
    features: [
      "Tasks, notes, calendar, email and contacts, all linked",
      "1 workspace, 1 email account",
      "AI keys that can read",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    audience: (i) => (i === "yearly" ? "Billed $120 a year" : "Billed monthly"),
    monthly: 12,
    yearly: 10,
    suffix: "/mo",
    features: [
      "Everything in Free",
      "Unlimited workspaces and email accounts",
      "AI keys that can edit",
      "Full history, more storage, priority support",
    ],
    founding: "Founding price $8/mo",
  },
  {
    id: "duo",
    name: "Duo",
    audience: (i) =>
      i === "yearly" ? "For two people · billed $192 a year" : "For two people · billed monthly",
    monthly: 20,
    yearly: 16,
    suffix: "/mo for two",
    features: [
      "Pro for both of you",
      "Shared workspaces",
      "Assign tasks and mention each other",
      "Chat and calls",
    ],
    founding: "Founding price $13/mo",
    badge: "New",
  },
  {
    id: "team",
    name: "Team",
    audience: (i) => (i === "yearly" ? "Per seat · billed yearly" : "Per seat · billed monthly"),
    monthly: 15,
    yearly: 12,
    suffix: "/seat/mo",
    features: [
      "Everything in Duo",
      "Three seats or more",
      "Roles, permissions and guests",
      "Admin controls",
    ],
    founding: "Founding price $10/seat for the first year",
  },
];

export function planCard(tier: PlanTier): PlanCard | null {
  return PLAN_CARDS.find((c) => c.id === tier) ?? null;
}

/** Higher outranks lower; Founder is everything. Mirrors public.plan_tier_rank in the DB. */
export const TIER_RANK: Record<PlanTier, number> = { free: 0, pro: 1, duo: 2, team: 3, founder: 4 };

export function tierRank(tier: PlanTier): number {
  return TIER_RANK[tier];
}

export function priceFor(card: PlanCard, interval: BillingInterval): number {
  return interval === "yearly" ? card.yearly : card.monthly;
}
