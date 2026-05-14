import { useEffect, useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";

import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { ModuoMark } from "@/src/components/ui/moduo-mark";
import { useAuth } from "@/src/providers/auth-provider";

type Flow = "email" | "otp_sent";

interface Props {
  priceId?: string | null;
}

export function EmailAuthPanel({ priceId = null }: Props) {
  const { runtime, configError } = useAuth();

  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<Flow>("email");

  const [otpEmail, setOtpEmail] = useState("");
  const [otpCode, setOtpCode] = useState("");
  const [otpSentAt, setOtpSentAt] = useState<number | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    setFlow("email");
    setLoading(false);
  }, [runtime]);

  const handleSendOtp = async () => {
    if (!runtime || busy) return;
    const email = otpEmail.trim().toLowerCase();
    if (!email) {
      setError("Enter your email address.");
      return;
    }
    setBusy(true);
    setError(null);
    setInfo(null);
    const sentAt = Date.now();
    const { error: otpErr } = await runtime.auth.sendOtp({ email });
    setBusy(false);
    if (otpErr) {
      setError(otpErr.message);
      return;
    }
    setOtpSentAt(sentAt);
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
    setOtpCode("");
    setError(null);
    setInfo(null);
    await handleSendOtp();
  };

  const panelTitle = flow === "otp_sent" ? "Check your email" : "Log in or create account";
  const panelSubtitle =
    flow === "otp_sent"
      ? "Enter the six-digit code we sent. It expires shortly."
      : "We'll email you a secure code to continue.";

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
          className={flow === "otp_sent" ? "mb-10 size-8 opacity-95" : "mb-6 size-8 opacity-95"}
          aria-hidden="true"
        />
        {flow === "otp_sent" ? (
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
      </div>

      <div className="w-full">
        {flow === "email" ? (
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

        {flow === "otp_sent" ? (
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
              disabled={busy}
              onClick={handleResendOtp}
              className="mx-auto mt-8 block text-muted-foreground hover:text-foreground"
            >
              Didn't receive it? <span className="ml-1 underline">Resend code</span>
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
          {info && flow !== "otp_sent" ? (
            <div role="status" className="rounded-md border border-border bg-muted px-4 py-3">
              <p className="text-sm leading-5 text-muted-foreground">{info}</p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
