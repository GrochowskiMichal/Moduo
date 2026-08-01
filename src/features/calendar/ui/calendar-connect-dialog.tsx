// CAL-8b — the CalDAV connect dialog (desktop-only). Preset chips prefill the
// server + show the right credential hint; "Find calendars" lists the server's
// event calendars all pre-checked; Connect creates one account row per checked
// calendar and saves the credentials to the OS keychain once. A `reconnect`
// account switches the dialog to a password-only repair flow.

import { useMemo, useState } from "react";

import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import {
  addIcsFeed,
  CALDAV_PRESETS,
  type CaldavCalendar,
  type CaldavPreset,
  connectCaldavCalendars,
  discoverCaldavCalendars,
  reconnectCaldavAccount,
} from "../caldav-connect";
import type { CalendarAccountModel } from "../events";
import { parseSyncDescriptor } from "../sync";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtime: ModuoRuntime;
  workspaceId: string;
  /** When set, the dialog repairs this account's password (server/username fixed). */
  reconnect?: CalendarAccountModel;
  onDone: () => void;
};

type Phase = "form" | "select";

export function CalendarConnectDialog({
  open,
  onOpenChange,
  runtime,
  workspaceId,
  reconnect,
  onDone,
}: Props) {
  const reconnectDesc = reconnect ? parseSyncDescriptor(reconnect.syncToken) : null;
  const isReconnect = Boolean(reconnect);

  const [preset, setPreset] = useState<CaldavPreset>(CALDAV_PRESETS[0]);
  const [serverUrl, setServerUrl] = useState(CALDAV_PRESETS[0].serverUrl);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("form");
  const [calendars, setCalendars] = useState<CaldavCalendar[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Effective server/username: fixed from the account when reconnecting.
  const effectiveServer = reconnectDesc?.kind === "caldav" ? reconnectDesc.serverUrl : serverUrl;
  const effectiveUsername = reconnectDesc?.kind === "caldav" ? reconnectDesc.username : username;

  const reset = () => {
    setPreset(CALDAV_PRESETS[0]);
    setServerUrl(CALDAV_PRESETS[0].serverUrl);
    setUsername("");
    setPassword("");
    setPhase("form");
    setCalendars([]);
    setChecked(new Set());
    setBusy(false);
    setError(null);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const pickPreset = (p: CaldavPreset) => {
    setPreset(p);
    setServerUrl(p.serverUrl);
    setError(null);
  };

  const canSubmitForm = Boolean(
    effectiveServer.trim() && effectiveUsername.trim() && password.trim(),
  );

  const handleReconnect = async () => {
    if (!reconnect || !canSubmitForm) return;
    setBusy(true);
    setError(null);
    try {
      await reconnectCaldavAccount({ runtime, workspaceId, account: reconnect, password });
      onDone();
      handleOpenChange(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const handleFind = async () => {
    if (!canSubmitForm) return;
    setBusy(true);
    setError(null);
    try {
      const found = await discoverCaldavCalendars({
        serverUrl: effectiveServer,
        username: effectiveUsername,
        password,
      });
      if (found.length === 0) {
        setError("No event calendars found on this server.");
        return;
      }
      setCalendars(found);
      setChecked(new Set(found.map((c) => c.url))); // all pre-checked
      setPhase("select");
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (url: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const handleConnect = async () => {
    const chosen = calendars.filter((c) => checked.has(c.url));
    if (chosen.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      await connectCaldavCalendars({
        runtime,
        workspaceId,
        serverUrl: effectiveServer,
        username: effectiveUsername,
        password,
        calendars: chosen,
      });
      onDone();
      handleOpenChange(false);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const title = isReconnect ? "Reconnect calendar" : "Connect a CalDAV calendar";
  const description = isReconnect
    ? `Re-enter the password for ${reconnectDesc?.kind === "caldav" ? reconnectDesc.username : reconnect?.displayLabel}.`
    : "Works with iCloud, Fastmail, Nextcloud, and any CalDAV host. Connections are read-only.";

  const checkedCount = useMemo(() => checked.size, [checked]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {phase === "form" ? (
          <div className="flex flex-col gap-4">
            {!isReconnect ? (
              <>
                <div className="flex flex-wrap gap-2">
                  {CALDAV_PRESETS.map((p) => (
                    <Button
                      key={p.id}
                      type="button"
                      variant={preset.id === p.id ? "secondary" : "outline"}
                      size="sm"
                      onClick={() => pickPreset(p)}
                    >
                      {p.label}
                    </Button>
                  ))}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="caldav-server">Server address</Label>
                  <Input
                    id="caldav-server"
                    value={serverUrl}
                    onChange={(e) => setServerUrl(e.target.value)}
                    placeholder="https://caldav.example.com"
                    readOnly={!preset.serverEditable}
                    className={preset.serverEditable ? undefined : "text-muted-foreground"}
                  />
                </div>
              </>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="caldav-username">Username or email</Label>
              <Input
                id="caldav-username"
                value={effectiveUsername}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={preset.usernamePlaceholder}
                readOnly={isReconnect}
                autoComplete="username"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="caldav-password">Password</Label>
              <Input
                id="caldav-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmitForm && !busy) {
                    void (isReconnect ? handleReconnect() : handleFind());
                  }
                }}
              />
            </div>

            {!isReconnect ? <p className="text-xs text-muted-foreground">{preset.hint}</p> : null}
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {friendlyError(error)}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Choose which calendars to show in Moduo.
            </p>
            <ul className="scrollbar-thin flex max-h-64 flex-col gap-1 overflow-y-auto">
              {calendars.map((cal) => (
                <li key={cal.url}>
                  <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-accent">
                    <Checkbox
                      checked={checked.has(cal.url)}
                      onCheckedChange={() => toggle(cal.url)}
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {cal.name}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            {error ? (
              <p className="text-xs text-destructive" role="alert">
                {friendlyError(error)}
              </p>
            ) : null}
          </div>
        )}

        <DialogFooter>
          {phase === "form" ? (
            <Button
              type="button"
              onClick={() => void (isReconnect ? handleReconnect() : handleFind())}
              disabled={!canSubmitForm || busy}
            >
              {busy
                ? isReconnect
                  ? "Reconnecting…"
                  : "Finding…"
                : isReconnect
                  ? "Reconnect"
                  : "Find calendars"}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={() => setPhase("form")}
                disabled={busy}
              >
                Back
              </Button>
              <Button
                type="button"
                onClick={() => void handleConnect()}
                disabled={checkedCount === 0 || busy}
              >
                {busy
                  ? "Connecting…"
                  : `Connect ${checkedCount} calendar${checkedCount === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Add-an-ICS-feed dialog: a URL + an optional name (defaults to the feed's). */
export function IcsFeedDialog({
  open,
  onOpenChange,
  runtime,
  workspaceId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runtime: ModuoRuntime;
  workspaceId: string;
  onDone: () => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setUrl("");
      setName("");
      setBusy(false);
      setError(null);
    }
    onOpenChange(next);
  };

  const handleAdd = async () => {
    if (!url.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addIcsFeed({ runtime, workspaceId, url: url.trim(), name: name.trim() || undefined });
      onDone();
      handleOpenChange(false);
    } catch (e) {
      setError(friendlyError(errText(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an ICS feed</DialogTitle>
          <DialogDescription>
            Subscribe to a published calendar by its address. Feeds are read-only.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ics-url">Feed address</Label>
            <Input
              id="ics-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/calendar.ics"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ics-name">Name (optional)</Label>
            <Input
              id="ics-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Defaults to the feed's own name"
              onKeyDown={(e) => {
                if (e.key === "Enter" && url.trim() && !busy) void handleAdd();
              }}
            />
          </div>
          {error ? (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" onClick={() => void handleAdd()} disabled={!url.trim() || busy}>
            {busy ? "Adding…" : "Add feed"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Map the Rust engine's error codes to a human line. */
function friendlyError(msg: string): string {
  if (msg.includes("caldav_auth_failed")) return "Wrong username or password.";
  if (msg.includes("caldav_insecure_url")) return "Moduo only connects to calendars over https.";
  if (msg.includes("caldav_discovery_failed") || msg.includes("no_principal"))
    return "Couldn't find a calendar at that address — check the server URL.";
  if (msg.includes("caldav_url_invalid") || msg.includes("caldav_url_empty"))
    return "That doesn't look like a valid server address.";
  return msg;
}
