import { useNavigate } from "@tanstack/react-router";
import { AppleIcon, MonitorDown } from "lucide-react";
import { useEffect } from "react";

import { EmailAuthPanel } from "@/components/auth/email-auth-panel";
import { Eyebrow } from "@/components/ui/eyebrow";
import { checkoutRedirectUrl } from "@/lib/checkout-redirect";
import { useAuth } from "@/providers/auth-provider";

function getSearchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

// ----------- Staging portal download strip -----------

const IS_STAGING_PORTAL = (import.meta.env.PUBLIC_STAGING_PORTAL as string | undefined) === "true";

const STAGING_RELEASE_BASE =
  "https://github.com/GrochowskiMichal/moduohyb/releases/download/staging-latest";

function StagingDownloadStrip() {
  return (
    <div className="mx-auto w-full max-w-[480px] px-5 pb-3 pt-0">
      <div className="rounded-xl border border-border bg-card px-5 py-4">
        <Eyebrow className="mb-3">Desktop app — staging build</Eyebrow>
        <div className="flex flex-wrap gap-2">
          <a
            href={`${STAGING_RELEASE_BASE}/Moduo_universal.dmg`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <AppleIcon className="h-3.5 w-3.5 shrink-0" />
            Download for Mac (.dmg)
          </a>
          <a
            href={`${STAGING_RELEASE_BASE}/Moduo_x64-setup.exe`}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MonitorDown className="h-3.5 w-3.5 shrink-0" />
            Download for Windows (.exe)
          </a>
        </div>
      </div>
    </div>
  );
}

// ----------- Auth page -----------

export function AuthPage() {
  const { isSignedIn, loading, accessToken } = useAuth();
  const navigate = useNavigate();

  const priceId = getSearchParam("price_id");

  useEffect(() => {
    if (loading || !isSignedIn) return;
    if (window.sessionStorage.getItem("moduo:auth_resolving") === "1") return;

    const pendingPriceId = priceId ?? window.localStorage.getItem("moduo:pending_price_id");
    if (pendingPriceId) {
      window.localStorage.removeItem("moduo:pending_price_id");
      window.location.href = checkoutRedirectUrl(pendingPriceId, accessToken);
      return;
    }

    // Resume a workspace invite the user opened while signed out (DF-24).
    const pendingJoin = window.localStorage.getItem("moduo:pending_join");
    if (pendingJoin) {
      window.localStorage.removeItem("moduo:pending_join");
      void navigate({ to: "/join", search: { invite: pendingJoin }, replace: true });
      return;
    }

    void navigate({ to: "/", replace: true });
  }, [isSignedIn, loading, navigate, priceId, accessToken]);

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

        <div className="w-full rounded-xl border border-border bg-card px-6 py-7 shadow-xl sm:px-7 sm:py-8">
          <EmailAuthPanel priceId={priceId} />
        </div>

        {IS_STAGING_PORTAL && <StagingDownloadStrip />}
      </div>
    </div>
  );
}
