// Calendar accounts (CALR-20, AC35, AC37): the accounts list and Connect an
// account…, meeting links, the selected account's sync and Sync now, its
// calendars with Show in your week and Counts as busy for booking links, what
// a Google account does here, Remove with its consequences and Undo, and a
// revoked login's Reconnect. Presentational: calendar-accounts-dialog.tsx feeds it.

import { AlertTriangle, Plus } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "../../../components/ui/button";
import type { CalendarPick } from "../account-picks";
import { REMOVE_CONSEQUENCES } from "../account-removal";
import { providerLabel } from "../accounts";
import { syncSinceLabel } from "../sync-status";
import { PickRow } from "./calendar-connect-steps";

/** One login (a Google address, a CalDAV user, a feed) and its calendars. */
export type AccountLoginView = {
  key: string;
  provider: string;
  login: string;
  state: "ok" | "error" | "reauth";
  lastSyncAt: string | null;
  calendars: CalendarPick[];
  accountIds: string[];
};

type Props = {
  logins: AccountLoginView[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onConnect: () => void;
  onToggleShow: (pick: CalendarPick, show: boolean) => void;
  onToggleBusy: (pick: CalendarPick, busy: boolean) => void;
  onSyncNow: (key: string) => void;
  syncing: boolean;
  onRemove: (key: string) => void;
  onReconnect: (key: string) => void;
  meetingLinks: { googleMeet: boolean; zoom: "available" | "connected" | "unavailable" };
  onConnectZoom: () => void;
  /** The login just removed, with Undo while it lasts. */
  removed: { label: string; onUndo: () => void } | null;
  /** The "New events go to" field; absent shows where new events go by default. */
  newEventsTo?: ReactNode;
};

function syncedLabel(lastSyncAt: string | null): string {
  const ms = lastSyncAt ? Date.parse(lastSyncAt) : Number.NaN;
  return Number.isFinite(ms) ? `Synced ${syncSinceLabel(ms)}` : "Not synced yet";
}

export function CalendarAccountsView(props: Props) {
  const { logins, removed } = props;
  const selected = logins.find((l) => l.key === props.selectedKey) ?? logins[0] ?? null;
  return (
    <div className="flex flex-col gap-4 text-sm">
      {removed ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-lg border border-hairline p-3"
        >
          <p className="min-w-0 flex-1 text-foreground">
            {removed.label} was removed. {REMOVE_CONSEQUENCES}
          </p>
          <Button variant="outline" size="sm" onClick={removed.onUndo}>
            Undo
          </Button>
        </div>
      ) : null}
      <div className="flex gap-4">
        <div className="flex w-56 shrink-0 flex-col gap-1">
          {logins.map((l) => (
            <Button
              key={l.key}
              variant="ghost"
              aria-pressed={l.key === selected?.key}
              className="justify-start"
              onClick={() => props.onSelect(l.key)}
            >
              <span className="min-w-0 flex-1 truncate text-left">{l.login}</span>
              <span className="text-xs text-muted-foreground">
                {l.state === "reauth" ? ", needs reconnecting" : `, ${providerLabel(l.provider)}`}
              </span>
            </Button>
          ))}
          <Button
            variant="ghost"
            className="justify-start text-muted-foreground"
            onClick={props.onConnect}
          >
            <Plus aria-hidden />
            Connect an account…
          </Button>
        </div>
        {selected ? <LoginDetail {...props} login={selected} /> : null}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-foreground">Meeting links</p>
        <div className="flex items-center gap-2">
          <span className="flex-1">Google Meet</span>
          <span className="text-xs text-muted-foreground">
            {props.meetingLinks.googleMeet ? "Ready" : "Connect a Google account"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex-1">Zoom</span>
          {props.meetingLinks.zoom === "available" ? (
            <Button variant="outline" size="sm" onClick={props.onConnectZoom}>
              Connect Zoom
            </Button>
          ) : (
            <span className="text-xs text-muted-foreground">
              {props.meetingLinks.zoom === "connected" ? "Connected" : "Not set up"}
            </span>
          )}
        </div>
      </div>
      {props.newEventsTo ?? (
        <p className="text-xs text-muted-foreground">New events go to Your calendar · Moduo</p>
      )}
    </div>
  );
}

function LoginDetail({ login, ...props }: Props & { login: AccountLoginView }) {
  const google = login.provider === "google";
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      {login.state === "reauth" ? (
        <div className="flex items-center gap-2 rounded-lg border border-hairline p-3">
          <AlertTriangle aria-hidden className="size-icon-sm shrink-0 text-warning" />
          <p className="min-w-0 flex-1 text-foreground">
            Google stopped accepting Moduo's access to {login.login}. Its calendars show as they
            were, and booking links can't see them until you reconnect.
          </p>
          <Button size="sm" onClick={() => props.onReconnect(login.key)}>
            Reconnect ↵
          </Button>
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 text-muted-foreground">
          {syncedLabel(login.lastSyncAt)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={props.syncing}
          onClick={() => props.onSyncNow(login.key)}
        >
          Sync now
        </Button>
      </div>
      <div className="flex flex-col">
        {login.calendars.map((pick) => (
          <PickRow
            key={pick.externalId}
            pick={pick}
            onShow={(show) => props.onToggleShow(pick, show)}
            onBusy={(busy) => props.onToggleBusy(pick, busy)}
          />
        ))}
      </div>
      {google ? (
        <p className="text-xs text-muted-foreground">
          Changes save to Google and back within a minute. Moduo makes Meet links for your events.
          Invites go out from your address, sent by Google.
        </p>
      ) : null}
      <div>
        <Button variant="ghost" size="sm" onClick={() => props.onRemove(login.key)}>
          Remove this account…
        </Button>
      </div>
    </div>
  );
}
