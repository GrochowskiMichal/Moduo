import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect } from "react";

import { EmailAuthPanel } from "@/components/auth/email-auth-panel";
import { IS_STAGING_PORTAL } from "@/features/settings/about";
import { ACCOUNT_DELETED_NOTICE } from "@/features/settings/delete-account";
import { useAuth } from "@/providers/auth-provider";

export function AuthPage() {
  const { isSignedIn, loading } = useAuth();
  const navigate = useNavigate();
  const { deleted } = useSearch({ from: "/auth" });

  useEffect(() => {
    // `deleted`: the Danger zone lands here a moment before it signs out.
    if (loading || !isSignedIn || deleted) return;
    if (window.sessionStorage.getItem("moduo:auth_resolving") === "1") return;

    // Resume a workspace invite the user opened while signed out (DF-24).
    const pendingJoin = window.localStorage.getItem("moduo:pending_join");
    if (pendingJoin) {
      window.localStorage.removeItem("moduo:pending_join");
      void navigate({ to: "/join", search: { invite: pendingJoin }, replace: true });
      return;
    }

    void navigate({ to: "/", replace: true });
  }, [isSignedIn, loading, navigate, deleted]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="rounded-xl border border-border bg-card px-5 py-3 shadow-lg">
          <p className="text-sm text-muted-foreground">Checking your session…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">
      <div className="pointer-events-none absolute left-1/2 top-[-260px] h-[520px] w-[620px] -translate-x-1/2 rounded-full bg-foreground/5 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-[480px] flex-col items-center justify-center gap-3 px-5 py-8">
        {IS_STAGING_PORTAL && (
          <div className="w-full">
            <div className="mb-1 flex items-center gap-2">
              <span className="rounded bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                STAGING
              </span>
              <span className="text-xs text-muted-foreground">
                app.staging.moduo.app · invite-only
              </span>
            </div>
          </div>
        )}

        {deleted ? (
          <div role="status" className="w-full rounded-md border border-border bg-muted px-4 py-3">
            <p className="text-sm leading-5 text-muted-foreground">{ACCOUNT_DELETED_NOTICE}</p>
          </div>
        ) : null}

        <div className="w-full rounded-xl border border-border bg-card px-6 py-7 shadow-xl sm:px-7 sm:py-8">
          <EmailAuthPanel />
        </div>
      </div>
    </div>
  );
}
