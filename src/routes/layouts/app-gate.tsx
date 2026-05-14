import { useEffect, useState } from "react";
import { Navigate } from "@tanstack/react-router";
import { useAuth } from "../../providers/auth-provider";
import { WorkspaceProvider, useWorkspace } from "../../providers/workspace-provider";
import { AppChrome } from "../../components/app/app-chrome";
import { useSlotBookingsSync } from "../../features/plan/hooks/use-slot-bookings-sync";
import { supabaseClient } from "../../lib/runtime.web";

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

function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const { runtime, isSignedIn, accessToken } = useAuth();
  const isDesktop = !!runtime?.capabilities.isDesktop;
  const isWeb = !!runtime?.capabilities.isWeb;

  const [subscriptionStatus, setSubscriptionStatus] = useState<string | null>(null);
  const [checkDone, setCheckDone] = useState(false);

  useEffect(() => {
    if (!isWeb || !isSignedIn || !accessToken) {
      setCheckDone(true);
      return;
    }

    let cancelled = false;

    const fetchStatus = async (): Promise<string> => {
      const { data: row } = await supabaseClient
        .from("user_entitlements")
        .select("subscription_status")
        .maybeSingle<{ subscription_status: string }>();
      return row?.subscription_status ?? "none";
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
            if (status === "trialing" || status === "active") break;
          }
        }

        if (!cancelled) setSubscriptionStatus(status);
      } catch {
        if (!cancelled) setSubscriptionStatus("unknown");
      } finally {
        if (!cancelled) setCheckDone(true);
      }
    };

    void run();
    return () => { cancelled = true; };
  }, [isWeb, isSignedIn, accessToken]);

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
  useSlotBookingsSync();

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
