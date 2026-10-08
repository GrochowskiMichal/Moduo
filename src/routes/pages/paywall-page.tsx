import { normalizePlanTier } from "@contracts/vocabularies";
import { Check } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { ModuoMark } from "@/components/ui/moduo-mark";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { ensureTrial, startCheckout } from "@/features/billing/checkout";
import {
  type BillingInterval,
  type PaidPlan,
  PLAN_CARDS,
  type PlanCard as PlanCardModel,
  priceFor,
  TEAM_MIN_SEATS,
  TRIAL_DAYS_NO_CARD,
  TRIAL_DAYS_WITH_CARD,
} from "@/features/billing/plans";
import { supabaseClient } from "@/lib/runtime.web";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

/**
 * Plans. Same four plans, prices and wording as the landing (src/features/billing/plans.ts).
 * Free is a real tier — this page is a destination (trial banner, upgrade prompts, Settings),
 * never a wall. Monochrome by design (the `preWorkspace()` wrapper pins `data-accent="mono"`):
 * the user's best next step carries the single solid CTA; the rest are outline.
 */
export function PaywallPage() {
  const { accessToken, userId, planTier } = useAuth();
  const current = normalizePlanTier(planTier);
  const isFounder = current === "founder";

  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [seats, setSeats] = useState(TEAM_MIN_SEATS);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null until known. A Stripe customer means they've already had their one trial.
  const [hadTrial, setHadTrial] = useState<boolean | null>(null);

  useEffect(() => {
    if (!userId) return;
    void supabaseClient
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", userId)
      .maybeSingle<{ stripe_customer_id: string | null }>()
      .then(({ data }) => setHadTrial(!!data?.stripe_customer_id));
  }, [userId]);

  const choose = async (plan: PaidPlan, opts?: { withCard?: boolean }) => {
    if (!accessToken) {
      window.location.href = "/auth";
      return;
    }
    setBusy(opts?.withCard ? `${plan}-card` : plan);
    setError(null);
    try {
      const outcome = await startCheckout({
        accessToken,
        plan,
        interval,
        seats: plan === "team" ? seats : undefined,
        withCard: opts?.withCard,
      });
      // Redirected: leave `busy` set so the CTA can't fire a second session while Stripe loads.
      if (outcome === "switched") window.location.href = "/?upgrade=success";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
      setBusy(null);
    }
  };

  const startNoCardTrial = async () => {
    setBusy("trial");
    setError(null);
    await ensureTrial(accessToken);
    // The plan lands via the Stripe Sync Engine a moment later — wait for it before leaving.
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const { data } = await supabaseClient
        .from("user_entitlements")
        .select("has_access,plan_tier")
        .maybeSingle<{ has_access: boolean | null; plan_tier: string | null }>();
      if (data?.has_access && data.plan_tier !== "free") break;
    }
    window.location.href = "/";
  };

  const heading =
    isFounder || current !== "free"
      ? { eyebrow: "Your plan", title: "Plans" }
      : hadTrial
        ? { eyebrow: "Your trial has ended", title: "Choose your plan to continue" }
        : { eyebrow: "Welcome to Moduo", title: "Choose your plan" };

  const ctaFor = (card: PlanCardModel): ReactNode => {
    if (card.id === "free") {
      return (
        <Button
          variant="outline"
          size="lg"
          className="w-full"
          disabled={busy !== null}
          onClick={() => {
            window.location.href = "/";
          }}
        >
          {current === "free" ? "Continue with Free" : "Back to Moduo"}
        </Button>
      );
    }
    const plan = card.id as PaidPlan;
    const isCurrent = current === card.id;
    const label = isCurrent
      ? "Current plan"
      : hadTrial !== true && current === "free"
        ? "Start free trial"
        : `Choose ${card.name}`;
    return (
      <Button
        size="lg"
        variant={card.id === "duo" ? "default" : "outline"}
        className="w-full"
        aria-label={`${label} — ${card.name}`}
        disabled={busy !== null || isCurrent || isFounder}
        onClick={() => void choose(plan)}
      >
        {busy === plan ? "Redirecting…" : label}
      </Button>
    );
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute left-1/2 top-[-260px] h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-foreground/5 blur-3xl" />

      <div className="relative mx-auto w-full max-w-[1180px] px-5 py-14 sm:py-16">
        <header className="flex flex-col items-center text-center">
          <ModuoMark className="mb-6 size-8 opacity-95" aria-hidden="true" />
          <Eyebrow as="p">{heading.eyebrow}</Eyebrow>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
            {heading.title}
          </h1>
          <p className="mx-auto mt-3 max-w-[480px] text-sm leading-6 text-muted-foreground">
            Start free. Try Pro for {TRIAL_DAYS_NO_CARD} days with no card, or{" "}
            {TRIAL_DAYS_WITH_CARD} days with one. Early members keep the founding price.
          </p>

          <div className="mt-7 flex flex-col items-center gap-2">
            <SegmentedControl
              aria-label="Billing period"
              value={interval}
              onValueChange={(v) => {
                setInterval(v as BillingInterval);
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

        {isFounder ? (
          <p className="mx-auto mt-8 max-w-[480px] rounded-md border border-border bg-card px-4 py-3 text-center text-sm text-foreground">
            You&apos;re a Founder — everything is included, no plan needed.
          </p>
        ) : null}

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_CARDS.map((card) => (
            <PlanCard
              key={card.id}
              name={card.name}
              price={`$${priceFor(card, interval)}`}
              priceSuffix={card.suffix}
              caption={card.audience(interval)}
              features={card.features}
              featured={card.id === "duo"}
              badge={current === card.id ? "Current" : card.badge}
              note={card.founding}
              action={
                <div className="flex flex-col gap-3">
                  {card.id === "team" && current !== "team" && !isFounder ? (
                    <label className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
                      Seats
                      <input
                        type="number"
                        min={TEAM_MIN_SEATS}
                        max={500}
                        value={seats}
                        onChange={(e) =>
                          setSeats(
                            Math.max(
                              TEAM_MIN_SEATS,
                              Math.floor(Number(e.target.value)) || TEAM_MIN_SEATS,
                            ),
                          )
                        }
                        className="h-9 w-20 rounded-md border border-input bg-background px-2 text-right text-foreground"
                        aria-label="Number of seats (minimum 3)"
                      />
                    </label>
                  ) : null}
                  {ctaFor(card)}
                </div>
              }
            />
          ))}
        </div>

        {current === "free" && hadTrial === false ? (
          <div className="mt-8 flex flex-col items-center gap-1 text-center">
            <Button
              variant="link"
              size="sm"
              className="text-muted-foreground underline hover:text-foreground"
              disabled={busy !== null}
              onClick={() => void startNoCardTrial()}
            >
              {busy === "trial"
                ? "Setting up your trial…"
                : `Start a ${TRIAL_DAYS_NO_CARD}-day Pro trial, no card`}
            </Button>
            <Button
              variant="link"
              size="sm"
              className="text-muted-foreground underline hover:text-foreground"
              disabled={busy !== null}
              onClick={() => void choose("pro", { withCard: true })}
            >
              {busy === "pro-card"
                ? "Redirecting…"
                : `Add a card for ${TRIAL_DAYS_WITH_CARD} days instead`}
            </Button>
          </div>
        ) : null}

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
  note,
}: {
  name: string;
  price: string;
  priceSuffix?: string;
  caption: string;
  features: readonly string[];
  action: ReactNode;
  featured?: boolean;
  badge?: string;
  note?: string;
}) {
  return (
    <section
      className={cn(
        "flex flex-col rounded-lg border bg-card p-6 sm:p-7",
        featured ? "border-foreground/25 shadow-lg" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <Eyebrow as="h2">{name}</Eyebrow>
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

      {note ? <p className="mt-5 text-sm leading-5 text-foreground">{note}</p> : null}

      <div className="mt-6">{action}</div>
    </section>
  );
}
