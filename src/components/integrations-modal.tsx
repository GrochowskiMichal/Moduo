import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Badge } from "./ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

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
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M15.5 8.5v7L20 18V6l-4.5 2.5zM4 8a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H4z" />
  </svg>
);

const MeetIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4V6.5l-4 4z" />
  </svg>
);

export function IntegrationsModal({ visible, onClose }: Props) {
  const [statuses, setStatuses] = useState<IntegrationStatusItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const result = await invoke<IntegrationStatusItem[]>("integration_get_status");
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
    setBusy(provider);
    setError(null);
    try {
      const cmd =
        provider === "zoom" ? "integration_connect_zoom" : "integration_connect_google_meet";
      await invoke(cmd);
      await load();
    } catch (e) {
      const msg = typeof e === "string" ? e : "Connection failed";
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  const handleDisconnect = async (provider: string) => {
    setBusy(provider);
    setError(null);
    try {
      await invoke("integration_disconnect", { provider });
      await load();
    } catch (e) {
      const msg = typeof e === "string" ? e : "Disconnect failed";
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={visible} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Integrations</DialogTitle>
          <DialogDescription>
            Connect your video accounts to auto-generate meeting links on bookings.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-border border-t-ring" />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {PROVIDERS.map(({ id, label, description }) => {
              const connected = isConnected(id);
              const isBusy = busy === id;
              const IconComp = id === "zoom" ? ZoomIcon : MeetIcon;

              return (
                <div
                  key={id}
                  className="flex flex-row items-center gap-4 rounded-lg border border-border bg-card p-4"
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                      connected ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <IconComp />
                  </div>

                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">{label}</p>
                    <p className="text-xs text-muted-foreground">{description}</p>
                  </div>

                  {connected ? (
                    <div className="flex flex-row items-center gap-2">
                      <Badge variant="success">Connected</Badge>
                      <button
                        type="button"
                        className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          void handleDisconnect(id);
                        }}
                        disabled={isBusy}
                      >
                        {isBusy ? "…" : "Disconnect"}
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card"
                      onClick={() => {
                        void handleConnect(id);
                      }}
                      disabled={isBusy}
                    >
                      {isBusy ? "Connecting…" : "Connect"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {error ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="text-xs text-destructive">{error}</p>
          </div>
        ) : null}

        <div className="rounded-md border border-border bg-muted px-3 py-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Tokens are encrypted with AES-256-GCM and stored securely. Only your server-side booking
            API can decrypt them to create meetings. They are never sent to your browser.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
