import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, LogOut } from "lucide-react";

import { useAuth } from "../../../providers/auth-provider";
import { supabaseClient } from "../../../lib/runtime.web";
import {
  notifyProfileUpdated,
  readStoredAvatar,
  writeStoredAvatar,
} from "../../profile/profile-storage";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import defaultProfilePic from "../../../../assets/icon.png";

import { isPasswordProvider, providerLabel, validateNewPassword } from "../account";
import { SettingsSectionShell } from "./section-shell";

function maskedPhrase(phrase: string | null) {
  if (!phrase) {
    return "•••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• ••••••";
  }
  return phrase
    .split(/\s+/)
    .filter(Boolean)
    .map(() => "••••••")
    .join(" ");
}

export function AccountSection() {
  const { runtime, userEmail, signOut } = useAuth();
  const navigate = useNavigate();
  // The recovery-key section only applies to local-vault runtimes (future lite).
  const hasLocalKey = !!runtime?.capabilities.hasLocalMnemonic;
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  const [provider, setProvider] = useState<string | null>(null);
  const [providerLoaded, setProviderLoaded] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwMessage, setPwMessage] = useState<string | null>(null);
  const [pwError, setPwError] = useState<string | null>(null);

  const [isPhraseVisible, setIsPhraseVisible] = useState(false);
  const [mnemonicPhrase, setMnemonicPhrase] = useState<string | null>(null);
  const [phraseLoading, setPhraseLoading] = useState(false);
  const [phraseError, setPhraseError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!runtime) return;
      const [{ data }, avatar] = await Promise.all([
        runtime.auth.getLocalAuthState(),
        readStoredAvatar(runtime),
      ]);
      if (!active) return;
      setDisplayName(data.displayName ?? "");
      setAvatarDataUrl(avatar);
    };
    void load();
    return () => {
      active = false;
    };
  }, [runtime]);

  // Cloud accounts: learn the sign-in provider so we know whether a password is
  // even applicable (OAuth-only accounts have none). Future-lite (local vault)
  // accounts skip this — they authenticate with the login key below.
  useEffect(() => {
    if (hasLocalKey) return;
    let active = true;
    // Read the provider from the CACHED session (no network round-trip) so an
    // OAuth-only account never flashes the wrong provider + a password form it
    // can't use before the value resolves. Nothing provider-dependent renders
    // until `providerLoaded`.
    void supabaseClient.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setProvider(data.session?.user?.app_metadata?.provider ?? null);
        setProviderLoaded(true);
      })
      .catch(() => {
        if (active) setProviderLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [hasLocalKey]);

  const avatarInitial = useMemo(
    () =>
      displayName.trim().slice(0, 1).toUpperCase() ||
      userEmail?.trim().slice(0, 1).toUpperCase() ||
      "U",
    [displayName, userEmail],
  );

  const handleAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setProfileError("Profile picture must be an image file.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setProfileError("Profile picture is too large. Use file up to 4MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setAvatarDataUrl(result);
      setProfileError(null);
      setProfileMessage(null);
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    if (!runtime) return;
    const normalized = displayName.trim();
    if (!normalized) {
      setProfileError("Name is required.");
      return;
    }

    setProfileBusy(true);
    setProfileError(null);
    setProfileMessage(null);
    const updated = await runtime.auth.updateDisplayName(normalized);
    if (updated.error) {
      setProfileBusy(false);
      setProfileError(updated.error.message);
      return;
    }

    await writeStoredAvatar(runtime, avatarDataUrl);
    notifyProfileUpdated();
    setProfileBusy(false);
    setProfileMessage("Profile updated.");
  };

  const togglePhraseVisibility = async () => {
    if (!runtime) return;
    if (isPhraseVisible) {
      setIsPhraseVisible(false);
      return;
    }
    if (!mnemonicPhrase) {
      setPhraseLoading(true);
      setPhraseError(null);
      const result = await runtime.auth.getStoredMnemonic();
      setPhraseLoading(false);
      if (result.error) {
        setPhraseError(result.error.message);
        return;
      }
      if (!result.data.phrase) {
        setPhraseError("No key found in keychain for this profile.");
        return;
      }
      setMnemonicPhrase(result.data.phrase);
    }
    setIsPhraseVisible(true);
  };

  const handleLogout = async () => {
    try {
      await signOut();
    } finally {
      void navigate({ to: "/auth" });
    }
  };

  const canChangePassword = isPasswordProvider(provider);

  const handleChangePassword = async () => {
    const validationError = validateNewPassword(newPassword, confirmPassword);
    if (validationError) {
      setPwError(validationError);
      setPwMessage(null);
      return;
    }
    setPwBusy(true);
    setPwError(null);
    setPwMessage(null);
    const { error } = await supabaseClient.auth.updateUser({ password: newPassword });
    setPwBusy(false);
    if (error) {
      setPwError(error.message);
      return;
    }
    setNewPassword("");
    setConfirmPassword("");
    setPwMessage("Password updated.");
  };

  return (
    <SettingsSectionShell
      title="Account"
      description={
        hasLocalKey
          ? "Your profile and recovery key. These stay on this device."
          : "Your profile and sign-in details."
      }
    >
      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg text-foreground">Profile</h3>
        <p className="mt-1 text-sm text-muted-foreground">Manage your name and profile picture.</p>

        <div className="mt-5 flex items-center gap-4">
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handleAvatarChange}
          />
          <button
            type="button"
            onClick={() => avatarInputRef.current?.click()}
            className="relative h-16 w-16 overflow-hidden rounded-full border border-border bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
            aria-label="Change profile picture"
          >
            <img
              src={avatarDataUrl ?? defaultProfilePic}
              alt=""
              className={
                avatarDataUrl
                  ? "h-full w-full object-cover opacity-100"
                  : "h-full w-full object-cover opacity-30"
              }
            />
            {!avatarDataUrl ? (
              <span
                className="absolute inset-0 flex items-center justify-center font-display text-xl text-foreground"
                aria-hidden
              >
                {avatarInitial}
              </span>
            ) : null}
          </button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => avatarInputRef.current?.click()}
          >
            Change picture
          </Button>
        </div>

        <div className="mt-6 max-w-sm">
          <Label htmlFor="account-display-name">Name</Label>
          <Input
            id="account-display-name"
            value={displayName}
            onChange={(event) => {
              setDisplayName(event.target.value);
              setProfileError(null);
              setProfileMessage(null);
            }}
            placeholder="Your name"
            className="mt-2"
          />
        </div>

        <div className="mt-5 flex items-center gap-3">
          <Button onClick={() => void saveProfile()} disabled={profileBusy}>
            {profileBusy ? "Saving…" : "Save changes"}
          </Button>
          {profileMessage ? (
            <p className="text-xs text-success" role="status">
              {profileMessage}
            </p>
          ) : null}
          {profileError ? (
            <p className="text-xs text-destructive" role="alert">
              {profileError}
            </p>
          ) : null}
        </div>
      </section>

      {!hasLocalKey ? (
        <section className="rounded-lg border border-border bg-card p-6">
          <h3 className="font-display text-lg text-foreground">Sign-in</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {providerLoaded
              ? `You're signed in with ${providerLabel(provider)}.`
              : "You're signed in."}
          </p>

          <div className="mt-5 flex flex-col gap-1">
            <span className="text-2xs font-medium uppercase tracking-wide text-muted-foreground">
              Email
            </span>
            <span className="text-sm text-foreground">{userEmail ?? "—"}</span>
          </div>

          {!providerLoaded ? null : canChangePassword ? (
            <div className="mt-6 border-t border-border pt-6">
              <h4 className="text-sm font-medium text-foreground">Password</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                Set or change the password you use to sign in.
              </p>
              <div className="mt-4 flex max-w-sm flex-col gap-3">
                <div>
                  <Label htmlFor="account-new-password">New password</Label>
                  <Input
                    id="account-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                      setPwError(null);
                      setPwMessage(null);
                    }}
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="account-confirm-password">Confirm password</Label>
                  <Input
                    id="account-confirm-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      setPwError(null);
                      setPwMessage(null);
                    }}
                    className="mt-2"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => void handleChangePassword()}
                    disabled={pwBusy || newPassword.length === 0}
                  >
                    {pwBusy ? "Saving…" : "Update password"}
                  </Button>
                  {pwMessage ? (
                    <p className="text-xs text-success" role="status">
                      {pwMessage}
                    </p>
                  ) : null}
                  {pwError ? (
                    <p className="text-xs text-destructive" role="alert">
                      {pwError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-muted-foreground">
              You sign in with {providerLabel(provider)}, so there&apos;s no password to manage
              here.
            </p>
          )}
        </section>
      ) : null}

      {hasLocalKey ? (
      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg text-foreground">Login key</h3>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Your key protects this vault. You&apos;ll need it to sign in if you lose access to your
          devices. Keep it in a safe place.
        </p>

        <div className="mt-4 flex items-center gap-2 rounded-md border border-border bg-muted p-4">
          <p
            className={
              isPhraseVisible
                ? "min-w-0 flex-1 break-words font-mono text-sm text-foreground"
                : "min-w-0 flex-1 break-words font-mono text-sm text-muted-foreground blur-sm"
            }
          >
            {isPhraseVisible ? mnemonicPhrase ?? "" : maskedPhrase(mnemonicPhrase)}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => void togglePhraseVisibility()}
            disabled={phraseLoading}
            aria-label={isPhraseVisible ? "Hide login key" : "Show login key"}
          >
            {isPhraseVisible ? <EyeOff /> : <Eye />}
          </Button>
        </div>
        {phraseLoading ? (
          <p className="mt-2 text-xs text-muted-foreground">Reading key from keychain…</p>
        ) : null}
        {phraseError ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {phraseError}
          </p>
        ) : null}
      </section>
      ) : null}

      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-lg text-foreground">Session</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign out of Moduo on this device.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-4"
          onClick={() => void handleLogout()}
        >
          <LogOut className="size-4" aria-hidden />
          Log out
        </Button>
      </section>
    </SettingsSectionShell>
  );
}
