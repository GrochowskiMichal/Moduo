import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, CheckCircle2, Clock } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../providers/auth-provider";
import { Pressable, Text, TextInput, View } from "../../tw";

function checkoutRedirectUrl(priceId: string, accessToken: string | null) {
  const supabaseUrl =
    (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
    "https://wtoonrvuqumihpkbvwvs.supabase.co";
  const q = new URLSearchParams();
  q.set("price_id", priceId);
  if (accessToken) q.set("access_token", accessToken);
  return `${supabaseUrl}/functions/v1/create-checkout-session?${q}`;
}

type Step = "trial-active" | "workspace";

export function OnboardingPage() {
  const { isSignedIn, loading, runtime, planTier } = useAuth();
  const navigate = useNavigate();
  const [workspaceName, setWorkspaceName] = useState("My workspace");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<Step>("trial-active");

  const isWeb = !!runtime?.capabilities.isWeb;

  useEffect(() => {
    if (!loading && !isSignedIn) void navigate({ to: "/auth", replace: true });
  }, [isSignedIn, loading, navigate]);

  // Desktop users and users who came via a paid plan link skip the trial banner.
  useEffect(() => {
    if (loading) return;
    const pendingPriceId = window.localStorage.getItem("moduo:pending_price_id");
    if (!isWeb || pendingPriceId) {
      setStep("workspace");
    }
  }, [isWeb, loading]);

  const finish = async () => {
    if (!runtime || busy) return;
    const name = workspaceName.trim() || "My workspace";
    setBusy(true);
    setError(null);
    try {
      const existing = await runtime.workspace.list();
      if (existing.length === 0) {
        await runtime.workspace.create(name);
      }

      const pendingPriceId = window.localStorage.getItem("moduo:pending_price_id");
      if (pendingPriceId) {
        window.localStorage.removeItem("moduo:pending_price_id");
        const session = await runtime.auth.getSession();
        const token = session?.data?.session?.access_token ?? null;
        window.location.href = checkoutRedirectUrl(pendingPriceId, token);
        return;
      }

      void navigate({ to: "/", replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish onboarding.");
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View className="flex min-h-screen items-center justify-center bg-[#070707]">
        <Text as="p" className="text-[14px] text-white/40">
          Loading…
        </Text>
      </View>
    );
  }

  return (
    <View className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#070707] px-4 py-8">
      <View className="pointer-events-none absolute left-1/2 top-[-220px] h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-white/[0.055] blur-[120px]" />
      <View className="relative w-full max-w-[500px] rounded-[34px] border border-white/10 bg-[#0d0d0d]/92 p-[1px] shadow-[0_26px_90px_rgba(0,0,0,0.52)] backdrop-blur-xl">
        <View className="rounded-[33px] border border-white/[0.035] bg-[linear-gradient(180deg,rgba(255,255,255,0.06),rgba(255,255,255,0.014))] px-5 py-8 sm:px-8 sm:py-9">
          {/* ── Step 1: Trial confirmation ── */}
          {step === "trial-active" ? (
            <>
              <View className="mb-6 flex items-center justify-center">
                <View className="rounded-full bg-amber-500/15 p-4">
                  <CheckCircle2 size={36} color="#f59e0b" />
                </View>
              </View>
              <Text
                as="p"
                className="text-center text-[12px] font-semibold uppercase tracking-[0.22em] text-white/32"
              >
                Welcome to Moduo
              </Text>
              <Text
                as="p"
                className="mt-4 text-center text-[30px] font-semibold leading-tight tracking-[-0.04em] text-[#f4f4f4]"
              >
                Your 7-day trial is active
              </Text>
              <Text
                as="p"
                className="mx-auto mt-3 max-w-[360px] text-center text-[14px] leading-6 text-white/42"
              >
                You have full access to all Pro features for 7 days.
              </Text>

              <View className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/8 px-5 py-4">
                <View className="flex flex-row items-start gap-3">
                  <Clock size={16} color="#f59e0b" className="mt-0.5 shrink-0" />
                  <Text as="p" className="text-[13px] leading-5 text-amber-200/70">
                    Add a card any time during the trial to extend it to{" "}
                    <Text className="font-medium text-amber-200">30 days total</Text> — open{" "}
                    <Text className="font-medium text-amber-200">Settings → Billing</Text> and
                    choose <Text className="font-medium text-amber-200">Manage billing</Text>.
                  </Text>
                </View>
              </View>

              <Pressable
                onPress={() => setStep("workspace")}
                className="mt-8 flex h-14 w-full flex-row items-center justify-center gap-2 rounded-[18px] bg-[#f2f2f2]"
              >
                <Text as="p" className="text-[15px] font-semibold text-[#101010]">
                  Set up workspace
                </Text>
                <ArrowRight size={16} color="#101010" />
              </Pressable>
            </>
          ) : (
            /* ── Step 2: Workspace creation ── */
            <>
              <Text
                as="p"
                className="text-center text-[12px] font-semibold uppercase tracking-[0.22em] text-white/32"
              >
                Welcome to Moduo
              </Text>
              <Text
                as="p"
                className="mt-4 text-center text-[30px] font-semibold leading-tight tracking-[-0.04em] text-[#f4f4f4]"
              >
                Set up your first workspace
              </Text>
              <Text
                as="p"
                className="mx-auto mt-2 max-w-[340px] text-center text-[14px] leading-6 text-white/42"
              >
                This helps us create the right place for your boards, notes, and modules.
              </Text>

              <View className="mt-8 gap-4">
                <TextInput
                  placeholder="Workspace name"
                  placeholderTextColor="rgba(255,255,255,0.24)"
                  value={workspaceName}
                  onChangeText={setWorkspaceName}
                  className="h-14 w-full appearance-none rounded-[18px] border border-white/10 bg-black/35 px-5 text-[15px] text-[#f4f4f4] outline-none focus:border-white/22"
                />

                <Pressable
                  disabled={busy}
                  onPress={finish}
                  className={`flex h-14 w-full flex-row items-center justify-center gap-2 rounded-[18px] ${busy ? "bg-white/[0.08]" : "bg-[#f2f2f2]"}`}
                >
                  <Text
                    as="p"
                    className={`text-[15px] font-semibold ${busy ? "text-white/32" : "text-[#101010]"}`}
                  >
                    {busy ? "Creating workspace…" : "Continue to Moduo"}
                  </Text>
                  {!busy ? <ArrowRight size={16} color="#101010" /> : null}
                </Pressable>
              </View>
            </>
          )}

          {error ? (
            <View className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3">
              <Text as="p" className="text-[13px] leading-5 text-red-100/85">
                {error}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
