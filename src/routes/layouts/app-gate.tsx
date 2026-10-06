import { Navigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppChrome } from "../../components/app/app-chrome";
import { supabaseClient } from "../../lib/runtime.web";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace, WorkspaceProvider } from "../../providers/workspace-provider";

function WorkspaceGate() {
  const { loading, workspaces } = useWorkspace();

  if (loading) return null;
  if (workspaces.length === 0) return <Navigate to="/onboarding" replace />;

  return <AppChrome profileInitial="M" />;
}

/**
 * Web subscription gate: free-tier (or no subscription) web users are redirected
 * to /paywall. Desktop users always get through regardless of plan tier since they
 * can operate in local-only mode.
 */
// How long to keep re-checking if we see a fresh "none" status right after
// navigating to "/". This smooths over the Stripe Sync Engine lag on first load
// for users who just activated a trial.
const POST_TRIAL_GRACE_POLLS = 6;
const POST_TRIAL_GRACE_INTERVAL_MS = 1000;

const SUPABASE_URL =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
  "https://wtoonrvuqumihpkbvwvs.supabase.co";

const isEntitled = (status: string) => status === "trialing" || status === "active";

/** Edge-function POST that must never throw into the gate: a failure just leaves the status as-is. */
async function callEdge(name: string, token: string): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (err) {
    console.warn(`[app-gate] ${name} failed (non-fatal):`, err);
  }
}

function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { runtime, isSignedIn, accessToken, userId } = useAuth();
  const isDesktop = !!runtime?.capabilities.isDesktop;
  const isWeb = !!runtime?.capabilities.isWeb;

  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [checkDone, setCheckDone] = useState(false);

  useEffect(() => {
    if (!isWeb || !isSignedIn || !accessToken || !userId) {
      setCheckDone(true);
      return;
    }

    let cancelled = false;

    const fetchStatus = async (): Promise<string> => {
      const { data: row, error } = await supabaseClient
        .from("user_entitlements")
        .select("subscription_status")
        .limit(1)
        .maybeSingle<{ subscription_status: string }>();
      // supabase-js reports PostgREST/REST failures via `error`, not by
      // throwing — coercing them to "none" would fail CLOSED (paywall a
      // paying user on a transient 500/401). Throw into the fail-open catch.
      if (error) throw new Error(error.message);
      return row?.subscription_status ?? "none";
    };

    // Fail closed on a read error here: the worst case is one extra start-trial call,
    // which is idempotent.
    const hasStripeCustomer = async (): Promise<boolean> => {
      const { data } = await supabaseClient
        .from("profiles")
        .select("stripe_customer_id")
        .eq("id", userId)
        .maybeSingle<{ stripe_customer_id: string | null }>();
      return !!data?.stripe_customer_id;
    };

    const run = async () => {
      try {
        let status = await fetchStatus();

        // If we land here immediately after a trial was just started, the DB
        // write may not be visible yet. Retry a few times before giving up.
        if (status === "none" || status === "canceled") {
          for (let i = 0; i < POST_TRIAL_GRACE_POLLS; i++) {
            await new Promise((r) => setTimeout(r, POST_TRIAL_GRACE_INTERVAL_MS));
            if (cancelled) return;
            status = await fetchStatus();
            if (isEntitled(status)) break;
          }
        }

        // Still no entitlement: the mirror can lag or miss a Stripe trial created via
        // Checkout, so pull the truth from Stripe once and re-read.
        if (!isEntitled(status) && accessToken) {
          await callEdge("sync-subscription", accessToken);
          if (cancelled) return;
          status = await fetchStatus();
        }

        // Invited users sign in through the invite link (no OTP step), so they never hit
        // the signup auto-trial. A user who has never had a Stripe customer gets it here.
        // start-trial is idempotent.
        if (!isEntitled(status) && accessToken && !(await hasStripeCustomer())) {
          await callEdge("start-trial", accessToken);
          for (let i = 0; i < POST_TRIAL_GRACE_POLLS && !cancelled; i++) {
            status = await fetchStatus();
            if (isEntitled(status)) break;
            await new Promise((r) => setTimeout(r, POST_TRIAL_GRACE_INTERVAL_MS));
          }
        }

        if (!cancelled) setSubscriptionStatus(status);
      } catch (err) {
        // Fail open: an entitlements read error must never lock a paying user
        // out, so "unknown" passes the gate below — but it must be visible.
        console.warn(
          "[app-gate] subscription check failed — failing open (no paywall redirect):",
          err,
        );
        if (!cancelled) setSubscriptionStatus("unknown");
      } finally {
        if (!cancelled) setCheckDone(true);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [isWeb, isSignedIn, accessToken, userId]);

  // Desktop always passes through.
  if (isDesktop) return <>{children}</>;

  // Wait for the check before rendering.
  if (!checkDone) return null;

  // Redirect web users with no active/trialing subscription to the paywall.
  if (
    isWeb &&
    isSignedIn &&
    subscriptionStatus !== null &&
    subscriptionStatus !== "active" &&
    subscriptionStatus !== "trialing" &&
    subscriptionStatus !== "unknown"
  ) {
    return <Navigate to="/paywall" replace />;
  }

  return <>{children}</>;
}

export function AppGate() {
  const { isSignedIn, loading } = useAuth();

  if (loading) return null;
  if (!isSignedIn) return <Navigate to="/auth" replace />;

  return (
    <SubscriptionGate>
      <WorkspaceProvider>
        <WorkspaceGate />
      </WorkspaceProvider>
    </SubscriptionGate>
  );
}
