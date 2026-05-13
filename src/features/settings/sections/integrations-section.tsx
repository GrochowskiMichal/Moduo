import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Calendar, Video } from "lucide-react";

import type { CalendarAccount, CalendarSource } from "../../calendar/types";
import {
  CALENDAR_ACCOUNTS_UPDATED_EVENT,
  readLocalAccounts,
  readLocalSources,
  writeLocalAccounts,
  writeLocalSources,
} from "../../calendar/hooks/use-calendar";
import { Button } from "../../../components/ui/button";

import { SettingsSectionShell } from "./section-shell";

type IntegrationStatus = { provider: string; connected: boolean };

export function IntegrationsSection() {
  const [calAccounts, setCalAccounts] = useState<CalendarAccount[]>([]);
  const [calSources, setCalSources] = useState<CalendarSource[]>([]);
  const [calBusy, setCalBusy] = useState<string | null>(null);
  const [calError, setCalError] = useState<string | null>(null);

  const [videoStatuses, setVideoStatuses] = useState<IntegrationStatus[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoBusy, setVideoBusy] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
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
  }, []);

  useEffect(() => {
    const handler = () => {
      setCalAccounts(readLocalAccounts());
      setCalSources(readLocalSources());
    };
    window.addEventListener(CALENDAR_ACCOUNTS_UPDATED_EVENT, handler);
    return () => window.removeEventListener(CALENDAR_ACCOUNTS_UPDATED_EVENT, handler);
  }, []);

  const handleConnectGoogleCalendar = async () => {
    setCalBusy("google");
    setCalError(null);
    try {
      const result = await invoke<{
        accountId: string;
        email: string;
        displayName: string;
        calendars: { id: string; name: string; color: string }[];
      }>("calendar_google_oauth_start");
      const newAccount: CalendarAccount = {
        id: result.accountId,
        provider: "google",
        email: result.email,
        displayName: result.displayName,
        connected: true,
        lastSyncAt: new Date().toISOString(),
      };
      const newSrcs: CalendarSource[] = result.calendars.map((c) => ({
        id: c.id,
        accountId: result.accountId,
        name: c.name,
        color: c.color || "#4285f4",
        visible: true,
      }));
      const cur = readLocalAccounts();
      const idx = cur.findIndex((a) => a.id === newAccount.id);
      const nextAccounts =
        idx === -1 ? [...cur, newAccount] : cur.map((a, i) => (i === idx ? newAccount : a));
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
      await invoke(
        provider === "zoom" ? "integration_connect_zoom" : "integration_connect_google_meet",
      );
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

  const googleAccounts = calAccounts.filter((a) => a.provider === "google");

  return (
    <SettingsSectionShell
      title="Integrations"
      description="Connect your calendars and video meeting tools."
    >
      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-base text-foreground">Calendar</h3>

        <div className="mt-4 rounded-md border border-border bg-muted/40 p-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-foreground">
                <Calendar className="size-4" />
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">Google Calendar</span>
                <span className="text-xs text-muted-foreground">
                  {googleAccounts.length > 0
                    ? `${googleAccounts.length} account${googleAccounts.length === 1 ? "" : "s"} connected`
                    : "Not connected"}
                </span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleConnectGoogleCalendar()}
              disabled={calBusy === "google"}
            >
              {calBusy === "google" ? "Connecting…" : "Connect account"}
            </Button>
          </div>

          {googleAccounts.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
              {googleAccounts.map((acc) => {
                const sources = calSources.filter((s) => s.accountId === acc.id);
                return (
                  <li
                    key={acc.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{acc.email}</p>
                      {sources.length > 0 ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {sources.map((s) => s.name).join(", ")}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDisconnectCalendarAccount(acc.id)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      Disconnect
                    </Button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          {calError ? (
            <p className="mt-3 text-xs text-destructive" role="alert">
              {calError}
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-base text-foreground">Video meetings</h3>
        {videoError ? (
          <p className="mt-2 text-xs text-destructive" role="alert">
            {videoError}
          </p>
        ) : null}
        <div className="mt-4 flex flex-col gap-2">
          {(["zoom", "google_meet"] as const).map((provider) => {
            const status = videoStatuses.find((s) => s.provider === provider);
            const connected = status?.connected ?? false;
            const busy = videoBusy === provider;
            const label = provider === "zoom" ? "Zoom" : "Google Meet";
            return (
              <div
                key={provider}
                className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-foreground">
                    <Video className="size-4" />
                  </span>
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-foreground">{label}</span>
                    <span className="text-xs text-muted-foreground">
                      {videoLoading ? "Loading…" : connected ? "Connected" : "Not connected"}
                    </span>
                  </div>
                </div>
                {connected ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleVideoDisconnect(provider)}
                    disabled={busy}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    {busy ? "Disconnecting…" : "Disconnect"}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void handleVideoConnect(provider)}
                    disabled={busy || videoLoading}
                  >
                    {busy ? "Connecting…" : "Connect"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </SettingsSectionShell>
  );
}
