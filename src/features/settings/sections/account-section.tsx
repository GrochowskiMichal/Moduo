import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, LogOut, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import defaultProfilePic from "../../../../assets/icon.png";
import { Button } from "../../../components/ui/button";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { SUPABASE_URL, supabaseClient } from "../../../lib/runtime.web";
import { useAuth } from "../../../providers/auth-provider";
import { validateImageFile } from "../../branding/image-asset";
import { ensureProfileAvatar } from "../../branding/profile-avatar";
import { clearProfileAvatar, uploadProfileAvatar } from "../../branding/upload-image";
import { forgetFocusUser } from "../../focus/engine";
import { notifyProfileUpdated, writeStoredAvatar } from "../../profile/profile-storage";
import { isPasswordProvider, providerLabel, validateNewPassword } from "../account";
import { matchesDeleteConfirm } from "../delete-account";
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
  const { runtime, userEmail, userId, signOut, accessToken } = useAuth();
  const navigate = useNavigate();
  // The recovery-key section only applies to local-vault runtimes (future lite).
  const hasLocalKey = !!runtime?.capabilities.hasLocalMnemonic;
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const avatarTouched = useRef(false);

  const [displayName, setDisplayName] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [pendingAvatar, setPendingAvatar] = useState<File | null>(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
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

  // Danger zone: delete account (DF-19h). The destructive work runs in the
  // service-role `delete-account` edge function; a sole-owner-of-shared block
  // comes back as 409 with the blocking workspaces.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [blockedWorkspaces, setBlockedWorkspaces] = useState<{ id: string; name: string }[] | null>(
    null,
  );

  const handleDeleteAccount = async () => {
    if (!accessToken || deleteBusy || !matchesDeleteConfirm(deleteConfirm, userEmail)) return;
    setDeleteBusy(true);
    setDeleteError(null);
    setBlockedWorkspaces(null);
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      const payload = (await res.json().catch(() => null)) as {
        ok?: boolean;
        blocked?: boolean;
        workspaces?: { id: string; name: string }[];
        error?: string;
      } | null;
      if (res.status === 409 && payload?.blocked) {
        setBlockedWorkspaces(payload.workspaces ?? []);
        return;
      }
      if (res.status === 401) {
        throw new Error("Your session expired. Sign out and back in, then try again.");
      }
      if (!res.ok || !payload?.ok) {
        throw new Error(payload?.error || "Couldn't delete your account. Try again.");
      }
      // Deleted — erase this device's focus session for the account (task
      // titles, unsaved time), then sign out locally and land on /auth.
      if (userId) forgetFocusUser(userId);
      await signOut();
      await navigate({ to: "/auth" });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Couldn't delete your account.");
    } finally {
      setDeleteBusy(false);
    }
  };

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!runtime) return;
      const [{ data }, avatar] = await Promise.all([
        runtime.auth.getLocalAuthState(),
        userId ? ensureProfileAvatar(runtime, userId) : Promise.resolve(null),
      ]);
      if (!active) return;
      setDisplayName(data.displayName ?? "");
      if (!avatarTouched.current) {
        setAvatarDataUrl(avatar);
        setPendingAvatar(null);
        setRemoveAvatar(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [runtime, userId]);

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
    avatarTouched.current = true;
    const problem = validateImageFile(file);
    if (problem) {
      setProfileError(problem);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : null;
      if (!result) return;
      setPendingAvatar(file);
      setRemoveAvatar(false);
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

    try {
      if (userId && pendingAvatar) {
        const url = await uploadProfileAvatar(userId, pendingAvatar);
        const saved = await runtime.auth.updateAvatarUrl(url);
        if (saved.error) throw new Error(saved.error.message);
        setAvatarDataUrl(url);
        setPendingAvatar(null);
        await writeStoredAvatar(runtime, null);
      } else if (userId && removeAvatar) {
        await clearProfileAvatar(userId).catch(() => {});
        const saved = await runtime.auth.updateAvatarUrl(null);
        if (saved.error) throw new Error(saved.error.message);
        setAvatarDataUrl(null);
        setRemoveAvatar(false);
        await writeStoredAvatar(runtime, null);
      } else if (!userId) {
        await writeStoredAvatar(runtime, avatarDataUrl);
      }
    } catch (err) {
      setProfileBusy(false);
      setProfileError(err instanceof Error ? err.message : "Couldn't save the profile picture.");
      return;
    }

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
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => avatarInputRef.current?.click()}
            >
              Change picture
            </Button>
            {avatarDataUrl ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  avatarTouched.current = true;
                  setPendingAvatar(null);
                  setRemoveAvatar(true);
                  setAvatarDataUrl(null);
                  setProfileError(null);
                  setProfileMessage(null);
                }}
              >
                Remove
              </Button>
            ) : null}
          </div>
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
            <Eyebrow>Email</Eyebrow>
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
              {isPhraseVisible ? (mnemonicPhrase ?? "") : maskedPhrase(mnemonicPhrase)}
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
        <p className="mt-1 text-sm text-muted-foreground">Sign out of Moduo on this device.</p>
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

      {/* Danger zone — delete account (cloud accounts only; local-vault future-lite
          authenticates with the login key and has no server account to delete). */}
      {!hasLocalKey ? (
        <section className="rounded-lg border border-destructive/40 bg-card p-6">
          <div className="flex items-center gap-2">
            <TriangleAlert className="size-4 text-destructive" aria-hidden />
            <h3 className="font-display text-lg text-foreground">Danger zone</h3>
          </div>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Permanently delete your account and your personal data. This also cancels your Moduo
            plan. This can&apos;t be undone.
          </p>

          {!deleteOpen ? (
            <Button
              type="button"
              variant="destructive"
              size="sm"
              className="mt-4"
              onClick={() => {
                setDeleteOpen(true);
                setDeleteConfirm("");
                setDeleteError(null);
                setBlockedWorkspaces(null);
              }}
            >
              Delete account
            </Button>
          ) : (
            <div className="mt-4 flex flex-col gap-3 rounded-md border border-destructive/30 bg-destructive/10 p-4">
              {blockedWorkspaces && blockedWorkspaces.length > 0 ? (
                <div className="flex flex-col gap-1.5 text-sm">
                  <p className="text-foreground">
                    You solely own {blockedWorkspaces.length === 1 ? "a workspace" : "workspaces"}{" "}
                    with other members. Hand off ownership or delete{" "}
                    {blockedWorkspaces.length === 1 ? "it" : "them"} first:
                  </p>
                  <ul className="ml-4 list-disc text-muted-foreground">
                    {blockedWorkspaces.map((ws) => (
                      <li key={ws.id}>{ws.name}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="delete-confirm" className="text-sm text-foreground">
                      Type your email or <span className="font-mono">DELETE</span> to confirm
                    </Label>
                    <Input
                      id="delete-confirm"
                      value={deleteConfirm}
                      onChange={(event) => setDeleteConfirm(event.target.value)}
                      placeholder={userEmail ?? "DELETE"}
                      autoFocus
                      autoCapitalize="none"
                      autoComplete="off"
                    />
                  </div>
                  {deleteError ? (
                    <p className="text-xs text-destructive" role="alert">
                      {deleteError}
                    </p>
                  ) : null}
                </>
              )}
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setDeleteOpen(false);
                    setDeleteConfirm("");
                    setDeleteError(null);
                    setBlockedWorkspaces(null);
                  }}
                  disabled={deleteBusy}
                >
                  {blockedWorkspaces && blockedWorkspaces.length > 0 ? "Close" : "Cancel"}
                </Button>
                {blockedWorkspaces && blockedWorkspaces.length > 0 ? null : (
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    onClick={() => void handleDeleteAccount()}
                    disabled={deleteBusy || !matchesDeleteConfirm(deleteConfirm, userEmail)}
                  >
                    {deleteBusy ? "Deleting…" : "Delete account"}
                  </Button>
                )}
              </div>
            </div>
          )}
        </section>
      ) : null}
    </SettingsSectionShell>
  );
}
