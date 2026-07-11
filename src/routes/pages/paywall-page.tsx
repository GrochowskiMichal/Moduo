import { useState } from "react";
import { Check } from "lucide-react";
import { Pressable, Text, View } from "../../tw";
import { useAuth } from "../../providers/auth-provider";
import { supabaseClient } from "../../lib/runtime.web";

const SUPABASE_URL =
  (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
  "https://wtoonrvuqumihpkbvwvs.supabase.co";

type BillingCycle = "monthly" | "yearly";

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
      const { url, error: checkoutError } = await res.json();
      if (checkoutError) throw new Error(checkoutError);
      if (url) window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
    } finally {
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
        const { data: row } = await supabaseClient
          .from("user_entitlements")
          .select("subscription_status")
          .maybeSingle<{ subscription_status: string }>();
        const status = row?.subscription_status;
        if (status === "trialing" || status === "active") {
          confirmed = true;
          break;
        }
      }

      if (!confirmed) {
        console.warn("[paywall] trial created but subscription_status not yet reflected — redirecting anyway");
      }

      window.location.href = "/";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start trial. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  const proPrice = billing === "monthly" ? "$10/mo" : "$8/mo";
  const teamPrice = billing === "monthly" ? "$9/seat/mo" : "$7/seat/mo";

  return (
    <View className="relative min-h-screen bg-[#070707] overflow-hidden">
      {/* Background glow */}
      <View className="pointer-events-none absolute left-1/2 top-[-180px] h-[460px] w-[660px] -translate-x-1/2 rounded-full bg-white/[0.04] blur-[120px]" />

      <View className="relative mx-auto max-w-[1100px] px-6 py-16">
        {/* Header */}
        <View className="mb-14 text-center">
          <Text as="p" className="text-[12px] font-semibold uppercase tracking-[0.22em] text-white/32 mb-4">
            Your trial has ended
          </Text>
          <h1 className="text-[40px] font-semibold leading-tight tracking-[-0.04em] text-[#f4f4f4]">
            Choose your plan to continue
          </h1>
          <Text as="p" className="mx-auto mt-3 max-w-[480px] text-[16px] leading-7 text-white/42">
            All plans include a 7-day free trial. No credit card required to start.
          </Text>

          {/* Billing toggle */}
          <View className="mt-8 inline-flex flex-row items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] p-1">
            <Pressable
              onPress={() => setBilling("monthly")}
              className={`rounded-full px-5 py-2 ${billing === "monthly" ? "bg-white/10" : "bg-transparent"}`}
            >
              <Text className={`text-[14px] font-medium ${billing === "monthly" ? "text-[#f2f2f2]" : "text-white/40"}`}>
                Monthly
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setBilling("yearly")}
              className={`rounded-full px-5 py-2 ${billing === "yearly" ? "bg-white/10" : "bg-transparent"}`}
            >
              <Text className={`text-[14px] font-medium ${billing === "yearly" ? "text-[#f2f2f2]" : "text-white/40"}`}>
                Yearly <Text className="text-[12px] text-amber-400">–20%</Text>
              </Text>
            </Pressable>
          </View>
        </View>

        {/* Plan cards */}
        <View className="flex flex-col gap-4 md:flex-row md:items-start">
          {/* Free / Trial */}
          <View className="flex-1 rounded-2xl border border-white/8 bg-[#0d0d0d] p-8">
            <Text as="p" className="text-[12px] font-semibold uppercase tracking-widest text-white/30">Free</Text>
            <Text as="p" className="mt-3 text-[36px] font-semibold text-[#f4f4f4]">$0</Text>
            <Text as="p" className="mt-1 text-[14px] text-white/38">Web &amp; desktop</Text>

            <View className="mt-6 gap-3">
              {["Notes, tasks, calendar & contacts", "Access on web & desktop", "Cloud sync across devices", "7-day Pro trial, no card required"].map((f) => (
                <View key={f} className="flex flex-row items-start gap-3">
                  <View className="mt-0.5 h-5 w-5 items-center justify-center rounded-full bg-white/8">
                    <Check size={11} color="rgba(255,255,255,0.4)" />
                  </View>
                  <Text className="text-[14px] leading-5 text-white/50">{f}</Text>
                </View>
              ))}
            </View>

            <Pressable
              className="mt-8 flex h-12 w-full items-center justify-center rounded-2xl border border-white/10 bg-transparent"
              onPress={() => window.open("https://moduo.app/download", "_blank")}
            >
              <Text className="text-[15px] font-medium text-white/50">Download desktop app</Text>
            </Pressable>
          </View>

          {/* Pro */}
          <View className="flex-1 rounded-2xl border border-amber-500/30 bg-[#0f0e09] p-8 relative overflow-hidden">
            <View className="pointer-events-none absolute inset-0 rounded-2xl bg-amber-500/[0.03]" />
            <View className="flex flex-row items-center justify-between">
              <Text as="p" className="text-[12px] font-semibold uppercase tracking-widest text-amber-400">Pro</Text>
              <View className="rounded-full bg-amber-500/15 px-3 py-1">
                <Text className="text-[11px] font-medium text-amber-300">Most popular</Text>
              </View>
            </View>
            <Text as="p" className="mt-3 text-[36px] font-semibold text-[#f4f4f4]">{proPrice}</Text>
            {billing === "yearly" && (
              <Text as="p" className="mt-0.5 text-[13px] text-white/38">billed as $96/yr</Text>
            )}
            <Text as="p" className="mt-1 text-[14px] text-amber-300/70">7-day free trial</Text>

            <View className="mt-6 gap-3">
              {PRO_FEATURES.map((f) => (
                <View key={f} className="flex flex-row items-start gap-3">
                  <View className="mt-0.5 h-5 w-5 items-center justify-center rounded-full bg-amber-500/20">
                    <Check size={11} color="#f59e0b" />
                  </View>
                  <Text className="text-[14px] leading-5 text-white/75">{f}</Text>
                </View>
              ))}
            </View>

            <Pressable
              className={`mt-8 flex h-12 w-full items-center justify-center rounded-2xl ${busy === "Pro" ? "bg-amber-700" : "bg-amber-500 hover:bg-amber-400"}`}
              disabled={busy !== null}
              onPress={() => void redirectToCheckout("pro", "Pro")}
            >
              <Text className="text-[15px] font-semibold text-black">
                {busy === "Pro" ? "Redirecting…" : "Start free trial"}
              </Text>
            </Pressable>
          </View>

          {/* Team */}
          <View className="flex-1 rounded-2xl border border-white/10 bg-[#0d0d0d] p-8">
            <Text as="p" className="text-[12px] font-semibold uppercase tracking-widest text-white/40">Team</Text>
            <Text as="p" className="mt-3 text-[36px] font-semibold text-[#f4f4f4]">{teamPrice}</Text>
            <Text as="p" className="mt-1 text-[14px] text-white/38">7-day free trial</Text>

            <View className="mt-6 gap-3">
              {TEAM_FEATURES.map((f) => (
                <View key={f} className="flex flex-row items-start gap-3">
                  <View className="mt-0.5 h-5 w-5 items-center justify-center rounded-full bg-white/10">
                    <Check size={11} color="rgba(255,255,255,0.7)" />
                  </View>
                  <Text className="text-[14px] leading-5 text-white/75">{f}</Text>
                </View>
              ))}
            </View>

            <Pressable
              className={`mt-8 flex h-12 w-full items-center justify-center rounded-2xl ${busy === "Team" ? "bg-white/10" : "bg-[#f2f2f2] hover:bg-white"}`}
              disabled={busy !== null}
              onPress={() => void redirectToCheckout("team", "Team")}
            >
              <Text className={`text-[15px] font-semibold ${busy === "Team" ? "text-white/40" : "text-[#111]"}`}>
                {busy === "Team" ? "Redirecting…" : "Start free trial"}
              </Text>
            </Pressable>
          </View>
        </View>

        {/* "Start free trial with no card" CTA */}
        <View className="mt-10 text-center">
          <Pressable
            className="inline-flex items-center gap-2"
            disabled={busy !== null}
            onPress={() => void startFreeTrial()}
          >
            <Text className="text-[14px] text-white/38 underline">
              {busy === "trial" ? "Setting up your trial…" : "Start a no-card 7-day trial on Pro →"}
            </Text>
          </Pressable>
        </View>

        {error && (
          <View className="mt-6 mx-auto max-w-[480px] rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3">
            <Text as="p" className="text-center text-[13px] text-red-100/85">{error}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
