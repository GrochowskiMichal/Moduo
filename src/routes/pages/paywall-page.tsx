import { Check } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ModuoMark } from "@/components/ui/moduo-mark";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { supabaseClient } from "@/lib/runtime.web";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

const SUPABASE_URL =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
  "https://wtoonrvuqumihpkbvwvs.supabase.co";

type BillingCycle = "monthly" | "yearly";

const FREE_FEATURES = [
  "Notes, tasks, calendar & contacts",
  "Access on web & desktop",
  "Cloud sync across devices",
  "7-day Pro trial, no card required",
];

const PRO_FEATURES = [
  "Cloud sync across all devices",
  "Unlimited notes & tasks",
  "7-day free trial, no card required",
  "Priority support",
];

const TEAM_FEATURES = [
  "Everything in Pro",
  "Invite team members",
  "Shared workspaces",
  "Admin controls",
];

/**
 * Plan selection after a trial ends. Monochrome by design (the `preWorkspace()`
 * route wrapper pins `data-accent="mono"`): Pro is emphasised through HIERARCHY —
 * a heavier border, elevation, a neutral "Most popular" badge, and the surface's
 * single solid `bg-primary` CTA against outline CTAs — never a brand hue. That
 * keeps DESIGN_RULES R5 ("one primary action per surface") intact and stops the
 * page reading like a different product from the rest of the app.
 */
export function PaywallPage() {
  const { accessToken } = useAuth();
  const [billing, setBilling] = useState<BillingCycle>("monthly");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const redirectToCheckout = async (plan: "pro" | "team", planName: string) => {
    if (!accessToken) {
      window.location.href = "/auth";
      return;
    }
    setBusy(planName);
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout-session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          plan,
          interval: billing === "yearly" ? "yearly" : "monthly",
          successUrl: `${window.location.origin}/?upgrade=success`,
          cancelUrl: `${window.location.origin}/paywall`,
        }),
      });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload?.error ?? payload?.message ?? "Checkout failed.");
      if (payload?.error) throw new Error(payload.error);
      if (!payload?.url) throw new Error("Checkout didn't return a URL. Please try again.");
      // Navigating away — deliberately do NOT clear `busy`. Clearing it here
      // re-enables the CTA while the browser is still loading Stripe, which let
      // a second create-checkout-session fire.
      window.location.href = payload.url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
      setBusy(null);
    }
  };

  const startFreeTrial = async () => {
    if (!accessToken) {
      window.location.href = "/auth";
      return;
    }
    setBusy("trial");
    setError(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/start-trial`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      // Poll user_entitlements until subscription_status is trialing/active
      // (the edge function writes directly, but we wait to confirm before
      // redirecting to avoid a redirect loop back to /paywall).
      const MAX_POLLS = 12;
      const POLL_INTERVAL_MS = 800;
      let confirmed = false;
      for (let i = 0; i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        // supabase-js reports auth/RLS failures via `error`, not by throwing
        // (gotchas §Supabase). Swallowing it made a 401 look like "not written
        // yet" — 10s of polling, then a redirect that the gate bounces straight
        // back to /paywall, the exact loop this poll exists to prevent.
        const { data: row, error: pollError } = await supabaseClient
          .from("user_entitlements")
          .select("subscription_status")
          .limit(1)
          .maybeSingle<{ subscription_status: string }>();
        if (pollError) throw pollError;
        const status = row?.subscription_status;
        if (status === "trialing" || status === "active") {
          confirmed = true;
          break;
        }
      }

      if (!confirmed) {
        console.warn(
          "[paywall] trial created but subscription_status not yet reflected — redirecting anyway",
        );
      }

      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start trial. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const proPrice = billing === "monthly" ? "$10" : "$8";
  const teamPrice = billing === "monthly" ? "$9" : "$7";

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute left-1/2 top-[-260px] h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-foreground/5 blur-3xl" />

      <div className="relative mx-auto w-full max-w-[1000px] px-5 py-14 sm:py-16">
        <header className="flex flex-col items-center text-center">
          <ModuoMark className="mb-6 size-8 opacity-95" aria-hidden="true" />
          <p className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
            Your trial has ended
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
            Choose your plan to continue
          </h1>
          <p className="mx-auto mt-3 max-w-[460px] text-sm leading-6 text-muted-foreground">
            All plans include a 7-day free trial. No credit card required to start.
          </p>

          <div className="mt-7 flex flex-col items-center gap-2">
            <SegmentedControl
              aria-label="Billing period"
              value={billing}
              onValueChange={(v) => {
                setBilling(v as BillingCycle);
                setError(null);
              }}
              items={[
                { value: "monthly", label: "Monthly" },
                { value: "yearly", label: "Yearly" },
              ]}
            />
            <p className="text-xs text-muted-foreground">Yearly billing saves 20%.</p>
          </div>
        </header>

        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <PlanCard
            name="Free"
            price="$0"
            caption="Web & desktop"
            features={FREE_FEATURES}
            action={
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                onClick={() => window.open("https://moduo.app/download", "_blank")}
              >
                Download desktop app
              </Button>
            }
          />

          <PlanCard
            name="Pro"
            price={proPrice}
            priceSuffix="/mo"
            caption={
              billing === "yearly" ? "billed as $96/yr · 7-day free trial" : "7-day free trial"
            }
            features={PRO_FEATURES}
            featured
            badge="Most popular"
            action={
              <Button
                size="lg"
                className="w-full"
                aria-label="Start free trial on Pro"
                disabled={busy !== null}
                onClick={() => void redirectToCheckout("pro", "Pro")}
              >
                {busy === "Pro" ? "Redirecting…" : "Start free trial"}
              </Button>
            }
          />

          <PlanCard
            name="Team"
            price={teamPrice}
            priceSuffix="/seat/mo"
            caption="7-day free trial"
            features={TEAM_FEATURES}
            action={
              <Button
                variant="outline"
                size="lg"
                className="w-full"
                aria-label="Start free trial on Team"
                disabled={busy !== null}
                onClick={() => void redirectToCheckout("team", "Team")}
              >
                {busy === "Team" ? "Redirecting…" : "Start free trial"}
              </Button>
            }
          />
        </div>

        <div className="mt-8 text-center">
          <Button
            variant="link"
            size="sm"
            className="text-muted-foreground underline hover:text-foreground"
            disabled={busy !== null}
            onClick={() => void startFreeTrial()}
          >
            {busy === "trial" ? "Setting up your trial…" : "Start a no-card 7-day trial on Pro"}
          </Button>
        </div>

        {error ? (
          <div
            role="alert"
            className="mx-auto mt-6 max-w-[480px] rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3"
          >
            <p className="text-center text-sm leading-5 text-destructive">{error}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One plan column. `featured` carries the emphasis budget — a heavier border and
 * elevation — while the caller supplies the only solid CTA on the page.
 */
function PlanCard({
  name,
  price,
  priceSuffix,
  caption,
  features,
  action,
  featured = false,
  badge,
}: {
  name: string;
  price: string;
  priceSuffix?: string;
  caption: string;
  features: readonly string[];
  action: ReactNode;
  featured?: boolean;
  badge?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-lg border bg-card p-6 sm:p-7",
        featured ? "border-foreground/25 shadow-lg" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
          {name}
        </h2>
        {badge ? (
          <Badge variant="secondary" className="font-normal">
            {badge}
          </Badge>
        ) : null}
      </div>

      <p className="mt-3 font-display text-4xl font-semibold tracking-tight text-foreground tabular-nums">
        {price}
        {priceSuffix ? (
          <span className="ml-0.5 text-base font-medium text-muted-foreground">{priceSuffix}</span>
        ) : null}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{caption}</p>

      <ul className="mt-6 flex flex-1 flex-col gap-3">
        {features.map((feature) => (
          <li key={feature} className="flex items-start gap-3">
            <span
              className={cn(
                "mt-0.5 grid size-5 shrink-0 place-items-center rounded-full",
                featured ? "bg-foreground/15 text-foreground" : "bg-muted text-muted-foreground",
              )}
            >
              <Check className="size-3" aria-hidden />
            </span>
            <span className="text-sm leading-5 text-muted-foreground">{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-7">{action}</div>
    </section>
  );
}
