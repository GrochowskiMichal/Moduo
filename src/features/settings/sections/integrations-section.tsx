import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Bot, Calendar, Globe, Mail } from "lucide-react";

import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import type { CalendarAccountModel } from "../../calendar/events";
import { groupRailAccounts, providerLabel } from "../../calendar/accounts";
import { cleanupCredentialsForRemoval } from "../../calendar/caldav-connect";
import {
  CalendarConnectDialog,
  IcsFeedDialog,
} from "../../calendar/ui/calendar-connect-dialog";
import { EmailConnectDialog } from "../../email/ui/email-connect-dialog";
import type { SavedAccount } from "../../email/model/email-types";
import { Button } from "../../../components/ui/button";
import { dispatchOpenSettings } from "../settings-events";
import { MCP_KEYS_SECTION, mcpConnectorStatus } from "../integrations";

import { SettingsSectionShell } from "./section-shell";

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

  const [emailAccounts, setEmailAccounts] = useState<SavedAccount[]>([]);
  const [emailBusy, setEmailBusy] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailConnectOpen, setEmailConnectOpen] = useState(false);
  const [emailReconnectTarget, setEmailReconnectTarget] = useState<SavedAccount | null>(null);

  // AI/MCP connector status: count of active (non-revoked) API keys for this
  // workspace. `null` = not yet loaded or unreadable (e.g. a non-admin) — the
  // card then avoids asserting a connection state either way.
  const [mcpKeyCount, setMcpKeyCount] = useState<number | null>(null);

  const loadAccounts = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    try {
      const bundle = await runtime.calendar.listModule(workspaceId);
      setCalAccounts(bundle.accounts.filter((a) => a.provider !== "moduo"));
    } catch (e) {
      setCalError(e instanceof Error ? e.message : String(e));
    }
  }, [runtime, workspaceId]);

  const loadEmailAccounts = useCallback(async () => {
    if (!IS_DESKTOP || !runtime) return;
    setEmailError(null);
    try {
      setEmailAccounts((await runtime.email.listAccounts()) as SavedAccount[]);
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : String(e));
    }
  }, [runtime]);

  const loadMcpKeys = useCallback(async () => {
    if (!runtime || !workspaceId) return;
    try {
      const keys = await runtime.workspace.listApiKeys(workspaceId);
      setMcpKeyCount(keys.length);
    } catch {
      // Non-admins can't list keys (RLS) and reads can transiently fail — keep
      // the status neutral rather than falsely reporting "not connected".
      setMcpKeyCount(null);
    }
  }, [runtime, workspaceId]);

  useEffect(() => {
    void loadAccounts();
    void loadEmailAccounts();
    void loadMcpKeys();
  }, [loadAccounts, loadEmailAccounts, loadMcpKeys]);

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

  const handleEmailDisconnect = async (account: SavedAccount) => {
    if (!IS_DESKTOP || !runtime) return;
    setEmailBusy(account.id);
    setEmailError(null);
    try {
      await runtime.email.disconnect(account.id);
      await loadEmailAccounts();
    } catch (e) {
      setEmailError(e instanceof Error ? e.message : String(e));
    } finally {
      setEmailBusy(null);
    }
  };

  const mcpStatus = mcpConnectorStatus(mcpKeyCount);

  const caldavIcsGroups = groupRailAccounts(
    calAccounts.filter((a) => a.provider === "caldav" || a.provider === "ics"),
  );

  return (
    <SettingsSectionShell
      title="Integrations"
      description="Connect your calendars, email, and AI assistants."
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
      {IS_DESKTOP ? (
        <>
          <EmailConnectDialog
            open={emailConnectOpen}
            onOpenChange={setEmailConnectOpen}
            onConnected={() => void loadEmailAccounts()}
          />
          <EmailConnectDialog
            open={emailReconnectTarget !== null}
            onOpenChange={(open) => {
              if (!open) setEmailReconnectTarget(null);
            }}
            isReconnect={emailReconnectTarget ?? undefined}
            onConnected={() => void loadEmailAccounts()}
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
        <h3 className="font-display text-base text-foreground">Email</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {IS_DESKTOP
            ? "Connect Gmail, iCloud, or any IMAP mailbox. Credentials are stored in your device keychain."
            : "Email accounts are managed on the desktop app."}
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <div className="rounded-md border border-border bg-muted/40 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-foreground">
                  <Mail className="size-4" />
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">Mailboxes</span>
                  <span className="text-xs text-muted-foreground">
                    {emailAccounts.length > 0
                      ? `${emailAccounts.length} account${emailAccounts.length === 1 ? "" : "s"} connected`
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
                  onClick={() => setEmailConnectOpen(true)}
                >
                  Connect email account
                </Button>
              ) : null}
            </div>

            {emailAccounts.length > 0 ? (
              <ul className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
                {emailAccounts.map((acc) => (
                  <li
                    key={acc.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-foreground">{acc.email}</p>
                      {acc.status === "active" ? (
                        <p className="text-xs text-success">Connected</p>
                      ) : acc.status === "reauth_required" ? (
                        <p className="text-xs text-warning">Sign-in expired — reconnect to fix</p>
                      ) : (
                        <p className="truncate text-xs text-destructive">
                          {acc.lastError ? `Error — ${acc.lastError}` : "Connection error"}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      {acc.status === "reauth_required" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setEmailReconnectTarget(acc)}
                        >
                          Reconnect
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => void handleEmailDisconnect(acc)}
                        disabled={emailBusy === acc.id}
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                      >
                        {emailBusy === acc.id ? "Removing…" : "Disconnect"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {emailError ? (
            <p className="text-xs text-destructive" role="alert">
              {emailError}
            </p>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border border-border bg-card p-6">
        <h3 className="font-display text-base text-foreground">AI &amp; MCP</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Connect Claude and other AI assistants to this workspace over MCP. They reach your
          tasks and notes through a scoped API key you create and can revoke anytime.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-md border border-border bg-card text-foreground">
                <Bot className="size-4" />
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">AI assistants (MCP)</span>
                <span className="text-xs text-muted-foreground">{mcpStatus.label}</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => dispatchOpenSettings({ section: MCP_KEYS_SECTION })}
            >
              {mcpStatus.connected ? "Manage keys" : "Set up"}
            </Button>
          </div>
        </div>
      </section>
    </SettingsSectionShell>
  );
}
