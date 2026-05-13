import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CircleHelp, CircleUserRound, Mail, UserPlus } from "lucide-react";
import { Image, Pressable, Text, TextInput, View } from "../../tw";
import moduoLogoWhite from "../../../assets/moduo_logo_white.svg";
import defaultProfilePic from "../../../assets/icon.png";
import { useAuth } from "../../providers/auth-provider";
import type { AuthMnemonic } from "../../lib/runtime";
import { notifyProfileUpdated, writeStoredAvatar } from "../../features/profile/profile-storage";

// ── Types ──────────────────────────────────────────────────────────────────────

type DesktopFlow =
  | "entry"
  | "create_profile"
  | "create_phrase"
  | "create_email"
  | "unlock"
  | "pin"
  | "reset_confirm";

type WebFlow = "email" | "otp_sent";

type Flow = DesktopFlow | WebFlow;

interface Props {
  /** Stripe price_id to initiate checkout after successful auth */
  priceId?: string | null;
}

function normalizePhrase(value: string) {
  return value
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

// ── Component ──────────────────────────────────────────────────────────────────

export function EmailAuthPanel({ priceId }: Props) {
  const { runtime, configError } = useAuth();
  const isWeb = !!runtime?.capabilities.isWeb;
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<Flow>("entry");

  // Web OTP state
  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);

  // Desktop vault state
  const [profileExists, setProfileExists] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [profileName, setProfileName] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState("");
  const [generatedMnemonic, setGeneratedMnemonic] = useState<AuthMnemonic | null>(null);
  const [phraseRevealed, setPhraseRevealed] = useState(false);
  const [phraseCopied, setPhraseCopied] = useState(false);
  const [unlockPhrase, setUnlockPhrase] = useState("");
  const [pinValue, setPinValue] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  // Bootstrap
  useEffect(() => {
    if (!runtime) { setLoading(false); return; }
    let active = true;

    const run = async () => {
      setLoading(true);
      if (isWeb) {
        setLoading(false);
        setFlow("email");
        return;
      }
      const { data, error: authErr } = await runtime.auth.getLocalAuthState();
      if (!active) return;
      if (authErr) {
        setError(authErr.message);
      } else {
        setProfileExists(data.profileExists);
        setHasPin(data.hasPin);
        if (data.displayName) setProfileName(data.displayName);
        if (data.profileExists && data.hasPin) setFlow("pin");
        else setFlow("entry");
      }
      setLoading(false);
    };

    void run();
    return () => { active = false; };
  }, [runtime, isWeb]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    void writeStoredAvatar(runtime, avatarDataUrl).then(() => notifyProfileUpdated());
  }, [avatarDataUrl, runtime]);

  const avatarInitial = useMemo(() => profileName.trim().slice(0, 1).toUpperCase(), [profileName]);

  // ── Web OTP handlers ─────────────────────────────────────────────────────────

  const handleSendOtp = async () => {
    if (!runtime || busy) return;
    const email = otpEmail.trim().toLowerCase();
    if (!email) { setError("Enter your email address."); return; }
    setBusy(true); setError(null); setInfo(null);
    const sentAt = Date.now();
    const { error: otpErr } = await runtime.auth.sendOtp({ email });
    setBusy(false);
    if (otpErr) { setError(otpErr.message); return; }
    setOtpSentAt(sentAt);
    setFlow("otp_sent");
  };

  const handleVerifyOtp = async () => {
    if (!runtime || busy) return;
    const code = otpCode.trim();
    if (code.length !== 6) { setError("Enter the 6-digit code from your email."); return; }
    setBusy(true); setError(null); setInfo(null);
    window.sessionStorage.setItem("moduo:auth_resolving", "1");
    const { data, error: verifyErr } = await runtime.auth.verifyOtp({
      email: otpEmail.trim().toLowerCase(),
      token: code,
      sentAt: otpSentAt ?? undefined,
    });
    setBusy(false);
    if (verifyErr) {
      window.sessionStorage.removeItem("moduo:auth_resolving");
      setError(verifyErr.message);
      return;
    }

    if (priceId) {
      window.localStorage.setItem("moduo:pending_price_id", priceId);
    }

    let hasWorkspace = false;
    try {
      const workspaces = await runtime.workspace.list();
      hasWorkspace = workspaces.length > 0;
    } catch {
      hasWorkspace = false;
    }

    const shouldOnboard = !!data.isNewUser || !hasWorkspace;
    window.sessionStorage.removeItem("moduo:auth_resolving");

    // Auto-start 7-day trial for brand-new cloud signups (no explicit price chosen).
    if (data.isNewUser && !priceId) {
      try {
        const supabaseUrl =
          (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
          "https://wtoonrvuqumihpkbvwvs.supabase.co";
        const session = await runtime.auth.getSession();
        const token = session?.data?.session?.access_token;
        if (token) {
          await fetch(`${supabaseUrl}/functions/v1/start-trial`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}` },
          });
        }
      } catch (trialErr) {
        console.warn("[auth] auto-trial start failed (non-fatal):", trialErr);
      }
    }

    if (shouldOnboard) {
      window.location.href = "/onboarding";
      return;
    }

    const pendingPriceId = priceId ?? window.localStorage.getItem("moduo:pending_price_id");
    if (pendingPriceId) {
      window.localStorage.removeItem("moduo:pending_price_id");
      const supabaseUrl =
        (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ||
        "https://wtoonrvuqumihpkbvwvs.supabase.co";
      const session = await runtime.auth.getSession();
      const token = session?.data?.session?.access_token;
      window.location.href = `${supabaseUrl}/functions/v1/create-checkout-session?price_id=${encodeURIComponent(pendingPriceId)}${token ? `&access_token=${encodeURIComponent(token)}` : ""}`;
      return;
    }

    window.location.href = "/";
  };

  const handleResendOtp = async () => {
    setOtpCode(""); setError(null); setInfo(null);
    await handleSendOtp();
  };

  // ── Desktop vault handlers ───────────────────────────────────────────────────

  const continueFromCreateProfile = async () => {
    if (!runtime || busy) return;
    if (!profileName.trim()) { setError("Full name is required."); return; }
    setBusy(true); setError(null); setInfo(null);
    const { data, error: generateError } = await runtime.auth.generateMnemonic();
    setBusy(false);
    if (generateError) { setError(generateError.message); return; }
    setGeneratedMnemonic(data);
    setPhraseRevealed(false); setPhraseCopied(false);
    setFlow("create_phrase");
  };

  const revealCopyOrContinue = async () => {
    if (!generatedMnemonic || busy) return;
    if (phraseCopied) { setFlow("create_email"); return; }
    setBusy(true); setError(null); setInfo(null); setPhraseRevealed(true);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(generatedMnemonic.phrase);
        setInfo("12-word phrase copied to clipboard.");
      } else {
        setInfo("Clipboard unavailable — copy the phrase manually.");
      }
      setPhraseCopied(true);
    } catch {
      setInfo("Could not copy automatically — copy the phrase manually."); setPhraseCopied(true);
    } finally {
      setBusy(false);
    }
  };

  const forgotReset = async () => {
    if (!runtime || busy) return;
    setBusy(true); setError(null);
    const { error: resetError } = await runtime.auth.forgotResetLocal();
    setBusy(false);
    if (resetError) { setError(resetError.message); return; }
    setProfileExists(false); setHasPin(false);
    setPinValue(""); setUnlockPhrase(""); setProfileName("");
    setFlow("create_profile");
    setInfo("Vault reset. Create a new vault to continue.");
  };

  const finishCreateVault = async () => {
    if (!generatedMnemonic || !runtime || busy) return;
    if (!profileName.trim()) { setError("Full name is required."); return; }
    setBusy(true); setError(null); setInfo(null);
    const { error: regError } = await runtime.auth.registerLocalMnemonic({
      displayName: profileName.trim(),
      mnemonicPhrase: generatedMnemonic.phrase,
    });
    setBusy(false);
    if (regError) setError(regError.message);
  };

  const unlock = async () => {
    if (!runtime || busy || !normalizePhrase(unlockPhrase).length) return;
    setBusy(true); setError(null); setInfo(null);
    const { error: unlockError } = await runtime.auth.unlockWithMnemonic({ mnemonicPhrase: unlockPhrase });
    setBusy(false);
    if (unlockError) setError(unlockError.message);
  };

  const unlockWithPin = async () => {
    if (!runtime || busy || pinValue.trim().length < 4) return;
    setBusy(true); setError(null); setInfo(null);
    const { error: pinError } = await runtime.auth.unlockWithPin(pinValue.trim());
    setBusy(false);
    if (pinError) setError(pinError.message);
  };

  // ── Shared UI ────────────────────────────────────────────────────────────────

  const inputCls =
    "h-12 w-full appearance-none rounded-2xl border border-white/[0.1] bg-black/30 px-4 text-[15px] text-[#f4f4f4] outline-none transition-colors placeholder:text-white/24 focus:border-white/24 focus:bg-black/40 focus:outline-none focus:ring-0";

  const panelTitle =
    isWeb && flow === "otp_sent"
      ? "Check your email"
      : isWeb && flow === "email"
        ? "Log in or create account"
        : isWeb
          ? "Continue"
          : profileExists
            ? "Unlock your vault"
            : "Create your vault";

  const panelSubtitle =
    isWeb && flow === "otp_sent"
      ? "Enter the six-digit code we sent. It expires shortly."
      : isWeb && flow === "email"
        ? "We’ll email you a secure code to continue."
        : isWeb
          ? ""
          : profileExists
            ? "Use your PIN or recovery phrase to continue."
            : "Your local vault stays private on this device.";

  const openAvatarPicker = () => avatarInputRef.current?.click();

  const onAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setError("Profile picture must be an image file."); return; }
    if (file.size > 4 * 1024 * 1024) { setError("Profile picture is too large (max 4 MB)."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setAvatarDataUrl(result); setError(null);
    };
    reader.readAsDataURL(file);
  };

  const smallAvatar = (
    <View className="mx-auto mb-4 mt-1">
      <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={onAvatarChange} />
      <Pressable onPress={openAvatarPicker} className="relative h-[58px] w-[58px] overflow-hidden rounded-full border border-[#2a2a2a] bg-[#090909]">
        <Image source={avatarDataUrl ? { uri: avatarDataUrl } : defaultProfilePic} className={`h-full w-full ${avatarDataUrl ? "opacity-100" : "opacity-30"}`} contentFit="cover" />
        {!avatarDataUrl && avatarInitial ? (
          <View className="absolute inset-0 items-center justify-center bg-[linear-gradient(180deg,rgba(8,8,8,0.2),rgba(8,8,8,0.72))]">
            <Text as="p" className="text-[20px] font-semibold text-[#f2f2f2]">{avatarInitial}</Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );

  if (loading) {
    return (
      <View className="relative z-10 w-full items-center">
        <Image source={moduoLogoWhite} className="mx-auto mb-8 h-10 w-[156px] opacity-95" contentFit="contain" />
        <Text as="p" className="text-center text-[14px] text-white/40">Loading…</Text>
      </View>
    );
  }

  return (
    <View className="relative z-10 w-full">
      <View className="mb-7 w-full items-center">
        <Image
          source={moduoLogoWhite}
          className={`mx-auto h-8 w-[128px] opacity-95 ${isWeb && flow === "otp_sent" ? "mb-10" : "mb-6"}`}
          contentFit="contain"
        />
        {isWeb && flow === "otp_sent" ? (
          <View className="relative w-full max-w-full px-10">
            <Pressable
              aria-label="Back to email"
              onPress={() => { setFlow("email"); setOtpCode(""); setError(null); setInfo(null); }}
              className="absolute left-0 top-1/2 z-10 -translate-y-1/2 p-1 active:opacity-70"
            >
              <ArrowLeft size={22} strokeWidth={2} color="rgba(255,255,255,0.72)" />
            </Pressable>
            <Text as="p" className="w-full text-center text-[26px] font-semibold leading-[1.15] tracking-[-0.035em] text-[#f4f4f4]">
              Check your email
            </Text>
          </View>
        ) : (
          <Text as="p" className="w-full text-center text-[26px] font-semibold leading-[1.15] tracking-[-0.035em] text-[#f4f4f4]">
            {panelTitle}
          </Text>
        )}
        {panelSubtitle ? (
          <Text as="p" className="mx-auto mt-2 max-w-[300px] self-center text-center text-[14px] leading-5 text-white/42">
            {panelSubtitle}
          </Text>
        ) : null}
      </View>

      <View className="w-full">

        {/* ════════════════════════════════════════════════════════════════════
            WEB FLOWS
        ════════════════════════════════════════════════════════════════════ */}

        {/* ── Web: email entry ── */}
        {isWeb && flow === "email" ? (
          <View className="w-full gap-0">
            <View className="relative w-full">
              <View className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center justify-center">
                <Mail size={16} color="rgba(255,255,255,0.34)" />
              </View>
              <TextInput
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                placeholder="you@example.com"
                placeholderTextColor="rgba(255,255,255,0.24)"
                value={otpEmail}
                onChangeText={(v) => { setOtpEmail(v); setError(null); }}
                className={`${inputCls} pl-11`}
              />
            </View>

            <Pressable
              disabled={busy || !otpEmail.trim()}
              onPress={handleSendOtp}
              className={`mt-5 flex h-12 w-full items-center justify-center rounded-2xl transition-colors ${!busy && otpEmail.trim() ? "bg-[#f2f2f2]" : "bg-white/[0.08]"}`}
            >
              <Text as="p" className={`text-[15px] font-semibold ${!busy && otpEmail.trim() ? "text-[#101010]" : "text-white/32"}`}>
                {busy ? "Sending…" : "Continue with email"}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* ── Web: OTP verification ── */}
        {isWeb && flow === "otp_sent" ? (
          <View className="w-full">
            <View className="gap-4">
              <TextInput
                placeholder="000000"
                placeholderTextColor="rgba(255,255,255,0.18)"
                value={otpCode}
                onChangeText={(v) => { setOtpCode(v.replace(/\D/g, "").slice(0, 6)); setError(null); }}
                keyboardType="numeric"
                maxLength={6}
                className={`${inputCls} h-13 text-center text-[22px] font-semibold tabular-nums tracking-[0.2em]`}
              />

              <Pressable
                disabled={busy || otpCode.length !== 6}
                onPress={handleVerifyOtp}
                className={`flex h-12 w-full items-center justify-center rounded-2xl transition-colors ${!busy && otpCode.length === 6 ? "bg-[#f2f2f2]" : "bg-white/[0.08]"}`}
              >
                <Text as="p" className={`text-[15px] font-semibold ${!busy && otpCode.length === 6 ? "text-[#101010]" : "text-white/32"}`}>
                  {busy ? "Verifying…" : "Continue"}
                </Text>
              </Pressable>
            </View>

            <Pressable onPress={handleResendOtp} disabled={busy} className="mt-8">
              <Text as="p" className="text-center text-[13px] text-white/38">
                Didn't receive it? <Text as="span" className="font-medium text-white/70 underline">Resend code</Text>
              </Text>
            </Pressable>
          </View>
        ) : null}

        {/* ════════════════════════════════════════════════════════════════════
            DESKTOP FLOWS (unchanged)
        ════════════════════════════════════════════════════════════════════ */}

        {/* ── Desktop: entry ── */}
        {!isWeb && flow === "entry" ? (
          <View className="gap-3">
            {!profileExists ? (
              <Pressable disabled={busy} onPress={() => { setError(null); setInfo(null); setFlow("create_profile"); }} className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#f2f2f2]">
                <Text as="p" className="text-[16px] font-semibold text-[#101010]">Create vault</Text>
              </Pressable>
            ) : null}
            {profileExists ? (
              <Pressable disabled={busy} onPress={() => { setError(null); setInfo(null); setFlow("unlock"); }} className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#f2f2f2]">
                <Text as="p" className="text-[16px] font-semibold text-[#101010]">Unlock vault</Text>
              </Pressable>
            ) : null}
            {profileExists ? (
              <Pressable disabled={busy} onPress={() => { setError(null); setInfo(null); setFlow("reset_confirm"); }} className="flex h-12 w-full items-center justify-center rounded-2xl border border-[#2b2b2b] bg-[#101010]">
                <Text as="p" className="text-[13px] text-[#6e6e6e]">Forgot phrase / Reset vault</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {/* ── Desktop: create profile ── */}
        {!isWeb && flow === "create_profile" ? (
          <>
            {smallAvatar}
            <View className="relative">
              <View className="pointer-events-none absolute inset-y-0 left-4 flex items-center justify-center"><UserPlus size={18} color="#4a4a4a" /></View>
            <TextInput placeholder="Profile name" placeholderTextColor="rgba(255,255,255,0.24)" value={profileName} onChangeText={setProfileName} className={`${inputCls} pl-12`} />
            </View>
            <Pressable disabled={busy || !profileName.trim()} onPress={continueFromCreateProfile} className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${profileName.trim() && !busy ? "bg-[#f2f2f2]" : "bg-[#2c2c2c]"}`}>
              <Text as="p" className={`w-full text-center text-[16px] font-semibold ${profileName.trim() && !busy ? "text-[#101010]" : "text-[#7e7e7e]"}`}>{busy ? "Preparing…" : "Continue"}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => setFlow("entry")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">Back</Text>
            </Pressable>
          </>
        ) : null}

        {/* ── Desktop: create phrase ── */}
        {!isWeb && flow === "create_phrase" ? (
          <>
            <View className="mb-2 flex items-center justify-between px-1">
              <Text as="p" className="text-[12px] font-bold uppercase tracking-widest text-[#8f8f8f]">12-word phrase</Text>
              <View className="group relative">
                <Pressable aria-label="Why mnemonic phrase" className="grid h-7 w-7 place-items-center rounded-full text-[#8d8d8d] hover:bg-[#1a1a1a]">
                  <CircleHelp size={15} />
                </Pressable>
                <View className="pointer-events-none invisible absolute right-0 top-full z-20 mt-2 w-[320px] rounded-xl bg-[#171717] p-3 opacity-0 shadow-2xl transition-all duration-150 group-hover:visible group-hover:opacity-100">
                  <Text as="p" className="text-[12px] leading-5 text-[#c7c7c7]">This 12-word phrase is your vault root key. Keep it private and offline.</Text>
                </View>
              </View>
            </View>
            <View className="rounded-2xl border border-[#2b2b2b] bg-[#101010] p-4">
              <Text as="p" className="text-[14px] leading-6 text-[#efefef]">
                {phraseRevealed ? generatedMnemonic?.phrase ?? "" : "•••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• ••••••"}
              </Text>
            </View>
            <Pressable disabled={busy || !generatedMnemonic} onPress={revealCopyOrContinue} className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${!generatedMnemonic || busy ? "bg-[#2c2c2c]" : "bg-[#f2f2f2]"}`}>
              <Text as="p" className={`text-[16px] font-semibold ${!generatedMnemonic || busy ? "text-[#7e7e7e]" : "text-[#101010]"}`}>
                {busy ? "Working…" : phraseCopied ? "Continue" : "Reveal & copy"}
              </Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => setFlow("create_profile")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">Back</Text>
            </Pressable>
          </>
        ) : null}

        {/* ── Desktop: create email ── */}
        {!isWeb && flow === "create_email" ? (
          <>
            <TextInput autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Email (optional)" placeholderTextColor="rgba(255,255,255,0.24)" value={contactEmail} onChangeText={setContactEmail} className={inputCls} />
            <Text as="p" className="mt-2 text-[13px] text-[#9a9a9a]">Optional — not linked to your vault. For cloud sync, use Settings → Enable cloud sync.</Text>
            <Pressable disabled={busy} onPress={finishCreateVault} className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${busy ? "bg-[#2c2c2c]" : "bg-[#f2f2f2]"}`}>
              <Text as="p" className={`text-[16px] font-semibold ${busy ? "text-[#7e7e7e]" : "text-[#101010]"}`}>{busy ? "Finishing…" : "Finish"}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => setFlow("create_phrase")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">Back</Text>
            </Pressable>
          </>
        ) : null}

        {/* ── Desktop: PIN ── */}
        {!isWeb && flow === "pin" ? (
          <>
            <Text as="p" className="mb-2 text-center text-[14px] text-[#8f8f8f]">{profileName ? `Welcome back, ${profileName}` : "Enter your PIN"}</Text>
            <TextInput placeholder="PIN" placeholderTextColor="rgba(255,255,255,0.24)" value={pinValue} onChangeText={setPinValue} secureTextEntry keyboardType="numeric" maxLength={16} className={inputCls} />
            <Pressable disabled={busy || pinValue.trim().length < 4} onPress={unlockWithPin} className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${!busy && pinValue.trim().length >= 4 ? "bg-[#f2f2f2]" : "bg-[#2c2c2c]"}`}>
              <Text as="p" className={`text-[16px] font-semibold ${!busy && pinValue.trim().length >= 4 ? "text-[#101010]" : "text-[#7e7e7e]"}`}>{busy ? "Unlocking…" : "Unlock with PIN"}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setPinValue(""); setError(null); setFlow("unlock"); }} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">Use recovery phrase instead</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setError(null); setInfo(null); setFlow("reset_confirm"); }} className="mt-2">
              <Text as="p" className="text-center text-[12px] text-[#555555]">Forgot PIN / Reset vault</Text>
            </Pressable>
          </>
        ) : null}

        {/* ── Desktop: unlock with phrase ── */}
        {!isWeb && flow === "unlock" ? (
          <>
            <View className="relative">
              <View className="pointer-events-none absolute inset-y-0 left-4 flex items-center justify-center"><CircleUserRound size={18} color="#4a4a4a" /></View>
              <TextInput placeholder="12-word mnemonic phrase" placeholderTextColor="rgba(255,255,255,0.24)" value={unlockPhrase} onChangeText={setUnlockPhrase} className={`${inputCls} pl-12`} />
            </View>
            <Pressable disabled={busy || !normalizePhrase(unlockPhrase).length} onPress={unlock} className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${!busy && normalizePhrase(unlockPhrase).length ? "bg-[#f2f2f2]" : "bg-[#2c2c2c]"}`}>
              <Text as="p" className={`w-full text-center text-[16px] font-semibold ${!busy && normalizePhrase(unlockPhrase).length ? "text-[#101010]" : "text-[#7e7e7e]"}`}>{busy ? "Unlocking…" : "Unlock"}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => setFlow(hasPin ? "pin" : "entry")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">{hasPin ? "Back to PIN" : "Back"}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setError(null); setInfo(null); setFlow("reset_confirm"); }} className="mt-2">
              <Text as="p" className="text-center text-[12px] text-[#555555]">Forgot phrase / Reset vault</Text>
            </Pressable>
          </>
        ) : null}

        {/* ── Desktop: reset confirm ── */}
        {!isWeb && flow === "reset_confirm" ? (
          <>
            <Text as="p" className="mb-1 text-center text-[17px] font-semibold text-[#f2f2f2]">Reset vault?</Text>
            <Text as="p" className="mb-4 text-center text-[13px] leading-5 text-[#8f8f8f]">This will permanently delete all local data. Your data can only be recovered with your 12-word phrase. This cannot be undone.</Text>
            <Pressable disabled={busy} onPress={forgotReset} className={`flex h-12 w-full items-center justify-center rounded-2xl ${busy ? "bg-[#2c2c2c]" : "bg-[#7f1d1d]"}`}>
              <Text as="p" className="text-[16px] font-semibold text-[#fca5a5]">{busy ? "Resetting…" : "Delete & reset vault"}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => setFlow(profileExists ? (hasPin ? "pin" : "unlock") : "entry")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">Cancel</Text>
            </Pressable>
          </>
        ) : null}

        {/* ── Feedback messages ── */}
        <View className="gap-2 pt-4">
          {configError ? (
            <View className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3">
              <Text as="p" className="text-[13px] leading-5 text-red-100/85">{configError}</Text>
            </View>
          ) : null}
          {error ? (
            <View className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3">
              <Text as="p" className="text-[13px] leading-5 text-red-100/85">{error}</Text>
            </View>
          ) : null}
          {info && !(isWeb && flow === "otp_sent") ? (
            <View className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
              <Text as="p" className="text-[13px] leading-5 text-white/56">{info}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}
