import { useMemo, useState } from "react";
import { Image, Pressable, Text, TextInput, View } from "../../tw";
import { useAuth } from "../../providers/auth-provider";

type AuthStage = "email" | "code";

export function EmailAuthPanel() {
  const { supabase, configError } = useAuth();
  const [stage, setStage] = useState<AuthStage>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const normalizedEmail = email.trim().toLowerCase();
  const canSend = !!supabase && !!normalizedEmail && !busy;
  const canVerify = !!supabase && !!normalizedEmail && !!code.trim() && !busy;

  const headline = useMemo(
    () => (stage === "email" ? "Sign in or register" : "Enter magic code"),
    [stage]
  );

  const sendCode = async () => {
    if (!canSend) return;
    setBusy(true);
    setError(null);
    setInfo(null);

    const { error: sendError } = await supabase!.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        shouldCreateUser: true,
      },
    });

    setBusy(false);
    if (sendError) {
      setError(sendError.message);
      return;
    }

    setStage("code");
    setCode("");
    setInfo(`Magic code sent to ${normalizedEmail}`);
  };

  const verifyCode = async () => {
    if (!canVerify) return;
    setBusy(true);
    setError(null);
    setInfo(null);

    const { error: verifyError } = await supabase!.auth.verifyOtp({
      email: normalizedEmail,
      token: code.trim(),
      type: "email",
    });

    setBusy(false);
    if (verifyError) {
      setError(verifyError.message);
      return;
    }

    setInfo("Authenticated. Redirecting...");
  };

  return (
    <View className="w-full max-w-[520px] items-center">
      <Image
        source={require("../../../assets/moduo_logo_white.svg")}
        className="w-[280px] h-[70px] mb-6"
        contentFit="contain"
      />

      <View className="w-full rounded-2xl border border-[#1d2637] bg-[#0f1624] p-6 gap-3">
        <Text className="text-white text-[28px] font-semibold">{headline}</Text>
        <Text className="text-[#8da0bf] text-[15px]">
          Use your email to receive a one-time magic code.
        </Text>

        {stage === "email" ? (
          <>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="you@company.com"
              placeholderTextColor="#64748b"
              value={email}
              onChangeText={setEmail}
              className="h-12 rounded-xl border border-[#273247] bg-[#0e1726] px-4 text-white"
            />
            <Pressable
              disabled={!canSend}
              onPress={sendCode}
              className={`h-12 rounded-xl items-center justify-center ${canSend ? "bg-white" : "bg-white/40"}`}
            >
              <Text className="text-[#0b111b] text-[16px] font-semibold">
                {busy ? "Sending..." : "Send magic code"}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text className="text-[#b3c0d6] text-[14px]">{normalizedEmail}</Text>
            <TextInput
              autoCapitalize="none"
              autoComplete="one-time-code"
              keyboardType="number-pad"
              placeholder="6-digit code"
              placeholderTextColor="#64748b"
              value={code}
              onChangeText={setCode}
              className="h-12 rounded-xl border border-[#273247] bg-[#0e1726] px-4 text-white"
            />
            <Pressable
              disabled={!canVerify}
              onPress={verifyCode}
              className={`h-12 rounded-xl items-center justify-center ${canVerify ? "bg-white" : "bg-white/40"}`}
            >
              <Text className="text-[#0b111b] text-[16px] font-semibold">
                {busy ? "Verifying..." : "Verify code"}
              </Text>
            </Pressable>
            <View className="flex-row items-center justify-between">
              <Pressable
                onPress={() => {
                  if (busy) return;
                  setStage("email");
                  setCode("");
                  setError(null);
                  setInfo(null);
                }}
              >
                <Text className="text-[#8da0bf]">Change email</Text>
              </Pressable>
              <Pressable disabled={!canSend} onPress={sendCode}>
                <Text className={`${canSend ? "text-white" : "text-[#5d6a80]"}`}>Resend code</Text>
              </Pressable>
            </View>
          </>
        )}

        {configError ? <Text className="text-[#ff9f9f]">{configError}</Text> : null}
        {error ? <Text className="text-[#ff9f9f]">{error}</Text> : null}
        {info ? <Text className="text-[#9dc3ff]">{info}</Text> : null}
      </View>
    </View>
  );
}
