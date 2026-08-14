import { CreditCard } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { isDesktopShell, openStripeUrl } from "../../../hooks/use-entitlement";
import { SUPABASE_URL, supabaseClient } from "../../../lib/runtime.web";
import { useAuth } from "../../../providers/auth-provider";
import {
  ENTITLEMENTS_COLUMNS,
  type EntitlementsRow,
  isTrialing,
  planLabel,
  subscriptionLine,
} from "../billing";
import { SettingsSectionShell } from "./section-shell";

type LoadState = "loading" | "loaded" | "error";

/**
 * BillingSection — minimal by design (ratified 2026-07-10): plan + trial
 * state + one "Manage billing" button that opens Stripe's hosted customer
 * portal. No in-app card UI. DF-19 (Settings overhaul) refines this later.
 */
export function BillingSection() {
  const { isSignedIn, accessToken, planTier } = useAuth();

  const [row, setRow] = useState<EntitlementsRow | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [portalBusy, setPortalBusy] = useState(false);

  useEffect(() => {
    if (!isSignedIn || !accessToken) {
      setLoadState("loaded");
      return;
    }
    let cancelled = false;

    const run = async () => {
      try {
        const { data, error } = await supabaseClient
          .from("user_entitlements")
          .select(ENTITLEMENTS_COLUMNS)
          .limit(1)
          .maybeSingle<EntitlementsRow>();
        if (cancelled) return;
        if (error) {
          // A read failure must not present as "No subscription" to a payer.
          console.warn("[billing] entitlements read failed:", error.message);
          setLoadState("error");
          return;
        }
        setRow(data ?? null);
        setLoadState("loaded");
      } catch (err) {
        console.warn("[billing] entitlements read failed:", err);
        if (!cancelled) setLoadState("error");
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isSignedIn, accessToken]);

  // Web navigates same-tab to the portal; a Back-button return can restore
  // this page from the bfcache with state intact — re-enable the button.
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setPortalBusy(false);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  const handleManageBilling = async () => {
    if (!accessToken || portalBusy) return;
    setPortalBusy(true);
    try {
      // Desktop omits returnUrl: window.location.origin is tauri://localhost
      // there, which Stripe rejects — the edge function falls back to APP_URL.
      const body = isDesktopShell() ? {} : { returnUrl: window.location.origin };
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-portal-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(body),
      });
      const payload = (await res.json().catch(() => null)) as {
        url?: string;
        error?: string;
      } | null;
      if (!res.ok || !payload?.url) {
        throw new Error(payload?.error || "Couldn't open the billing portal.");
      }

      await openStripeUrl(payload.url);
      // On desktop the portal opened in the system browser and the app stays
      // up; on web we're navigating away and the reset is harmless.
      if (isDesktopShell()) setPortalBusy(false);
    } catch (err) {
      console.warn("[billing] portal session failed:", err);
      toast.error(err instanceof Error ? err.message : "Couldn't open the billing portal.");
      setPortalBusy(false);
    }
  };

  const tier = row?.plan_tier ?? planTier;
  const statusLine =
    loadState === "loading"
      ? "Checking subscription…"
      : loadState === "error"
        ? "Couldn't check your subscription — try again shortly."
        : subscriptionLine(row);

  return (
    <SettingsSectionShell
      title="Billing"
      description="Your plan, trial status, and payment details."
    >
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-card p-6">
        <div className="flex flex-row items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <Eyebrow>Current plan</Eyebrow>
            <span className="font-display text-lg text-foreground">{planLabel(tier)}</span>
            <p className="text-sm text-muted-foreground">{statusLine}</p>
          </div>
          <Button
            type="button"
            onClick={() => void handleManageBilling()}
            disabled={!accessToken || portalBusy}
          >
            <CreditCard aria-hidden />
            {portalBusy ? "Opening…" : "Manage billing"}
          </Button>
        </div>

        {loadState === "loaded" && isTrialing(row) ? (
          <p className="border-t border-border pt-4 text-sm text-muted-foreground">
            Add a card in the billing portal to extend your trial to{" "}
            <span className="font-medium text-foreground">30 days total</span>.
          </p>
        ) : null}

        <p className="text-xs text-muted-foreground">
          Payments are handled by Stripe. Manage billing opens Stripe&apos;s secure portal to update
          your card, change plans, or download invoices.
        </p>
      </section>
    </SettingsSectionShell>
  );
}
