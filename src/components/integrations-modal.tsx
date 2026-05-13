import { useEffect, useState } from "react";
import { Modal, Pressable, Text, View } from "../tw";
import { useAuth } from "../providers/auth-provider";

type IntegrationStatusItem = {
  provider: string;
  connected: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
};

const PROVIDERS: { id: "zoom" | "google_meet"; label: string; description: string }[] = [
  {
    id: "zoom",
    label: "Zoom",
    description: "Auto-create Zoom meetings for each video booking.",
  },
  {
    id: "google_meet",
    label: "Google Meet",
    description: "Auto-create Google Meet links via your Google Calendar.",
  },
];

const ZoomIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <path d="M15.5 8.5v7L20 18V6l-4.5 2.5zM4 8a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H4z" />
  </svg>
);

const MeetIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4V6.5l-4 4z" />
  </svg>
);

export function IntegrationsModal({ visible, onClose }: Props) {
  const { runtime } = useAuth();
  const [statuses, setStatuses] = useState<IntegrationStatusItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!runtime) return;
    setLoading(true);
    try {
      const result = await runtime.integrations.getStatus();
      setStatuses(result);
    } catch (e) {
      console.error("[integrations] get_status failed", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible]);

  const isConnected = (provider: string) =>
    statuses.find((s) => s.provider === provider)?.connected ?? false;

  const handleConnect = async (provider: "zoom" | "google_meet") => {
    if (!runtime) return;
    setBusy(provider);
    setError(null);
    try {
      if (provider === "zoom") {
        await runtime.integrations.connectZoom();
      } else {
        await runtime.integrations.connectGoogleMeet();
      }
      await load();
    } catch (e) {
      const msg = typeof e === "string" ? e : "Connection failed";
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    if (!runtime) return;
    setBusy(provider);
    setError(null);
    try {
      await runtime.integrations.disconnect(provider);
      await load();
    } catch (e) {
      const msg = typeof e === "string" ? e : "Disconnect failed";
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <Pressable className="fixed inset-0 bg-black/50" onPress={onClose} />
      <View className="fixed inset-x-0 top-16 mx-auto w-[min(520px,92vw)] rounded-2xl border border-[#1e2533] bg-[#0f141d] p-5 z-[999]">
        {/* Header */}
        <View className="flex-row items-center justify-between border-b border-[#1f2a3a] pb-4 mb-4">
          <View>
            <Text className="text-[#edf1fa] text-[18px] font-semibold">Integrations</Text>
            <Text className="text-[#91a0ba] text-[12px] mt-0.5">
              Connect your video accounts to auto-generate meeting links on bookings.
            </Text>
          </View>
          <Pressable className="rounded-md border border-[#2c3547] px-3 py-2" onPress={onClose}>
            <Text className="text-[#d6ddeb] text-[12px]">Close</Text>
          </Pressable>
        </View>

        {loading ? (
          <View className="items-center py-8">
            <View className="h-5 w-5 rounded-full border-2 border-[#2a3547] border-t-[#5f7db5] animate-spin" />
          </View>
        ) : (
          <View className="gap-3">
            {PROVIDERS.map(({ id, label, description }) => {
              const connected = isConnected(id);
              const isBusy = busy === id;
              const Icon = id === "zoom" ? ZoomIcon : MeetIcon;

              return (
                <View
                  key={id}
                  className="flex-row items-center gap-4 rounded-xl border border-[#1d2534] bg-[#111824] p-4"
                >
                  <View
                    className={`h-10 w-10 rounded-xl items-center justify-center ${
                      connected ? "bg-[#1a2e1a] text-[#5ec97a]" : "bg-[#191f2d] text-[#5f7db5]"
                    }`}
                  >
                    <Icon />
                  </View>

                  <View className="flex-1">
                    <Text className="text-[#dce3f2] text-[14px] font-semibold">{label}</Text>
                    <Text className="text-[#91a0ba] text-[11px] mt-0.5">{description}</Text>
                  </View>

                  {connected ? (
                    <View className="flex-row items-center gap-2">
                      <View className="flex-row items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#162414] border border-[#203018]">
                        <View className="h-1.5 w-1.5 rounded-full bg-[#5ec97a]" />
                        <Text className="text-[#5ec97a] text-[10px] font-semibold">Connected</Text>
                      </View>
                      <Pressable
                        className="px-3 py-1.5 rounded-lg border border-[#2c3547] hover:bg-[#161d2a]"
                        onPress={() => { void handleDisconnect(id); }}
                        disabled={isBusy}
                      >
                        <Text className="text-[#91a0ba] text-[11px]">
                          {isBusy ? "…" : "Disconnect"}
                        </Text>
                      </Pressable>
                    </View>
                  ) : (
                    <Pressable
                      className="px-3 py-2 rounded-lg bg-[#1a2540] border border-[#243554] hover:bg-[#1f2c4d] disabled:opacity-50"
                      onPress={() => { void handleConnect(id); }}
                      disabled={isBusy}
                    >
                      <Text className="text-[#8baad4] text-[12px] font-semibold">
                        {isBusy ? "Connecting…" : "Connect"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
        )}

        {error ? (
          <View className="mt-3 rounded-xl border border-[#2a1818] bg-[#160e0e] px-4 py-2.5">
            <Text className="text-[11px] text-[#c06060]">{error}</Text>
          </View>
        ) : null}

        <View className="mt-4 rounded-lg bg-[#0c1119] border border-[#1a2030] px-4 py-3">
          <Text className="text-[10px] text-[#4a5568] leading-relaxed">
            Tokens are encrypted with AES-256-GCM and stored securely. Only your server-side booking
            API can decrypt them to create meetings. They are never sent to your browser.
          </Text>
        </View>
      </View>
    </Modal>
  );
}
