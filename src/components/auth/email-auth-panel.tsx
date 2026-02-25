import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, CircleUserRound, UserPlus } from "lucide-react";
import { Image, Pressable, Text, TextInput, View } from "../../tw";
import moduoLogoWhite from "../../../assets/moduo_logo_white.svg";
import defaultProfilePic from "../../../assets/icon.png";
import { useAuth } from "../../providers/auth-provider";
import type { AuthMnemonic } from "../../lib/runtime";

type Flow = "entry" | "create_profile" | "create_phrase" | "create_email" | "unlock" | "pin" | "reset_confirm";
const AVATAR_STORAGE_KEY = "moduo:auth-avatar-preview-v1";
const AVATAR_STORE_NAMESPACE = "auth_ui";
const AVATAR_STORE_KEY = "avatar_preview_v1";

function normalizePhrase(value: string) {
  return value
    .split(/\s+/)
    .map((word) => word.trim().toLowerCase())
    .filter(Boolean)
    .join(" ");
}

export function EmailAuthPanel() {
  const { runtime, configError } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [flow, setFlow] = useState<Flow>("entry");
  const [profileExists, setProfileExists] = useState(false);
  const [hasPin, setHasPin] = useState(false);
  const [hasKeychainMnemonic, setHasKeychainMnemonic] = useState(false);
  const [pinValue, setPinValue] = useState("");

  const [profileName, setProfileName] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [contactEmail, setContactEmail] = useState("");

  const [generatedMnemonic, setGeneratedMnemonic] = useState<AuthMnemonic | null>(null);
  const [phraseRevealed, setPhraseRevealed] = useState(false);
  const [phraseCopied, setPhraseCopied] = useState(false);
  const [unlockPhrase, setUnlockPhrase] = useState("");

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
      const { data, error } = await runtime.auth.getLocalAuthState();
      if (!active) return;
      if (error) {
        setError(error.message);
      } else {
        setProfileExists(data.profileExists);
        setHasPin(data.hasPin);
        setHasKeychainMnemonic(data.hasKeychainMnemonic);
        if (data.displayName) setProfileName(data.displayName);
        // Route directly to PIN unlock if profile+PIN exist (auto-unlock
        // already failed in AuthProvider, so we know keychain is unavailable).
        if (data.profileExists && data.hasPin) {
          setFlow("pin");
        } else {
          setFlow("entry");
        }
      }
      setLoading(false);
    };

    void run();
    return () => {
      active = false;
    };
  }, [runtime]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const persistAvatar = async () => {
      if (!avatarDataUrl) {
        window.localStorage.removeItem(AVATAR_STORAGE_KEY);
        if (runtime) {
          await runtime.localStore.remove(AVATAR_STORE_NAMESPACE, AVATAR_STORE_KEY).catch(() => {});
        }
        return;
      }
      window.localStorage.setItem(AVATAR_STORAGE_KEY, avatarDataUrl);
      if (runtime) {
        await runtime.localStore.set(AVATAR_STORE_NAMESPACE, AVATAR_STORE_KEY, avatarDataUrl).catch(() => {});
      }
    };
    void persistAvatar();
  }, [avatarDataUrl, runtime]);

  const canUnlock = !!runtime && normalizePhrase(unlockPhrase).length > 0 && !busy;
  const avatarInitial = useMemo(() => profileName.trim().slice(0, 1).toUpperCase(), [profileName]);

  const goToCreateProfile = () => {
    if (profileExists) {
      setError(null);
      setInfo(null);
      setFlow("reset_confirm");
      return;
    }
    setError(null);
    setInfo(null);
    setFlow("create_profile");
  };

  const goToUnlock = () => {
    setError(null);
    setInfo(null);
    setFlow("unlock");
  };

  const continueFromCreateProfile = async () => {
    if (!runtime || busy) return;
    if (!profileName.trim()) {
      setError("Full name is required.");
      return;
    }
    if (!runtime || busy) return;
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
        setInfo("Clipboard unavailable. Copy the 12-word phrase manually.");
      }
      setPhraseCopied(true);
    } catch (e) {
      setInfo("Could not copy automatically. Copy the 12-word phrase manually.");
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
    setHasKeychainMnemonic(false);
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

    // registerLocalMnemonic emits SIGNED_IN via the runtime — AuthProvider
    // picks it up and navigates to the app. No sign-out needed.
    const { error: regError } = await runtime.auth.registerLocalMnemonic({
      displayName: profileName.trim(),
      mnemonicPhrase: generatedMnemonic.phrase,
    });

    setBusy(false);
    if (regError) {
      setError(regError.message);
    }
  };

  const unlock = async () => {
    if (!canUnlock) return;
    setBusy(true);
    setError(null);
    setInfo(null);

    const { error: unlockError } = await runtime!.auth.unlockWithMnemonic({
      mnemonicPhrase: unlockPhrase,
    });
    setBusy(false);
    if (unlockError) {
      setError(unlockError.message);
    }
    // On success AuthProvider navigates away via SIGNED_IN event.
  };

  const unlockWithPin = async () => {
    if (!runtime || busy || pinValue.trim().length < 4) return;
    setBusy(true);
    setError(null);
    setInfo(null);

    const { error: pinError } = await runtime.auth.unlockWithPin(pinValue.trim());
    setBusy(false);
    if (pinError) {
      setError(pinError.message);
    }
    // On success AuthProvider navigates away via SIGNED_IN event.
  };

  const inputClass =
    "h-13 w-full appearance-none rounded-2xl border border-[#1b1b1b] bg-[#090909] px-5 text-[15px] text-[#f1f1f1] outline-none focus:border-[#2c2c2c] focus:outline-none focus:ring-0";

  const openAvatarPicker = () => {
    avatarInputRef.current?.click();
  };

  const onAvatarChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Profile picture must be an image file.");
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      setError("Profile picture is too large. Use file up to 4MB.");
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
    <View className="mx-auto mb-4 mt-1">
      <input
        ref={avatarInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={onAvatarChange}
      />
      <Pressable
        onPress={openAvatarPicker}
        className="relative h-[58px] w-[58px] overflow-hidden rounded-full border border-[#2a2a2a] bg-[#090909]"
      >
        <Image
          source={avatarDataUrl ? { uri: avatarDataUrl } : defaultProfilePic}
          className={`h-full w-full ${avatarDataUrl ? "opacity-100" : "opacity-30"}`}
          contentFit="cover"
        />
        {!avatarDataUrl && avatarInitial ? (
          <View className="absolute inset-0 items-center justify-center bg-[linear-gradient(180deg,rgba(8,8,8,0.2),rgba(8,8,8,0.72))]">
            <Text as="p" className="text-[20px] font-semibold text-[#f2f2f2]">
              {avatarInitial}
            </Text>
          </View>
        ) : null}
      </Pressable>
    </View>
  );

  if (loading) {
    return (
      <View className="relative z-10 w-full max-w-[560px] px-1 sm:px-2">
        <Image source={moduoLogoWhite} className="mx-auto mb-10 h-[88px] w-[340px] opacity-95" contentFit="contain" />
        <Text as="p" className="text-center text-[15px] text-[#8e8e8e]">
          Loading local auth...
        </Text>
      </View>
    );
  }

  return (
    <View className="relative z-10 w-full max-w-[560px] px-1 sm:px-2">
      <Image source={moduoLogoWhite} className="mx-auto mb-8 h-[88px] w-[340px] opacity-95" contentFit="contain" />

      <View className="w-full">
        {flow === "entry" ? (
          <View className="gap-3">
            {!profileExists ? (
              <Pressable
                disabled={busy}
                onPress={goToCreateProfile}
                className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#f2f2f2]"
              >
                <Text as="p" className="text-[16px] font-semibold text-[#101010]">
                  Create vault
                </Text>
              </Pressable>
            ) : null}
            {profileExists ? (
              <Pressable
                disabled={busy}
                onPress={goToUnlock}
                className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#f2f2f2]"
              >
                <Text as="p" className="text-[16px] font-semibold text-[#101010]">
                  Unlock vault
                </Text>
              </Pressable>
            ) : null}
            {profileExists ? (
              <Pressable
                disabled={busy}
                onPress={() => { setError(null); setInfo(null); setFlow("reset_confirm"); }}
                className="flex h-12 w-full items-center justify-center rounded-2xl border border-[#2b2b2b] bg-[#101010]"
              >
                <Text as="p" className="text-[13px] text-[#6e6e6e]">
                  Forgot phrase / Reset vault
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {flow === "create_profile" ? (
          <>
            {smallAvatar}

            <View className="relative">
              <View className="pointer-events-none absolute inset-y-0 left-4 flex items-center justify-center">
                <UserPlus size={18} color="#4a4a4a" />
              </View>
              <TextInput
                placeholder="Profile name"
                placeholderTextColor="#6f6f6f"
                value={profileName}
                onChangeText={setProfileName}
                className={`${inputClass} pl-12`}
              />
            </View>

            <Pressable
              disabled={busy || !profileName.trim()}
              onPress={continueFromCreateProfile}
              className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${profileName.trim() && !busy ? "bg-[#f2f2f2]" : "bg-[#2c2c2c]"}`}
            >
              <Text
                as="p"
                className={`w-full text-center text-[16px] font-semibold ${profileName.trim() && !busy ? "text-[#101010]" : "text-[#7e7e7e]"}`}
              >
                {busy ? "Preparing..." : "Continue"}
              </Text>
            </Pressable>

            <Pressable disabled={busy} onPress={() => setFlow("entry")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">
                Back
              </Text>
            </Pressable>
          </>
        ) : null}

        {flow === "create_phrase" ? (
          <>
            <View className="mb-2 flex items-center justify-between px-1">
              <Text as="p" className="text-[12px] font-bold uppercase tracking-widest text-[#8f8f8f]">
                12-word phrase
              </Text>
              <View className="group relative">
                <Pressable
                  aria-label="Why mnemonic phrase"
                  className="grid h-7 w-7 place-items-center rounded-full text-[#8d8d8d] hover:bg-[#1a1a1a] hover:text-[#d7d7d7]"
                >
                  <CircleHelp size={15} />
                </Pressable>
                <View className="pointer-events-none invisible absolute right-0 top-full z-20 mt-2 w-[320px] rounded-xl bg-[#171717] p-3 opacity-0 shadow-2xl transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
                  <Text as="p" className="text-[12px] leading-5 text-[#c7c7c7]">
                    This 12-word phrase is your vault root key. It is processed locally with strong one-way crypto, so no reusable
                    password is sent to a server. Compared with password-only logins, it has higher entropy and a smaller remote
                    attack surface. Keep it private and offline.
                  </Text>
                </View>
              </View>
            </View>
            <View className="rounded-2xl border border-[#2b2b2b] bg-[#101010] p-4">
              <Text as="p" className="text-[14px] leading-6 text-[#efefef]">
                {phraseRevealed ? generatedMnemonic?.phrase ?? "" : "•••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• ••••••"}
              </Text>
            </View>

            <Pressable
              disabled={busy || !generatedMnemonic}
              onPress={revealCopyOrContinue}
              className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${!generatedMnemonic || busy ? "bg-[#2c2c2c]" : "bg-[#f2f2f2]"}`}
            >
              <Text as="p" className={`text-[16px] font-semibold ${!generatedMnemonic || busy ? "text-[#7e7e7e]" : "text-[#101010]"}`}>
                {busy ? "Working..." : phraseCopied ? "Continue" : "Reveal & copy"}
              </Text>
            </Pressable>

            <Pressable disabled={busy} onPress={() => setFlow("create_profile")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">
                Back
              </Text>
            </Pressable>
          </>
        ) : null}

        {flow === "create_email" ? (
          <>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              placeholder="Email (not associated with this account)"
              placeholderTextColor="#6f6f6f"
              value={contactEmail}
              onChangeText={setContactEmail}
              className={inputClass}
            />
            <Text as="p" className="mt-2 text-[13px] text-[#9a9a9a]">
              This email is informational only for now and will not be saved.
            </Text>

            <Pressable
              disabled={busy}
              onPress={finishCreateVault}
              className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${busy ? "bg-[#2c2c2c]" : "bg-[#f2f2f2]"}`}
            >
              <Text as="p" className={`text-[16px] font-semibold ${busy ? "text-[#7e7e7e]" : "text-[#101010]"}`}>
                {busy ? "Finishing..." : "Finish"}
              </Text>
            </Pressable>

            <Pressable disabled={busy} onPress={() => setFlow("create_phrase")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">
                Back
              </Text>
            </Pressable>
          </>
        ) : null}

        {flow === "pin" ? (
          <>
            <Text as="p" className="mb-2 text-center text-[14px] text-[#8f8f8f]">
              {profileName ? `Welcome back, ${profileName}` : "Enter your PIN"}
            </Text>
            <TextInput
              placeholder="PIN"
              placeholderTextColor="#6f6f6f"
              value={pinValue}
              onChangeText={setPinValue}
              secureTextEntry
              keyboardType="numeric"
              maxLength={16}
              className={inputClass}
            />

            <Pressable
              disabled={busy || pinValue.trim().length < 4}
              onPress={unlockWithPin}
              className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${!busy && pinValue.trim().length >= 4 ? "bg-[#f2f2f2]" : "bg-[#2c2c2c]"}`}
            >
              <Text as="p" className={`text-[16px] font-semibold ${!busy && pinValue.trim().length >= 4 ? "text-[#101010]" : "text-[#7e7e7e]"}`}>
                {busy ? "Unlocking..." : "Unlock with PIN"}
              </Text>
            </Pressable>

            <Pressable disabled={busy} onPress={() => { setPinValue(""); setError(null); setFlow("unlock"); }} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">
                Use recovery phrase instead
              </Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setError(null); setInfo(null); setFlow("reset_confirm"); }} className="mt-2">
              <Text as="p" className="text-center text-[12px] text-[#555555]">
                Forgot PIN / Reset vault
              </Text>
            </Pressable>
          </>
        ) : null}

        {flow === "unlock" ? (
          <>
            <View className="relative">
              <View className="pointer-events-none absolute inset-y-0 left-4 flex items-center justify-center">
                <CircleUserRound size={18} color="#4a4a4a" />
              </View>
              <TextInput
                placeholder="12-word mnemonic phrase"
                placeholderTextColor="#6f6f6f"
                value={unlockPhrase}
                onChangeText={setUnlockPhrase}
                className={`${inputClass} pl-12`}
              />
            </View>

            <Pressable
              disabled={!canUnlock}
              onPress={unlock}
              className={`mt-3 flex h-12 w-full items-center justify-center rounded-2xl ${canUnlock ? "bg-[#f2f2f2]" : "bg-[#2c2c2c]"}`}
            >
              <Text as="p" className={`w-full text-center text-[16px] font-semibold ${canUnlock ? "text-[#101010]" : "text-[#7e7e7e]"}`}>
                {busy ? "Unlocking..." : "Unlock"}
              </Text>
            </Pressable>

            <Pressable disabled={busy} onPress={() => setFlow(hasPin ? "pin" : "entry")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">
                {hasPin ? "Back to PIN" : "Back"}
              </Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => { setError(null); setInfo(null); setFlow("reset_confirm"); }} className="mt-2">
              <Text as="p" className="text-center text-[12px] text-[#555555]">
                Forgot phrase / Reset vault
              </Text>
            </Pressable>
          </>
        ) : null}

        {flow === "reset_confirm" ? (
          <>
            <Text as="p" className="mb-1 text-center text-[17px] font-semibold text-[#f2f2f2]">
              Reset vault?
            </Text>
            <Text as="p" className="mb-4 text-center text-[13px] leading-5 text-[#8f8f8f]">
              This will permanently delete all local data. Your data can only be recovered if you have your 12-word phrase. This cannot be undone.
            </Text>
            <Pressable
              disabled={busy}
              onPress={forgotReset}
              className={`flex h-12 w-full items-center justify-center rounded-2xl ${busy ? "bg-[#2c2c2c]" : "bg-[#7f1d1d]"}`}
            >
              <Text as="p" className="text-[16px] font-semibold text-[#fca5a5]">
                {busy ? "Resetting..." : "Delete & reset vault"}
              </Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => setFlow(profileExists ? (hasPin ? "pin" : "unlock") : "entry")} className="mt-3">
              <Text as="p" className="text-center text-[13px] text-[#8f8f8f]">
                Cancel
              </Text>
            </Pressable>
          </>
        ) : null}

        <View className="gap-1.5 pt-3">
          {configError ? <Text as="p" className="text-[14px] text-[#ffb3b3]">{configError}</Text> : null}
          {error ? <Text as="p" className="text-[14px] text-[#ffb3b3]">{error}</Text> : null}
          {info ? <Text as="p" className="text-[14px] text-[#a6a6a6]">{info}</Text> : null}
        </View>
      </View>
    </View>
  );
}
