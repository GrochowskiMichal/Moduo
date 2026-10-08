import { ArrowLeft, CircleHelp, CircleUserRound, Mail, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Eyebrow } from "@/components/ui/eyebrow";
import { Input } from "@/components/ui/input";
import { ModuoMark } from "@/components/ui/moduo-mark";
import { notifyProfileUpdated, writeStoredAvatar } from "@/features/profile/profile-storage";
import type { AuthMnemonic } from "@/lib/runtime";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import defaultProfilePic from "../../../assets/icon.png";
import {
  describeOtpSendError,
  formatCountdown,
  OTP_RESEND_SECONDS,
  OTP_VALID_MINUTES,
} from "./otp-send-error";

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

function normalizePhrase(value: string) {
  return value
    .split(/\s+/)
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export type EmailAuthPanelProps = {
  /** Shown on the email step only, e.g. after an emailed auth link was dropped at boot. */
  notice?: string | null;
};

export function EmailAuthPanel({ notice }: EmailAuthPanelProps) {
  const { runtime, configError } = useAuth();
  // Cloud auth (email OTP) is the default on web AND desktop (cloud-first).
  // The vault flows below only activate on runtimes that expose a local
  // mnemonic — i.e. the future offline/lite runtime.
  const cloudAuth = !runtime?.capabilities.hasLocalMnemonic;
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<Flow>("entry");

  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);
  // The address the last code went to, and when another may be asked for (TX-2, AC9).
  const [otpSentTo, setOtpSentTo] = useState<string | null>(null);
  const [resendAt, setResendAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());

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

  useEffect(() => {
    if (!runtime) {
      setLoading(false);
      return;
    }
    let active = true;

    const run = async () => {
      setLoading(true);
      if (cloudAuth) {
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
    return () => {
      active = false;
    };
  }, [runtime, cloudAuth]);

  useEffect(() => {
    if (typeof window === "undefined" || !avatarDataUrl) return;
    void writeStoredAvatar(runtime, avatarDataUrl).then(() => notifyProfileUpdated());
  }, [avatarDataUrl, runtime]);

  // Tick once a second while the resend countdown runs.
  useEffect(() => {
    if (resendAt === null || resendAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= resendAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendAt]);

  const resendSecondsLeft =
    resendAt === null ? 0 : Math.max(0, Math.ceil((resendAt - clock) / 1000));

  const avatarInitial = useMemo(() => profileName.trim().slice(0, 1).toUpperCase(), [profileName]);

  const handleSendOtp = async () => {
    if (!runtime || busy) return;
    const email = otpEmail.trim().toLowerCase();
    if (!email) {
      setError("Enter your email address.");
      return;
    }

    // The code sent moments ago still works: go back to it rather than asking
    // Auth again inside its one-a-minute limit.
    if (flow === "email" && email === otpSentTo && resendAt !== null && Date.now() < resendAt) {
      setError(null);
      setInfo(null);
      setFlow("otp_sent");
      return;
    }

    setBusy(true);
    setError(null);
    setInfo(null);
    const sentAt = Date.now();
    const { error: otpErr } = await runtime.auth.sendOtp({ email });
    setBusy(false);
    if (otpErr) {
      const failure = describeOtpSendError(otpErr);
      if (failure.kind === "wait") {
        const until = Date.now() + failure.seconds * 1000;
        setResendAt(until);
        setClock(Date.now());
        // A code for this address went out moments ago: let them type it.
        if (email === otpSentTo) {
          setFlow("otp_sent");
          return;
        }
      }
      setError(failure.message);
      return;
    }
    setOtpSentAt(sentAt);
    setOtpSentTo(email);
    setResendAt(sentAt + OTP_RESEND_SECONDS * 1000);
    setClock(Date.now());
    setFlow("otp_sent");
  };

  const handleVerifyOtp = async () => {
    if (!runtime || busy) return;
    const code = otpCode.trim();
    if (code.length !== 6) {
      setError("Enter the 6-digit code from your email.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
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

    let hasWorkspace = false;
    try {
      const workspaces = await runtime.workspace.list();
      hasWorkspace = workspaces.length > 0;
    } catch {
      hasWorkspace = false;
    }

    const shouldOnboard = !!data.isNewUser || !hasWorkspace;
    window.sessionStorage.removeItem("moduo:auth_resolving");

    if (shouldOnboard) {
      window.location.href = "/onboarding";
      return;
    }

    window.location.href = "/";
  };

  const handleResendOtp = async () => {
    if (resendSecondsLeft > 0) return;
    setOtpCode("");
    setError(null);
    setInfo(null);
    await handleSendOtp();
  };

  const continueFromCreateProfile = async () => {
    if (!runtime || busy) return;
    if (!profileName.trim()) {
      setError("Full name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const { data, error: generateError } = await runtime.auth.generateMnemonic();
    setBusy(false);
    if (generateError) {
      setError(generateError.message);
      return;
    }
    setGeneratedMnemonic(data);
    setPhraseRevealed(false);
    setPhraseCopied(false);
    setFlow("create_phrase");
  };

  const revealCopyOrContinue = async () => {
    if (!generatedMnemonic || busy) return;
    if (phraseCopied) {
      setFlow("create_email");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    setPhraseRevealed(true);
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(generatedMnemonic.phrase);
        setInfo("12-word phrase copied to clipboard.");
      } else {
        setInfo("Clipboard unavailable — copy the phrase manually.");
      }
      setPhraseCopied(true);
    } catch {
      setInfo("Could not copy automatically — copy the phrase manually.");
      setPhraseCopied(true);
    } finally {
      setBusy(false);
    }
  };

  const forgotReset = async () => {
    if (!runtime || busy) return;
    setBusy(true);
    setError(null);
    const { error: resetError } = await runtime.auth.forgotResetLocal();
    setBusy(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    setProfileExists(false);
    setHasPin(false);
    setPinValue("");
    setUnlockPhrase("");
    setProfileName("");
    setFlow("create_profile");
    setInfo("Vault reset. Create a new vault to continue.");
  };

  const finishCreateVault = async () => {
    if (!generatedMnemonic || !runtime || busy) return;
    if (!profileName.trim()) {
      setError("Full name is required.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: regError } = await runtime.auth.registerLocalMnemonic({
      displayName: profileName.trim(),
      mnemonicPhrase: generatedMnemonic.phrase,
    });
    setBusy(false);
    if (regError) setError(regError.message);
  };

  const unlock = async () => {
    if (!runtime || busy || !normalizePhrase(unlockPhrase).length) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: unlockError } = await runtime.auth.unlockWithMnemonic({
      mnemonicPhrase: unlockPhrase,
    });
    setBusy(false);
    if (unlockError) setError(unlockError.message);
  };

  const unlockWithPin = async () => {
    if (!runtime || busy || pinValue.trim().length < 4) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    const { error: pinError } = await runtime.auth.unlockWithPin(pinValue.trim());
    setBusy(false);
    if (pinError) setError(pinError.message);
  };

  const panelTitle =
    cloudAuth && flow === "otp_sent"
      ? "Check your email"
      : cloudAuth && flow === "email"
        ? "Log in or create account"
        : cloudAuth
          ? "Continue"
          : profileExists
            ? "Unlock your vault"
            : "Create your vault";

  const panelSubtitle =
    cloudAuth && flow === "otp_sent"
      ? `Enter the six-digit code we sent. It works for ${OTP_VALID_MINUTES} minutes.`
      : cloudAuth && flow === "email"
        ? "We’ll email you a secure code to continue."
        : cloudAuth
          ? ""
          : profileExists
            ? "Use your PIN or recovery phrase to continue."
            : "Your local vault stays private on this device.";

  const openAvatarPicker = () => avatarInputRef.current?.click();

  const onAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Profile picture must be an image file.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Profile picture is too large (max 4 MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setAvatarDataUrl(result);
      setError(null);
    };
    reader.readAsDataURL(file);
  };

  const smallAvatar = (
    <div className="mx-auto mb-4 mt-1">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onAvatarChange}
      />
      <button
        type="button"
        onClick={openAvatarPicker}
        className="group relative rounded-avatar outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label="Choose profile picture"
      >
        <Avatar className="size-14 border border-border">
          <AvatarImage src={avatarDataUrl ?? defaultProfilePic} alt="" />
          <AvatarFallback className="font-display text-lg">{avatarInitial || "?"}</AvatarFallback>
        </Avatar>
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="relative z-10 flex w-full flex-col items-center">
        <ModuoMark className="mb-8 size-10 opacity-95" aria-hidden="true" />
        <p className="text-center text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  return (
    <div className="relative z-10 w-full">
      <div className="mb-7 flex w-full flex-col items-center">
        <ModuoMark
          className={cn("size-8 opacity-95", cloudAuth && flow === "otp_sent" ? "mb-10" : "mb-6")}
          aria-hidden="true"
        />
        {cloudAuth && flow === "otp_sent" ? (
          <div className="relative w-full px-10">
            <button
              type="button"
              aria-label="Back to email"
              onClick={() => {
                setFlow("email");
                setOtpCode("");
                setError(null);
                setInfo(null);
              }}
              className="absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-md p-1 text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-5" />
            </button>
            <h1 className="w-full text-center font-display text-3xl font-semibold leading-tight tracking-tight text-foreground">
              Check your email
            </h1>
          </div>
        ) : (
          <h1 className="w-full text-center font-display text-3xl font-semibold leading-tight tracking-tight text-foreground">
            {panelTitle}
          </h1>
        )}
        {panelSubtitle ? (
          <p className="mx-auto mt-2 max-w-[300px] text-center text-sm leading-5 text-muted-foreground">
            {panelSubtitle}
          </p>
        ) : null}
        {notice && cloudAuth && flow === "email" ? (
          <p
            role="status"
            className="mx-auto mt-4 max-w-[300px] rounded-md bg-muted px-3 py-2 text-center text-sm leading-5 text-foreground"
          >
            {notice}
          </p>
        ) : null}
      </div>

      <div className="w-full">
        {cloudAuth && flow === "email" ? (
          <div className="w-full">
            <div className="relative w-full">
              <Mail
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                type="email"
                autoCapitalize="none"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={otpEmail}
                onChange={(e) => {
                  setOtpEmail(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && otpEmail.trim() && !busy) void handleSendOtp();
                }}
                className="pl-10"
              />
            </div>

            <Button
              size="lg"
              className="mt-5 w-full"
              disabled={busy || !otpEmail.trim()}
              onClick={handleSendOtp}
            >
              {busy ? "Sending…" : "Continue with email"}
            </Button>
          </div>
        ) : null}

        {cloudAuth && flow === "otp_sent" ? (
          <div className="w-full">
            <div className="flex flex-col gap-4">
              <Input
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                placeholder="000000"
                value={otpCode}
                maxLength={6}
                onChange={(e) => {
                  setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6));
                  setError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && otpCode.length === 6 && !busy) void handleVerifyOtp();
                }}
                className="text-center font-mono text-2xl font-semibold tabular-nums tracking-[0.4em]"
              />

              <Button
                size="lg"
                className="w-full"
                disabled={busy || otpCode.length !== 6}
                onClick={handleVerifyOtp}
              >
                {busy ? "Verifying…" : "Continue"}
              </Button>
            </div>

            <Button
              variant="link"
              size="sm"
              disabled={busy || resendSecondsLeft > 0}
              onClick={handleResendOtp}
              className="mx-auto mt-8 block text-muted-foreground tabular-nums hover:text-foreground"
            >
              {resendSecondsLeft > 0 ? (
                `Resend in ${formatCountdown(resendSecondsLeft)}`
              ) : (
                <>
                  Didn't receive it? <span className="ml-1 underline">Resend code</span>
                </>
              )}
            </Button>
          </div>
        ) : null}

        {!cloudAuth && flow === "entry" ? (
          <div className="flex flex-col gap-3">
            {!profileExists ? (
              <Button
                size="lg"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  setFlow("create_profile");
                }}
              >
                Create vault
              </Button>
            ) : null}
            {profileExists ? (
              <Button
                size="lg"
                className="w-full"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  setFlow("unlock");
                }}
              >
                Unlock vault
              </Button>
            ) : null}
            {profileExists ? (
              <Button
                variant="outline"
                size="lg"
                className="w-full text-muted-foreground"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setInfo(null);
                  setFlow("reset_confirm");
                }}
              >
                Forgot phrase / Reset vault
              </Button>
            ) : null}
          </div>
        ) : null}

        {!cloudAuth && flow === "create_profile" ? (
          <div className="flex flex-col gap-3">
            {smallAvatar}
            <div className="relative">
              <UserPlus
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="Profile name"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
                className="pl-10"
              />
            </div>
            <Button
              size="lg"
              className="w-full"
              disabled={busy || !profileName.trim()}
              onClick={continueFromCreateProfile}
            >
              {busy ? "Preparing…" : "Continue"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setFlow("entry")}
              className="mx-auto text-muted-foreground"
            >
              Back
            </Button>
          </div>
        ) : null}

        {!cloudAuth && flow === "create_phrase" ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <Eyebrow tone="strong">12-word phrase</Eyebrow>
              <div className="group relative">
                <button
                  type="button"
                  aria-label="Why mnemonic phrase"
                  className="grid size-7 place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <CircleHelp className="size-4" />
                </button>
                <div className="pointer-events-none invisible absolute right-0 top-full z-20 mt-2 w-[320px] rounded-xl border border-border bg-popover p-3 text-popover-foreground opacity-0 shadow-lg transition-all duration-[var(--motion-base)] group-hover:visible group-hover:opacity-100">
                  <p className="text-xs leading-5 text-muted-foreground">
                    This 12-word phrase is your vault root key. Keep it private and offline.
                  </p>
                </div>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted p-4">
              <p className="font-mono text-sm leading-6 text-foreground">
                {phraseRevealed
                  ? (generatedMnemonic?.phrase ?? "")
                  : "•••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• ••••••"}
              </p>
            </div>
            <Button
              size="lg"
              className="w-full"
              disabled={busy || !generatedMnemonic}
              onClick={revealCopyOrContinue}
            >
              {busy ? "Working…" : phraseCopied ? "Continue" : "Reveal & copy"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setFlow("create_profile")}
              className="mx-auto text-muted-foreground"
            >
              Back
            </Button>
          </div>
        ) : null}

        {!cloudAuth && flow === "create_email" ? (
          <div className="flex flex-col gap-3">
            <Input
              type="email"
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              placeholder="Email (optional)"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Optional — not linked to your vault. For cloud sync, use Settings → Enable cloud sync.
            </p>
            <Button size="lg" className="w-full" disabled={busy} onClick={finishCreateVault}>
              {busy ? "Finishing…" : "Finish"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setFlow("create_phrase")}
              className="mx-auto text-muted-foreground"
            >
              Back
            </Button>
          </div>
        ) : null}

        {!cloudAuth && flow === "pin" ? (
          <div className="flex flex-col gap-3">
            <p className="text-center text-sm text-muted-foreground">
              {profileName ? `Welcome back, ${profileName}` : "Enter your PIN"}
            </p>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="PIN"
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && pinValue.trim().length >= 4 && !busy) void unlockWithPin();
              }}
              maxLength={16}
            />
            <Button
              size="lg"
              className="w-full"
              disabled={busy || pinValue.trim().length < 4}
              onClick={unlockWithPin}
            >
              {busy ? "Unlocking…" : "Unlock with PIN"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setPinValue("");
                setError(null);
                setFlow("unlock");
              }}
              className="mx-auto text-muted-foreground"
            >
              Use recovery phrase instead
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setError(null);
                setInfo(null);
                setFlow("reset_confirm");
              }}
              className="mx-auto text-xs text-muted-foreground/70 hover:text-muted-foreground"
            >
              Forgot PIN / Reset vault
            </Button>
          </div>
        ) : null}

        {!cloudAuth && flow === "unlock" ? (
          <div className="flex flex-col gap-3">
            <div className="relative">
              <CircleUserRound
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                placeholder="12-word mnemonic phrase"
                value={unlockPhrase}
                onChange={(e) => setUnlockPhrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && normalizePhrase(unlockPhrase).length && !busy)
                    void unlock();
                }}
                className="pl-10"
              />
            </div>
            <Button
              size="lg"
              className="w-full"
              disabled={busy || !normalizePhrase(unlockPhrase).length}
              onClick={unlock}
            >
              {busy ? "Unlocking…" : "Unlock"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setFlow(hasPin ? "pin" : "entry")}
              className="mx-auto text-muted-foreground"
            >
              {hasPin ? "Back to PIN" : "Back"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setError(null);
                setInfo(null);
                setFlow("reset_confirm");
              }}
              className="mx-auto text-xs text-muted-foreground/70 hover:text-muted-foreground"
            >
              Forgot phrase / Reset vault
            </Button>
          </div>
        ) : null}

        {!cloudAuth && flow === "reset_confirm" ? (
          <div className="flex flex-col gap-3">
            <p className="text-center font-display text-base font-semibold text-foreground">
              Reset vault?
            </p>
            <p className="text-center text-sm leading-5 text-muted-foreground">
              This will permanently delete all local data. Your data can only be recovered with your
              12-word phrase. This cannot be undone.
            </p>
            <Button
              variant="destructive"
              size="lg"
              className="w-full"
              disabled={busy}
              onClick={forgotReset}
            >
              {busy ? "Resetting…" : "Delete & reset vault"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setFlow(profileExists ? (hasPin ? "pin" : "unlock") : "entry")}
              className="mx-auto text-muted-foreground"
            >
              Cancel
            </Button>
          </div>
        ) : null}

        <div className="flex flex-col gap-2 pt-4">
          {configError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3">
              <p className="text-sm leading-5 text-destructive">{configError}</p>
            </div>
          ) : null}
          {error ? (
            <div
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3"
            >
              <p className="text-sm leading-5 text-destructive">{error}</p>
            </div>
          ) : null}
          {info && !(cloudAuth && flow === "otp_sent") ? (
            <div role="status" className="rounded-md border border-border bg-muted px-4 py-3">
              <p className="text-sm leading-5 text-muted-foreground">{info}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
