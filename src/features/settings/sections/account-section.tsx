import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";

import { useAuth } from "../../../providers/auth-provider";
import {
  notifyProfileUpdated,
  readStoredAvatar,
  writeStoredAvatar,
} from "../../profile/profile-storage";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import defaultProfilePic from "../../../../assets/icon.png";

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
  const { runtime, userEmail } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

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

  return (
    <SettingsSectionShell
      title="Account"
      description="Your profile and recovery key. These stay on this device."
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
    </SettingsSectionShell>
  );
}
