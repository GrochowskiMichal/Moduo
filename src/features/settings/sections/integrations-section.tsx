import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Calendar, Globe, Video } from "lucide-react";

import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import type { CalendarAccountModel } from "../../calendar/events";
import { groupRailAccounts, providerLabel } from "../../calendar/accounts";
import { cleanupCredentialsForRemoval } from "../../calendar/caldav-connect";
import {
  CalendarConnectDialog,
  IcsFeedDialog,
} from "../../calendar/ui/calendar-connect-dialog";
import { Button } from "../../../components/ui/button";

import { SettingsSectionShell } from "./section-shell";

type IntegrationStatus = { provider: string; connected: boolean };

/** Desktop-only OAuth: on web the connect buttons explain where to go. */
const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

type OAuthResult = {
  accountId: string;
  email: string;
  displayName: string;
  calendars: { id: string; name: string; color: string }[];
};

const CAL_PROVIDERS = [
  { key: "google" as const, label: "Google Calendar", command: "calendar_google_oauth_start" },
  { key: "microsoft" as const, label: "Outlook Calendar", command: "calendar_outlook_oauth_start" },
];

export function IntegrationsSection() {
  const { runtime } = useAuth();
  const { selectedWorkspaceId: workspaceId } = useWorkspace();

  const [calAccounts, setCalAccounts] = useState<CalendarAccountModel[]>([]);
  const [calBusy, setCalBusy] = useState<string | null>(null);
  const [calError, setCalError] = useState<string | null>(null);
  const [caldavOpen, setCaldavOpen] = useState(false);
  const [icsOpen, setIcsOpen] = useState(false);
  const [reconnectTarget, setReconnectTarget] = useState<CalendarAccountModel | null>(null);

  const [videoStatuses, setVideoStatuses] = useState<IntegrationStatus[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoBusy, setVideoBusy] = useState<string | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    try {
      const bundle = await runtime.calendar.listModule(workspaceId);
      setCalAccounts(bundle.accounts.filter((a) => a.provider !== "moduo"));
    } catch (e) {
      setCalError(e instanceof Error ? e.message : String(e));
    }
  }, [runtime, workspaceId]);

  useEffect(() => {
    void loadAccounts();
    const loadVideo = async () => {
      if (!IS_DESKTOP) return;
      setVideoLoading(true);
      setVideoError(null);
      try {
        setVideoStatuses(await invoke<IntegrationStatus[]>("integration_get_status"));
      } catch (e) {
        setVideoError(e instanceof Error ? e.message : String(e));
      } finally {
        setVideoLoading(false);
      }
    };
    void loadVideo();
  }, [loadAccounts]);

  const handleConnect = async (provider: "google" | "microsoft", command: string) => {
    if (!IS_DESKTOP || !runtime || !workspaceId) return;
    setCalBusy(provider);
    setCalError(null);
    try {
      const result = await invoke<OAuthResult>(command);
      // Register the account in Supabase so web + desktop both see it. The
      // provider event sync (fetch → mirror) runs from the desktop engine.
      await runtime.calendar.upsertAccount({
        workspaceId,
        provider,
        externalId: result.accountId,
        displayLabel: result.email || result.displayName,
        color: null,
        status: "ok",
        lastSyncAt: new Date().toISOString(),
      });
      await loadAccounts();
    } catch (e) {
      setCalError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalBusy(null);
    }
  };

  const handleDisconnect = async (account: CalendarAccountModel) => {
    if (!runtime || !workspaceId) return;
    setCalBusy(account.id);
    try {
      // Clean up the OS-keychain secret first (CalDAV: only when this is the
      // account's last calendar; ICS: always) — before the row is gone so the
      // last-row check can still see it. Then cascade-remove in Supabase.
      await cleanupCredentialsForRemoval({
        isDesktop: IS_DESKTOP,
        removed: account,
        allAccounts: calAccounts,
      });
      await runtime.calendar.removeAccount({ workspaceId, accountId: account.id });
      await loadAccounts();
    } catch (e) {
      setCalError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalBusy(null);
    }
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

  const caldavIcsGroups = groupRailAccounts(
    calAccounts.filter((a) => a.provider === "caldav" || a.provider === "ics"),
  );

  return (
    <SettingsSectionShell
      title="Integrations"
      description="Connect your calendars and video meeting tools."
    >
      {runtime && workspaceId ? (
        <>
          <CalendarConnectDialog
            open={caldavOpen}
            onOpenChange={setCaldavOpen}
            runtime={runtime}
            workspaceId={workspaceId}
            onDone={() => void loadAccounts()}
          />
          <CalendarConnectDialog
            open={reconnectTarget !== null}
            onOpenChange={(open) => {
              if (!open) setReconnectTarget(null);
            }}
            runtime={runtime}
            workspaceId={workspaceId}
            reconnect={reconnectTarget ?? undefined}
            onDone={() => void loadAccounts()}
          />
          <IcsFeedDialog
            open={icsOpen}
            onOpenChange={setIcsOpen}
            runtime={runtime}
            workspaceId={workspaceId}
            onDone={() => void loadAccounts()}
          />
        </>
      ) : null}
      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-base text-foreground">Calendar</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Connected calendars are read-only in Moduo — your events appear here and on the web,
          but edits stay in the source calendar.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {CAL_PROVIDERS.map(({ key, label, command }) => {
            const connected = calAccounts.filter((a) => a.provider === key);
            return (
              <div key={key} className="rounded-md border border-border bg-muted/40 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-foreground">
                      <Calendar className="size-4" />
                    </span>
                    <div className="flex flex-col">
                      <span className="text-sm font-medium text-foreground">{label}</span>
                      <span className="text-xs text-muted-foreground">
                        {connected.length > 0
                          ? `${connected.length} account${connected.length === 1 ? "" : "s"} connected`
                          : IS_DESKTOP
                            ? "Not connected"
                            : "Connect from the desktop app"}
                      </span>
                    </div>
                  </div>
                  {IS_DESKTOP ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void handleConnect(key, command)}
                      disabled={calBusy === key}
                    >
                      {calBusy === key ? "Connecting…" : "Connect account"}
                    </Button>
                  ) : (
                    <Button type="button" variant="outline" size="sm" disabled>
                      Desktop only
                    </Button>
                  )}
                </div>

                {connected.length > 0 ? (
                  <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                    {connected.map((acc) => (
                      <li
                        key={acc.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-foreground">
                            {acc.displayLabel || providerLabel(acc.provider)}
                          </p>
                          {acc.status === "error" ? (
                            <p className="truncate text-xs text-warning">
                              Sync error — reconnect from the desktop app
                            </p>
                          ) : null}
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDisconnect(acc)}
                          disabled={calBusy === acc.id}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          {calBusy === acc.id ? "Removing…" : "Disconnect"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
          {/* CalDAV + ICS (basic-auth, no OAuth) — iCloud / Fastmail / Nextcloud / feeds */}
          <div className="rounded-md border border-border bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-foreground">
                  <Globe className="size-4" />
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">
                    CalDAV &amp; ICS feeds
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {IS_DESKTOP
                      ? "iCloud, Fastmail, Nextcloud, or any calendar address"
                      : "Connect from the desktop app"}
                  </span>
                </div>
              </div>
              {IS_DESKTOP ? (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setCaldavOpen(true)}
                  >
                    Connect CalDAV
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setIcsOpen(true)}
                  >
                    Add ICS feed
                  </Button>
                </div>
              ) : (
                <Button type="button" variant="outline" size="sm" disabled>
                  Desktop only
                </Button>
              )}
            </div>

            {caldavIcsGroups.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                {caldavIcsGroups.flatMap((group) => {
                  const rows = group.kind === "group" ? group.rows : [group.row];
                  const header = group.kind === "group" ? group.header : null;
                  return rows.map((row, i) => (
                    <li
                      key={row.account.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        {header && i === 0 ? (
                          <p className="truncate text-2xs uppercase tracking-wide text-muted-foreground">
                            {header}
                          </p>
                        ) : null}
                        <p className="truncate text-sm text-foreground">{row.label}</p>
                        {row.account.status === "error" ? (
                          <p className="truncate text-xs text-warning">
                            Sync error — reconnect to fix
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {row.account.provider === "caldav" && row.account.status === "error" ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setReconnectTarget(row.account)}
                          >
                            Reconnect
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void handleDisconnect(row.account)}
                          disabled={calBusy === row.account.id}
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                        >
                          {calBusy === row.account.id ? "Removing…" : "Remove"}
                        </Button>
                      </div>
                    </li>
                  ));
                })}
              </ul>
            ) : null}
          </div>

          {calError ? (
            <p className="text-xs text-destructive" role="alert">
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
                      {!IS_DESKTOP
                        ? "Desktop only"
                        : videoLoading
                          ? "Loading…"
                          : connected
                            ? "Connected"
                            : "Not connected"}
                    </span>
                  </div>
                </div>
                {IS_DESKTOP ? (
                  connected ? (
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
                  )
                ) : (
                  <Button type="button" variant="outline" size="sm" disabled>
                    Desktop only
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
