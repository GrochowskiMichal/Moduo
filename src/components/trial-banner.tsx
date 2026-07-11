import { useEffect, useState } from "react";
import { Clock, X } from "lucide-react";

import type { EntitlementsRow } from "../features/settings/billing";
import { dispatchOpenSettings } from "../features/settings/settings-events";
import { supabaseClient } from "../lib/runtime.web";
import { useAuth } from "../providers/auth-provider";
import { Button } from "./ui/button";

/**
 * TrialBanner — shown inside AppChrome for users on a trialing subscription.
 * Reads the user_entitlements view (via the shared supabaseClient, which
 * carries the session + real anon key) to surface remaining trial days plus
 * a CTA into Settings → Billing, where a card extends the trial to 30 days.
 *
 * Surface uses status tokens (bg-warning for normal trial, bg-destructive for
 * the urgent <= 2 day window) instead of hardcoded amber/red. Dismissible per
 * browser session via sessionStorage.
 */

type Entitlements = Pick<EntitlementsRow, "subscription_status" | "trial_days_remaining">;

const DISMISSED_KEY = "moduo:trial_banner_dismissed";

export function TrialBanner() {
  const { accessToken, isSignedIn } = useAuth();

  const [entitlements, setEntitlements] = useState<Entitlements | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.sessionStorage.getItem(DISMISSED_KEY) === "1";
  });

  useEffect(() => {
    if (!isSignedIn || !accessToken) return;

    let cancelled = false;

    const run = async () => {
      try {
        const { data, error } = await supabaseClient
          .from("user_entitlements")
          .select("subscription_status,trial_days_remaining")
          .limit(1)
          .maybeSingle<Entitlements>();
        if (error) {
          console.warn("[trial-banner] entitlements read failed:", error.message);
          return;
        }
        if (!cancelled && data) setEntitlements(data);
      } catch (err) {
        console.warn("[trial-banner] entitlements read failed:", err);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, accessToken]);

  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(DISMISSED_KEY, "1");
    }
    setDismissed(true);
  };

  const handleCta = () => {
    dispatchOpenSettings({ section: "billing" });
  };

  if (
    dismissed ||
    !entitlements ||
    entitlements.subscription_status !== "trialing" ||
    entitlements.trial_days_remaining === null
  ) {
    return null;
  }

  const days = Math.ceil(entitlements.trial_days_remaining);
  const isUrgent = days <= 2;

  const wrapperClass = isUrgent
    ? "flex flex-row items-center gap-3 bg-destructive/15 text-destructive border-b border-destructive/30 px-5 py-2 text-xs"
    : "flex flex-row items-center gap-3 bg-warning/15 text-warning border-b border-warning/30 px-5 py-2 text-xs";

  return (
    <div role="status" className={wrapperClass}>
      <Clock className="size-3.5 shrink-0" aria-hidden />
      <p className="min-w-0 flex-1 truncate">
        {days <= 0
          ? "Your trial has expired."
          : `${days} day${days === 1 ? "" : "s"} left in your trial.`}{" "}
        <button
          type="button"
          onClick={handleCta}
          className="font-medium underline underline-offset-2 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        >
          Add a card to extend to 30 days →
        </button>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={handleDismiss}
        aria-label="Dismiss trial banner"
        className="shrink-0 text-current hover:bg-current/10 hover:text-current"
      >
        <X className="size-3.5" aria-hidden />
      </Button>
    </div>
  );
}
