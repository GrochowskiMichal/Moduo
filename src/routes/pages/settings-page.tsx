import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import type { CalendarAccount, CalendarSource } from "../../features/calendar/types";
import { CALENDAR_ACCOUNTS_UPDATED_EVENT, readLocalAccounts, readLocalSources, writeLocalAccounts, writeLocalSources } from "../../features/calendar/hooks/use-calendar";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { useAuth } from "../../providers/auth-provider";
import { Image, Pressable, Text } from "../../tw";
import defaultProfilePic from "../../../assets/icon.png";
import { notifyProfileUpdated, readStoredAvatar, writeStoredAvatar } from "../../features/profile/profile-storage";

type SettingsSection = "profile" | "login-key" | "ai" | "integrations";

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
  const [section, setSection] = useState<SettingsSection>(() => {
    if (typeof window !== "undefined") {
      const s = new URLSearchParams(window.location.search).get("section");
      if (s === "integrations") return "integrations";
    }
    return "profile";
  });
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
  const [aiCredentials, setAiCredentials] = useState<Array<{ id: string; model: string; keyPreview: string }>>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  type IntegrationStatus = { provider: string; connected: boolean };
  const [calAccounts, setCalAccounts] = useState<CalendarAccount[]>([]);
  const [calSources, setCalSources] = useState<CalendarSource[]>([]);
  const [calBusy, setCalBusy] = useState<string | null>(null);
  const [calError, setCalError] = useState<string | null>(null);
  const [videoStatuses, setVideoStatuses] = useState<IntegrationStatus[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoBusy, setVideoBusy] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

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

  useEffect(() => {
    let active = true;
    const loadAi = async () => {
      if (!runtime) return;
      setAiLoading(true);
      try {
        const rows = await runtime.ai.listCredentials();
        if (!active) return;
        setAiCredentials(rows);
      } catch (error) {
        if (!active) return;
        setAiError(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setAiLoading(false);
      }
    };
    void loadAi();
    return () => {
      active = false;
    };
  }, [runtime]);

  useEffect(() => {
    if (section !== "integrations") return;
    setCalAccounts(readLocalAccounts());
    setCalSources(readLocalSources());
    const loadVideo = async () => {
      setVideoLoading(true);
      setVideoError(null);
      try {
        const result = await invoke<IntegrationStatus[]>("integration_get_status");
        setVideoStatuses(result);
      } catch (e) {
        setVideoError(e instanceof Error ? e.message : String(e));
      } finally {
        setVideoLoading(false);
      }
    };
    void loadVideo();
  }, [section]);

  useEffect(() => {
    const handler = () => { setCalAccounts(readLocalAccounts()); setCalSources(readLocalSources()); };
    window.addEventListener(CALENDAR_ACCOUNTS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CALENDAR_ACCOUNTS_UPDATED_EVENT, handler);
  }, []);

  const handleConnectGoogleCalendar = async () => {
    setCalBusy("google");
    setCalError(null);
    try {
      const result = await invoke<{ accountId: string; email: string; displayName: string; calendars: { id: string; name: string; color: string }[] }>("calendar_google_oauth_start");
      const newAccount: CalendarAccount = { id: result.accountId, provider: "google", email: result.email, displayName: result.displayName, connected: true, lastSyncAt: new Date().toISOString() };
      const newSrcs: CalendarSource[] = result.calendars.map((c) => ({ id: c.id, accountId: result.accountId, name: c.name, color: c.color || "#4285f4", visible: true }));
      const cur = readLocalAccounts();
      const idx = cur.findIndex((a) => a.id === newAccount.id);
      const nextAccounts = idx === -1 ? [...cur, newAccount] : cur.map((a, i) => (i === idx ? newAccount : a));
      const curSrcs = readLocalSources();
      const byId = new Map(curSrcs.map((s) => [s.id, s]));
      for (const s of newSrcs) byId.set(s.id, s);
      const nextSources = Array.from(byId.values());
      writeLocalAccounts(nextAccounts);
      writeLocalSources(nextSources);
      setCalAccounts(nextAccounts);
      setCalSources(nextSources);
      window.dispatchEvent(new CustomEvent(CALENDAR_ACCOUNTS_UPDATED_EVENT));
    } catch (e) {
      setCalError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalBusy(null);
    }
  };

  const handleDisconnectCalendarAccount = (accountId: string) => {
    const nextAccounts = readLocalAccounts().filter((a) => a.id !== accountId);
    const nextSources = readLocalSources().filter((s) => s.accountId !== accountId);
    writeLocalAccounts(nextAccounts);
    writeLocalSources(nextSources);
    setCalAccounts(nextAccounts);
    setCalSources(nextSources);
    window.dispatchEvent(new CustomEvent(CALENDAR_ACCOUNTS_UPDATED_EVENT));
  };

  const handleVideoConnect = async (provider: "zoom" | "google_meet") => {
    setVideoBusy(provider);
    setVideoError(null);
    try {
      await invoke(provider === "zoom" ? "integration_connect_zoom" : "integration_connect_google_meet");
      setVideoStatuses(await invoke<IntegrationStatus[]>("integration_get_status"));
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : String(e));
    } finally {
      setVideoBusy(null);
    }
  };

  const handleVideoDisconnect = async (provider: string) => {
    setVideoBusy(provider);
    setVideoError(null);
    try {
      await invoke("integration_disconnect", { provider });
      setVideoStatuses(await invoke<IntegrationStatus[]>("integration_get_status"));
    } catch (e) {
      setVideoError(e instanceof Error ? e.message : String(e));
    } finally {
      setVideoBusy(null);
    }
  };

  const saveAiCredential = async () => {
    if (!runtime) return;
    const apiKey = openRouterApiKey.trim();
    const model = openRouterModel.trim();
    if (!apiKey || !model) {
      setAiError("OpenRouter API key and model are required.");
      return;
    }
    setAiBusy(true);
    setAiMessage(null);
    setAiError(null);
    try {
      const saved = await runtime.ai.saveCredential({ apiKey, model });
      setAiCredentials((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
      setOpenRouterApiKey("");
      setOpenRouterModel("");
      setAiMessage("Saved.");
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    } finally {
      setAiBusy(false);
    }
  };

  const deleteAiCredential = async (id: string) => {
    if (!runtime) return;
    setAiError(null);
    try {
      await runtime.ai.deleteCredential(id);
      setAiCredentials((current) => current.filter((entry) => entry.id !== id));
    } catch (error) {
      setAiError(error instanceof Error ? error.message : String(error));
    }
  };

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
      <Pressable
        className={`rounded-lg px-3 py-2 text-left ${section === "integrations" ? "bg-[#242424]" : "bg-transparent hover:bg-[#1b1b1b]"}`}
        onPress={() => setSection("integrations")}
      >
        <Text className={`text-[14px] ${section === "integrations" ? "text-[#f1f1f1]" : "text-[#adadad]"}`}>Integrations</Text>
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
          onChange={(event) => {
            setOpenRouterApiKey(event.target.value);
            setAiError(null);
            setAiMessage(null);
          }}
          placeholder="sk-or-v1-..."
          className="h-11 w-full rounded-xl border border-[#2b2b2b] bg-[#0f0f0f] px-4 text-[15px] text-[#ececec] outline-none focus:border-[#3a3a3a]"
        />
      </div>

      <div className="max-w-[760px]">
        <Text className="mb-2 text-[12px] uppercase tracking-[0.06em] text-[#8c8c8c]">Model name</Text>
        <input
          type="text"
          value={openRouterModel}
          onChange={(event) => {
            setOpenRouterModel(event.target.value);
            setAiError(null);
            setAiMessage(null);
          }}
          placeholder="anthropic/claude-3.5-sonnet"
          className="h-11 w-full rounded-xl border border-[#2b2b2b] bg-[#0f0f0f] px-4 text-[15px] text-[#ececec] outline-none focus:border-[#3a3a3a]"
        />
      </div>

      <div className="flex items-center gap-3">
        <Pressable
          className={`rounded-lg px-4 py-2 ${aiBusy ? "bg-[#2e2e2e]" : "bg-[#f0f0f0] hover:bg-[#ffffff]"}`}
          disabled={aiBusy}
          onPress={() => void saveAiCredential()}
        >
          <Text className={`text-[13px] font-semibold ${aiBusy ? "text-[#9d9d9d]" : "text-[#111111]"}`}>{aiBusy ? "Saving..." : "Save"}</Text>
        </Pressable>
        {aiMessage ? <Text className="text-[12px] text-[#8ddc96]">{aiMessage}</Text> : null}
        {aiError ? <Text className="text-[12px] text-[#ff9d9d]">{aiError}</Text> : null}
      </div>

      <div className="mt-2 rounded-xl border border-[#2b2b2b] bg-[#0f0f0f] p-3">
        <Text className="mb-2 text-[12px] uppercase tracking-[0.06em] text-[#8c8c8c]">Saved credentials</Text>
        {aiLoading ? <Text className="text-[12px] text-[#8f8f8f]">Loading...</Text> : null}
        {!aiLoading && aiCredentials.length === 0 ? <Text className="text-[12px] text-[#8f8f8f]">No saved credentials yet.</Text> : null}
        <div className="grid gap-2">
          {aiCredentials.map((entry) => (
            <div key={entry.id} className="flex items-center justify-between rounded-lg border border-[#252525] bg-[#121212] px-3 py-2">
              <div className="min-w-0">
                <Text className="truncate text-[13px] text-[#e5e5e5]">{entry.model}</Text>
                <Text className="text-[11px] text-[#929292]">{entry.keyPreview}</Text>
              </div>
              <Pressable
                className="rounded-md border border-[#2c2c2c] bg-[#1b1b1b] px-2 py-1 hover:bg-[#222222]"
                onPress={() => void deleteAiCredential(entry.id)}
              >
                <Text className="text-[11px] text-[#d5d5d5]">Delete</Text>
              </Pressable>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const centerIntegrations = (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-5 rounded-2xl border border-[#242424] bg-[#131313] p-6">
      <div>
        <Text className="text-[30px] font-semibold text-[#f3f3f3]">Integrations</Text>
        <Text className="mt-2 text-[16px] text-[#b5b5b5]">Connect your calendars and video meeting tools.</Text>
      </div>

      {/* Calendar Connections */}
      <div className="flex flex-col gap-3">
        <Text className="text-[13px] font-medium uppercase tracking-wider text-[#666]">Calendar</Text>
        <div className="rounded-xl border border-[#242424] bg-[#0e0e0e] p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="6" y="6" width="36" height="36" rx="4" fill="white"/>
                <rect x="14" y="2" width="4" height="10" rx="2" fill="#4285F4"/>
                <rect x="30" y="2" width="4" height="10" rx="2" fill="#4285F4"/>
                <rect x="6" y="18" width="36" height="2" fill="#e0e0e0"/>
                <rect x="22" y="26" width="12" height="10" rx="2" fill="#4285F4"/>
              </svg>
              <div>
                <Text className="text-[14px] font-medium text-[#f1f1f1]">Google Calendar</Text>
                <Text className="text-[12px] text-[#666]">{calAccounts.filter((a) => a.provider === "google").length > 0 ? `${calAccounts.filter((a) => a.provider === "google").length} account(s) connected` : "Not connected"}</Text>
              </div>
            </div>
            <Pressable
              className="rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-1.5 hover:bg-[#242424] disabled:opacity-50"
              onPress={handleConnectGoogleCalendar}
              isDisabled={calBusy === "google"}
            >
              <Text className="text-[13px] text-[#f1f1f1]">{calBusy === "google" ? "Connecting…" : "Connect account"}</Text>
            </Pressable>
          </div>
          {calAccounts.filter((a) => a.provider === "google").length > 0 && (
            <div className="mt-3 flex flex-col gap-2 border-t border-[#1e1e1e] pt-3">
              {calAccounts.filter((a) => a.provider === "google").map((acc) => (
                <div key={acc.id} className="flex items-center justify-between rounded-lg bg-[#131313] px-3 py-2">
                  <div>
                    <Text className="text-[13px] text-[#f1f1f1]">{acc.email}</Text>
                    {calSources.filter((s) => s.accountId === acc.id).length > 0 && (
                      <Text className="text-[11px] text-[#666]">
                        {calSources.filter((s) => s.accountId === acc.id).map((s) => s.name).join(", ")}
                      </Text>
                    )}
                  </div>
                  <Pressable
                    className="rounded px-2 py-1 text-[12px] text-[#f87171] hover:bg-[#2a1a1a]"
                    onPress={() => handleDisconnectCalendarAccount(acc.id)}
                  >
                    <Text className="text-[12px] text-[#f87171]">Disconnect</Text>
                  </Pressable>
                </div>
              ))}
            </div>
          )}
          {calError && <Text className="mt-2 text-[12px] text-[#f87171]">{calError}</Text>}
        </div>
      </div>

      {/* Video Meetings */}
      <div className="flex flex-col gap-3">
        <Text className="text-[13px] font-medium uppercase tracking-wider text-[#666]">Video Meetings</Text>
        {videoError && <Text className="text-[12px] text-[#f87171]">{videoError}</Text>}
        {(["zoom", "google_meet"] as const).map((provider) => {
          const status = videoStatuses.find((s) => s.provider === provider);
          const connected = status?.connected ?? false;
          const busy = videoBusy === provider;
          const label = provider === "zoom" ? "Zoom" : "Google Meet";
          const icon = provider === "zoom" ? (
            <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="48" height="48" rx="10" fill="#2D8CFF"/>
              <path d="M8 16h20a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z" fill="white"/>
              <path d="M32 19l12-7v24l-12-7V19z" fill="white"/>
            </svg>
          ) : (
            <svg width="24" height="24" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect width="48" height="48" rx="10" fill="#00897B"/>
              <path d="M12 16h16a4 4 0 0 1 4 4v8a4 4 0 0 1-4 4H12a4 4 0 0 1-4-4v-8a4 4 0 0 1 4-4z" fill="white"/>
              <path d="M32 19l12-7v24l-12-7V19z" fill="white"/>
            </svg>
          );
          return (
            <div key={provider} className="flex items-center justify-between rounded-xl border border-[#242424] bg-[#0e0e0e] px-4 py-3">
              <div className="flex items-center gap-3">
                {icon}
                <div>
                  <Text className="text-[14px] font-medium text-[#f1f1f1]">{label}</Text>
                  <Text className="text-[12px] text-[#666]">{videoLoading ? "Loading…" : connected ? "Connected" : "Not connected"}</Text>
                </div>
              </div>
              {connected ? (
                <Pressable
                  className="rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-1.5 hover:bg-[#2a1a1a] disabled:opacity-50"
                  onPress={() => void handleVideoDisconnect(provider)}
                  isDisabled={busy}
                >
                  <Text className="text-[13px] text-[#f87171]">{busy ? "Disconnecting…" : "Disconnect"}</Text>
                </Pressable>
              ) : (
                <Pressable
                  className="rounded-lg border border-[#333] bg-[#1a1a1a] px-3 py-1.5 hover:bg-[#242424] disabled:opacity-50"
                  onPress={() => void handleVideoConnect(provider)}
                  isDisabled={busy || videoLoading}
                >
                  <Text className="text-[13px] text-[#f1f1f1]">{busy ? "Connecting…" : "Connect"}</Text>
                </Pressable>
              )}
            </div>
          );
        })}
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
          {section === "profile" ? centerProfile : section === "login-key" ? centerLoginKey : section === "ai" ? centerAi : centerIntegrations}
        </div>
      }
    />
  );
}
