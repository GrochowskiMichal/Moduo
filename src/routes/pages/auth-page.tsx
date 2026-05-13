import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Text, View } from "../../tw";
import { useAuth } from "../../providers/auth-provider";
import { EmailAuthPanel } from "../../components/auth/email-auth-panel";

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

    // If a Stripe price_id was passed (from landing pricing CTA), kick off checkout.
    const pendingPriceId = priceId ?? window.localStorage.getItem("moduo:pending_price_id");
    if (pendingPriceId) {
      window.localStorage.removeItem("moduo:pending_price_id");
      // Redirect to the checkout edge function — handled server-side.
      const supabaseUrl =
        (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
        "https://wtoonrvuqumihpkbvwvs.supabase.co";
      window.location.href = `${supabaseUrl}/functions/v1/create-checkout-session?price_id=${encodeURIComponent(pendingPriceId)}`;
      return;
    }

    void navigate({ to: "/", replace: true });
  }, [isSignedIn, loading, navigate, priceId]);

  // Show nothing while we confirm auth state (avoids flash of auth form for logged-in users).
  if (loading) {
    return (
      <View className="flex min-h-screen items-center justify-center bg-[#080808]">
        <View className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-3 shadow-2xl">
          <Text as="p" className="text-[14px] text-[#9a9a9a]">Checking your session…</Text>
        </View>
      </View>
    );
  }

  return (
    <View className="relative min-h-screen overflow-hidden bg-[#070707]">
      <View className="pointer-events-none absolute left-1/2 top-[-260px] h-[520px] w-[620px] -translate-x-1/2 rounded-full bg-white/[0.045] blur-[120px]" />
      <View className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.055),transparent_42%)]" />

      <View className="relative mx-auto flex min-h-screen w-full max-w-[480px] items-center justify-center px-5 py-8">
        <View className="w-full rounded-[28px] border border-white/[0.09] bg-[#0d0d0d]/92 p-[1px] shadow-[0_24px_80px_rgba(0,0,0,0.48)] backdrop-blur-xl">
          <View className="rounded-[27px] bg-[linear-gradient(180deg,rgba(255,255,255,0.045),rgba(255,255,255,0.012))] px-6 py-7 sm:px-7 sm:py-8">
            {/* priceId is consumed by the auth-page useEffect above for the
                post-signin checkout redirect. The shadcn port of
                EmailAuthPanel (separate PR) will accept it as a prop to
                drive the signup flow; main's panel doesn't yet. */}
            <EmailAuthPanel />
          </View>
        </View>
      </View>
    </View>
  );
}
