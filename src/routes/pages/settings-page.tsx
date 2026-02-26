import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { useAuth } from "../../providers/auth-provider";
import { Image, Pressable, Text } from "../../tw";
import defaultProfilePic from "../../../assets/icon.png";
import { notifyProfileUpdated, readStoredAvatar, writeStoredAvatar } from "../../features/profile/profile-storage";

type SettingsSection = "profile" | "login-key" | "ai";

function maskedPhrase(phrase: string | null) {
  if (!phrase) return "•••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• •••••• ••••••";
  return phrase
    .split(/\s+/)
    .filter(Boolean)
    .map(() => "••••••")
    .join(" ");
}

export function SettingsPage() {
  const { runtime, userEmail } = useAuth();
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const [section, setSection] = useState<SettingsSection>("profile");
  const [displayName, setDisplayName] = useState("");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [isPhraseVisible, setIsPhraseVisible] = useState(false);
  const [mnemonicPhrase, setMnemonicPhrase] = useState<string | null>(null);
  const [phraseLoading, setPhraseLoading] = useState(false);
  const [phraseError, setPhraseError] = useState<string | null>(null);
  const [openRouterApiKey, setOpenRouterApiKey] = useState("");
  const [openRouterModel, setOpenRouterModel] = useState("");

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
    [displayName, userEmail]
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

  const leftPanel = (
    <div className="flex h-full flex-col gap-2">
      <Text className="text-[13px] uppercase tracking-[0.08em] text-[#7f7f7f]">Settings</Text>
      <Pressable
        className={`rounded-lg px-3 py-2 text-left ${section === "profile" ? "bg-[#242424]" : "bg-transparent hover:bg-[#1b1b1b]"}`}
        onPress={() => setSection("profile")}
      >
        <Text className={`text-[14px] ${section === "profile" ? "text-[#f1f1f1]" : "text-[#adadad]"}`}>Profile</Text>
      </Pressable>
      <Pressable
        className={`rounded-lg px-3 py-2 text-left ${section === "login-key" ? "bg-[#242424]" : "bg-transparent hover:bg-[#1b1b1b]"}`}
        onPress={() => setSection("login-key")}
      >
        <Text className={`text-[14px] ${section === "login-key" ? "text-[#f1f1f1]" : "text-[#adadad]"}`}>Login Key</Text>
      </Pressable>
      <Pressable
        className={`rounded-lg px-3 py-2 text-left ${section === "ai" ? "bg-[#242424]" : "bg-transparent hover:bg-[#1b1b1b]"}`}
        onPress={() => setSection("ai")}
      >
        <Text className={`text-[14px] ${section === "ai" ? "text-[#f1f1f1]" : "text-[#adadad]"}`}>AI</Text>
      </Pressable>
    </div>
  );

  const centerProfile = (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 rounded-2xl border border-[#242424] bg-[#131313] p-6">
      <div>
        <Text className="text-[30px] font-semibold text-[#f3f3f3]">Profile</Text>
        <Text className="mt-2 text-[16px] text-[#b5b5b5]">Manage your name and profile picture.</Text>
      </div>

      <div className="flex items-center gap-4">
        <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} />
        <Pressable
          onPress={() => avatarInputRef.current?.click()}
          className="relative h-[72px] w-[72px] overflow-hidden rounded-full border border-[#2a2a2a] bg-[#090909]"
        >
          <Image
            source={avatarDataUrl ? { uri: avatarDataUrl } : defaultProfilePic}
            className={`h-full w-full ${avatarDataUrl ? "opacity-100" : "opacity-30"}`}
            contentFit="cover"
          />
          {!avatarDataUrl ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(180deg,rgba(8,8,8,0.2),rgba(8,8,8,0.72))]">
              <Text className="text-[24px] font-semibold text-[#f2f2f2]">{avatarInitial}</Text>
            </div>
          ) : null}
        </Pressable>
        <Pressable className="rounded-lg border border-[#2b2b2b] bg-[#181818] px-4 py-2 hover:bg-[#1d1d1d]" onPress={() => avatarInputRef.current?.click()}>
          <Text className="text-[13px] text-[#d8d8d8]">Change picture</Text>
        </Pressable>
      </div>

      <div className="max-w-[520px]">
        <Text className="mb-2 text-[12px] uppercase tracking-[0.06em] text-[#8c8c8c]">Name</Text>
        <input
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            setProfileError(null);
            setProfileMessage(null);
          }}
          placeholder="Your name"
          className="h-11 w-full rounded-xl border border-[#2b2b2b] bg-[#0f0f0f] px-4 text-[15px] text-[#ececec] outline-none focus:border-[#3a3a3a]"
        />
      </div>

      <div className="flex items-center gap-3">
        <Pressable
          className={`rounded-lg px-4 py-2 ${profileBusy ? "bg-[#2e2e2e]" : "bg-[#f0f0f0] hover:bg-[#ffffff]"}`}
          disabled={profileBusy}
          onPress={() => void saveProfile()}
        >
          <Text className={`text-[13px] font-semibold ${profileBusy ? "text-[#9d9d9d]" : "text-[#111111]"}`}>{profileBusy ? "Saving..." : "Save changes"}</Text>
        </Pressable>
        {profileMessage ? <Text className="text-[12px] text-[#8ddc96]">{profileMessage}</Text> : null}
        {profileError ? <Text className="text-[12px] text-[#ff9d9d]">{profileError}</Text> : null}
      </div>
    </div>
  );

  const centerLoginKey = (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 rounded-2xl border border-[#242424] bg-[#131313] p-6">
      <div>
        <Text className="text-[52px] font-semibold leading-none text-[#f3f3f3]">Login Key</Text>
        <Text className="mt-5 max-w-[760px] text-[16px] leading-[1.5] text-[#d0d0d0]">
          Your key protects your vault. You&apos;ll need it to sign in if you don&apos;t have access to your devices. Keep it in a safe place. Click to show:
        </Text>
      </div>

      <div className="flex items-center gap-2 rounded-3xl border border-[#252525] bg-[#1b1b1b] px-4 py-4">
        <Text className={`min-w-0 flex-1 break-all text-[20px] ${isPhraseVisible ? "text-[#f2f2f2]" : "text-[#b8b8b8] blur-[6px]"}`}>
          {isPhraseVisible ? mnemonicPhrase ?? "" : maskedPhrase(mnemonicPhrase)}
        </Text>
        <Pressable
          className="grid h-9 w-9 place-items-center rounded-full bg-transparent hover:bg-[#232323]"
          onPress={() => void togglePhraseVisibility()}
          disabled={phraseLoading}
        >
          {isPhraseVisible ? <EyeOff size={20} color="#9a9a9a" /> : <Eye size={20} color="#9a9a9a" />}
        </Pressable>
      </div>
      {phraseLoading ? <Text className="text-[12px] text-[#9a9a9a]">Reading key from keychain...</Text> : null}
      {phraseError ? <Text className="text-[12px] text-[#ff9d9d]">{phraseError}</Text> : null}
    </div>
  );

  const centerAi = (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 rounded-2xl border border-[#242424] bg-[#131313] p-6">
      <div>
        <Text className="text-[30px] font-semibold text-[#f3f3f3]">AI</Text>
        <Text className="mt-2 text-[16px] text-[#b5b5b5]">
          Configure OpenRouter connection values. For now, values are local to this screen only.
        </Text>
      </div>

      <div className="max-w-[760px]">
        <Text className="mb-2 text-[12px] uppercase tracking-[0.06em] text-[#8c8c8c]">OpenRouter API key</Text>
        <input
          type="password"
          value={openRouterApiKey}
          onChange={(event) => setOpenRouterApiKey(event.target.value)}
          placeholder="sk-or-v1-..."
          className="h-11 w-full rounded-xl border border-[#2b2b2b] bg-[#0f0f0f] px-4 text-[15px] text-[#ececec] outline-none focus:border-[#3a3a3a]"
        />
      </div>

      <div className="max-w-[760px]">
        <Text className="mb-2 text-[12px] uppercase tracking-[0.06em] text-[#8c8c8c]">Model name</Text>
        <input
          type="text"
          value={openRouterModel}
          onChange={(event) => setOpenRouterModel(event.target.value)}
          placeholder="anthropic/claude-3.5-sonnet"
          className="h-11 w-full rounded-xl border border-[#2b2b2b] bg-[#0f0f0f] px-4 text-[15px] text-[#ececec] outline-none focus:border-[#3a3a3a]"
        />
      </div>
    </div>
  );

  return (
    <FeaturePanelsShell
      feature="settings"
      hideRight
      left={leftPanel}
      center={
        <div className="h-full overflow-auto py-2">
          {section === "profile" ? centerProfile : section === "login-key" ? centerLoginKey : centerAi}
        </div>
      }
    />
  );
}
