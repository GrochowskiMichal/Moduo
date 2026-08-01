import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { EmailAuthPanel } from "@/components/auth/email-auth-panel";
import { useAuth } from "@/providers/auth-provider";

function getSearchParam(key: string): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(key);
}

export function AuthPage() {
  const { isSignedIn, loading } = useAuth();
  const navigate = useNavigate();

  const priceId = getSearchParam("price_id");

  useEffect(() => {
    if (loading || !isSignedIn) return;
    if (window.sessionStorage.getItem("moduo:auth_resolving") === "1") return;

    const pendingPriceId = priceId ?? window.localStorage.getItem("moduo:pending_price_id");
    if (pendingPriceId) {
      window.localStorage.removeItem("moduo:pending_price_id");
      const supabaseUrl =
        (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
        "https://wtoonrvuqumihpkbvwvs.supabase.co";
      window.location.href = `${supabaseUrl}/functions/v1/create-checkout-session?price_id=${encodeURIComponent(pendingPriceId)}`;
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
  }, [isSignedIn, loading, navigate, priceId]);

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

      <div className="relative mx-auto flex min-h-screen w-full max-w-[480px] items-center justify-center px-5 py-8">
        <div className="w-full rounded-xl border border-border bg-card px-6 py-7 shadow-xl sm:px-7 sm:py-8">
          <EmailAuthPanel priceId={priceId} />
        </div>
      </div>
    </div>
  );
}
