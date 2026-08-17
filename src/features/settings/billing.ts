/**
 * Pure display logic for the Settings → Billing section.
 *
 * The section reads the `user_entitlements` view (Stripe-synced) and renders
 * a one-line subscription state. Kept free of React/IO so it's unit-testable;
 * DF-19 (Settings overhaul) will grow this into the section's real model.
 */

import { normalizePlanTier } from "@contracts/vocabularies";

export type EntitlementsRow = {
  plan_tier: string | null;
  subscription_status: string | null;
  trial_days_remaining: number | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

export const ENTITLEMENTS_COLUMNS =
  "plan_tier,subscription_status,trial_days_remaining,trial_ends_at,current_period_end";

export function planLabel(tier: string | null | undefined): string {
  switch (normalizePlanTier(tier)) {
    case "pro":
      return "Pro";
    case "team":
      return "Team";
    case "founder":
      return "Founders";
    default:
      return "Free";
  }
}

// en-US pinned: the section's copy is English at alpha, and pinning keeps the
// unit tests machine-locale-independent. Module-level so the formatter is
// constructed once, not per render.
const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return DATE_FMT.format(date);
}

export function isTrialing(row: EntitlementsRow | null): boolean {
  return row?.subscription_status === "trialing";
}

/** One-line subscription state rendered under the plan name. */
export function subscriptionLine(row: EntitlementsRow | null): string {
  const status = row?.subscription_status;
  if (!row || !status || status === "none") return "No subscription";

  switch (status) {
    case "trialing": {
      const days =
        row.trial_days_remaining === null ? null : Math.max(0, Math.ceil(row.trial_days_remaining));
      const ends = row.trial_ends_at ? formatDate(row.trial_ends_at) : null;
      if (days === null) return ends ? `Trial active (ends ${ends})` : "Trial active";
      const base =
        days <= 0 ? "Trial ends today" : `Trial — ${days} day${days === 1 ? "" : "s"} left`;
      return ends ? `${base} (ends ${ends})` : base;
    }
    case "active": {
      const renews = row.current_period_end ? formatDate(row.current_period_end) : null;
      return renews ? `Active — renews ${renews}` : "Active";
    }
    case "canceled": {
      const until = row.current_period_end ? formatDate(row.current_period_end) : null;
      return until ? `Canceled — access until ${until}` : "Canceled";
    }
    case "past_due":
      return "Payment past due";
    default:
      return status;
  }
}
