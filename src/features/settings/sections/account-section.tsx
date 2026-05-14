import { useEffect, useMemo, useRef, useState } from "react";

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

export function AccountSection() {
  const { runtime, userEmail } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!runtime) return;
      const avatar = await readStoredAvatar(runtime);
      if (!active) return;
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
    </SettingsSectionShell>
  );
}
