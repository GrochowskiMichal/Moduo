import { Navigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { AppChrome } from "../../components/app/app-chrome";
import { ensureTrial, extendTrialIfEligible } from "../../features/billing/checkout";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace, WorkspaceProvider } from "../../providers/workspace-provider";

function WorkspaceGate() {
  const { loading, workspaces } = useWorkspace();

  if (loading) return null;
  if (workspaces.length === 0) return <Navigate to="/onboarding" replace />;

  return <AppChrome profileInitial="M" />;
}

/**
 * Billing bootstrap for a signed-in user. Not a wall: Free is a real plan, so nobody is
 * ever bounced to /paywall just for not paying. Access to the app is controlled by invites
 * (sign-ups are off) and limits by plan are enforced per feature / in the database.
 *
 *  - First sign-in on this device asks the server to start the no-card Pro trial. The server
 *    is idempotent (one trial per customer, ever) and skips founders, so this is safe to repeat.
 *  - Returning from the Stripe Billing Portal (`?billing=return`) lets the server extend a
 *    card-holding trial to 30 days.
 * The resulting plan arrives via the Stripe Sync Engine; nothing here writes entitlements.
 */
function useBillingBootstrap() {
  const { isSignedIn, accessToken, userId, refreshPlanTier } = useAuth();

  useEffect(() => {
    if (!isSignedIn || !accessToken || !userId) return;
    let cancelled = false;
    const refreshSoon = () => {
      // The sync engine's webhook lands within a few seconds; re-read the plan a couple of times.
      for (const ms of [2500, 7000, 15000]) {
        setTimeout(() => {
          if (!cancelled) void refreshPlanTier();
        }, ms);
      }
    };

    const key = `moduo:trial_checked:${userId}`;
    let checked = false;
    try {
      checked = window.localStorage.getItem(key) === "1";
    } catch {
      // storage unavailable — the server call is idempotent, so just ask again
    }
    if (!checked) {
      void ensureTrial(accessToken).then(() => {
        try {
          window.localStorage.setItem(key, "1");
        } catch {
          // ignore
        }
        refreshSoon();
      });
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") === "return" || params.get("upgrade") === "success") {
      void extendTrialIfEligible(accessToken).then(refreshSoon);
      params.delete("billing");
      params.delete("upgrade");
      const qs = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    }

    return () => {
      cancelled = true;
    };
  }, [isSignedIn, accessToken, userId, refreshPlanTier]);
}

export function AppGate() {
  const { isSignedIn, loading } = useAuth();
  useBillingBootstrap();

  if (loading) return null;
  if (!isSignedIn) return <Navigate to="/auth" replace />;

  return (
    <WorkspaceProvider>
      <WorkspaceGate />
    </WorkspaceProvider>
  );
}
