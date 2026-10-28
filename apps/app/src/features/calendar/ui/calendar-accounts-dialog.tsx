// Calendar accounts and Connect a calendar, opened in place on the Calendar page
// (CALR-20, AC35–AC37) by dispatchOpenCalendarAccounts. Builds each login from
// the synced accounts and Google's status; Remove is a soft delete with Undo,
// and the sign-in itself (keychain secret, the web Google token) is only
// cleared once the Undo window closes.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { isTauriRuntime } from "../../../lib/runtime";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { dispatchOpenSettings } from "../../settings/settings-events";
import {
  accountCalendars,
  type CalendarPick,
  connectPicks,
  type GoogleStatus,
} from "../account-picks";
import { removeCalendarLogin } from "../account-removal";
import { providerLabel } from "../accounts";
import { cleanupCredentialsForRemoval } from "../caldav-connect";
import { rememberConnectStart } from "../connect-return";
import type { CalendarAccountModel } from "../events";
import { parseGoogleExternalId } from "../google-account";
import {
  disconnectGoogleLogin,
  loadGoogleStatus,
  saveGooglePicks,
  startWebGoogleConnect,
} from "../google-web";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import { newEventsCalendars, resolveNewEventsTo, withNewEventsTo } from "../new-events-to";
import type { CalendarPrefs } from "../prefs";
import { connectOrigin, zoomRequest } from "./booking-links";
import {
  OPEN_CALENDAR_ACCOUNTS_EVENT,
  type OpenCalendarAccounts,
} from "./calendar-accounts-events";
import { type AccountLoginView, CalendarAccountsView } from "./calendar-accounts-view";
import { CalendarConnectDialog, IcsFeedDialog } from "./calendar-connect-dialog";
import {
  CalendarPicker,
  type ConnectProvider,
  ConnectTiles,
  FinishInBrowser,
  GoogleConsent,
  ImportProgress,
} from "./calendar-connect-steps";
import { NewEventsToField } from "./new-events-to-field";

const UNDO_MS = 10_000;

type Step = "accounts" | "tiles" | "consent" | "browser" | "pick" | "import";
type Pending = {
  accounts: CalendarAccountModel[];
  /** Every live row when Remove ran: a CalDAV secret stays while a sibling calendar uses it. */
  all: CalendarAccountModel[];
  email: string | null;
  undo: () => Promise<void>;
};

function worst(rows: CalendarAccountModel[], reauth: boolean): AccountLoginView["state"] {
  if (reauth || rows.some((a) => a.status === "reauth")) return "reauth";
  return rows.some((a) => a.status === "error") ? "error" : "ok";
}

function oldestSync(rows: CalendarAccountModel[]): string | null {
  const times = rows.map((a) => a.lastSyncAt).filter((t): t is string => Boolean(t));
  return times.sort()[0] ?? null;
}

/** Each login with its calendars: Google by address (synced or not), the rest one per account. */
export function buildLogins(
  accounts: readonly CalendarAccountModel[],
  status: GoogleStatus,
  hiddenIds: readonly string[],
): AccountLoginView[] {
  const live = accounts.filter((a) => !a.deletedAt && a.provider !== "moduo");
  const emails = new Set([...status.calendars.map((c) => c.email), ...status.reauth]);
  for (const a of live) {
    const email = parseGoogleExternalId(a.externalId)?.email;
    if (email) emails.add(email);
  }
  const google = [...emails].map((email) => {
    const rows = live.filter((a) => parseGoogleExternalId(a.externalId)?.email === email);
    return {
      key: `google:${email}`,
      provider: "google",
      login: email,
      state: worst(rows, status.reauth.includes(email)),
      lastSyncAt: oldestSync(rows),
      calendars: accountCalendars(status.calendars, accounts, hiddenIds, email),
      accountIds: rows.map((a) => a.id),
    };
  });
  const others = live
    .filter((a) => !parseGoogleExternalId(a.externalId))
    .map((a) => ({
      key: `account:${a.id}`,
      provider: a.provider,
      login: a.displayLabel || providerLabel(a.provider),
      state: worst([a], false),
      lastSyncAt: a.lastSyncAt,
      calendars: [
        {
          externalId: a.externalId,
          name: a.displayLabel || providerLabel(a.provider),
          readOnly: true,
          primary: false,
          accountId: a.id,
          show: !hiddenIds.includes(a.id),
          busy: a.busyDefault !== false,
        },
      ],
      accountIds: [a.id],
    }));
  return [...google, ...others];
}

const TITLES: Record<Step, string> = {
  accounts: "Calendar accounts",
  tiles: "Connect a calendar",
  consent: "Connect Google Calendar",
  browser: "Connect Google Calendar",
  pick: "Pick your calendars",
  import: "Bringing in your events",
};

export function CalendarAccountsDialog({
  runtime,
  workspaceId,
  isDesktop,
  calendar,
  hiddenAccountIds,
  newEventsTo,
  updatePrefs,
  syncNow,
}: {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  isDesktop: boolean;
  calendar: CalendarModuleApi;
  hiddenAccountIds: string[];
  newEventsTo: CalendarPrefs["newEventsTo"];
  updatePrefs: (patch: (prev: CalendarPrefs) => Partial<CalendarPrefs>) => void;
  syncNow: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("accounts");
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [pickEmail, setPickEmail] = useState("");
  const [status, setStatus] = useState<GoogleStatus>({ calendars: [], reauth: [] });
  const [zoom, setZoom] = useState<"available" | "connected" | "unavailable">("unavailable");
  const [syncing, setSyncing] = useState(false);
  const [importIds, setImportIds] = useState<string[]>([]);
  const [removedLabel, setRemovedLabel] = useState<string | null>(null);
  const [desktopFlow, setDesktopFlow] = useState<"caldav" | "ics" | null>(null);
  const pending = useRef<Pending | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const refreshStatus = useCallback(async () => {
    const [google, zoomStatus] = await Promise.all([
      loadGoogleStatus().catch(() => null),
      zoomRequest({ action: "status" }).catch(() => null),
    ]);
    if (google) setStatus(google);
    if (zoomStatus) {
      setZoom(
        zoomStatus.connected === true
          ? "connected"
          : zoomStatus.configured === true
            ? "available"
            : "unavailable",
      );
    }
    return google;
  }, []);

  // The sign-in goes only once Undo is no longer possible.
  const finishRemoval = useCallback(async () => {
    window.clearTimeout(timer.current);
    const done = pending.current;
    pending.current = null;
    setRemovedLabel(null);
    if (!done) return;
    for (const account of done.accounts) {
      await cleanupCredentialsForRemoval({
        isDesktop,
        removed: account,
        allAccounts: done.all,
      }).catch(() => {});
    }
    if (done.email) await disconnectGoogleLogin(done.email).catch(() => {});
  }, [isDesktop]);

  const reconnect = useCallback(
    (email: string) => {
      if (isDesktop) {
        // The desktop app connects Google from Settings › Integrations.
        setOpen(false);
        dispatchOpenSettings({ section: "integrations" });
        return;
      }
      void startWebGoogleConnect().catch((e) =>
        toast.error(e instanceof Error ? e.message : `Couldn't reconnect ${email}.`),
      );
    },
    [isDesktop],
  );

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = ((event as CustomEvent<OpenCalendarAccounts>).detail ??
        {}) as OpenCalendarAccounts;
      if (detail.reconnect) return reconnect(detail.reconnect);
      setOpen(true);
      if (detail.login) {
        setSelectedKey(detail.login.includes(":") ? detail.login : `google:${detail.login}`);
      }
      if (detail.pick) setPickEmail(detail.pick);
      setStep(detail.pick ? "pick" : detail.connect ? "tiles" : "accounts");
      void refreshStatus();
    };
    window.addEventListener(OPEN_CALENDAR_ACCOUNTS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_CALENDAR_ACCOUNTS_EVENT, onOpen);
  }, [reconnect, refreshStatus]);

  useEffect(() => () => void finishRemoval(), [finishRemoval]);

  if (!runtime || !workspaceId) return null;
  const logins = buildLogins(calendar.accounts, status, hiddenAccountIds);
  const reload = () => void calendar.reload();

  const setHidden = (accountIds: string[], hide: boolean) =>
    updatePrefs((prev) => ({
      hiddenAccountIds: hide
        ? [...new Set([...prev.hiddenAccountIds, ...accountIds])]
        : prev.hiddenAccountIds.filter((id) => !accountIds.includes(id)),
    }));

  const syncPick = async (pick: CalendarPick) => {
    try {
      const saved = await saveGooglePicks({ runtime, workspaceId, picks: [pick] });
      setHidden(saved.hiddenIds, true);
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the calendar.");
    }
  };

  const onToggleShow = (pick: CalendarPick, show: boolean) => {
    if (pick.accountId) setHidden([pick.accountId], !show);
    else if (show) void syncPick({ ...pick, show: true });
  };

  const onToggleBusy = (pick: CalendarPick, busy: boolean) => {
    if (!pick.accountId) {
      if (busy) void syncPick({ ...pick, busy: true });
      return;
    }
    void runtime.calendar
      .setAccountBusy({ workspaceId, accountId: pick.accountId, busy })
      .then(reload)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Couldn't save that."));
  };

  const onSyncNow = () => {
    setSyncing(true);
    void syncNow()
      .then(() => calendar.reload())
      .catch(() => toast.error("Couldn't sync. Try again."))
      .finally(() => setSyncing(false));
  };

  const onRemove = async (key: string) => {
    const login = logins.find((l) => l.key === key);
    if (!login) return;
    await finishRemoval();
    if (login.accountIds.length === 0) {
      // Connected, but nothing of it is in Moduo: only the sign-in goes.
      if (login.provider === "google") {
        await disconnectGoogleLogin(login.login).catch((e) =>
          toast.error(e instanceof Error ? e.message : "Couldn't remove the account."),
        );
        void refreshStatus();
      }
      return;
    }
    const accounts = calendar.accounts.filter((a) => login.accountIds.includes(a.id));
    try {
      const { undo } = await removeCalendarLogin({
        runtime,
        workspaceId,
        accountIds: login.accountIds,
      });
      const all = calendar.accounts.filter((a) => !a.deletedAt);
      pending.current = {
        accounts,
        all,
        email: login.provider === "google" ? login.login : null,
        undo,
      };
      setRemovedLabel(login.login);
      timer.current = window.setTimeout(() => void finishRemoval(), UNDO_MS);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't remove the account.");
    }
    reload();
  };

  const onUndo = async () => {
    window.clearTimeout(timer.current);
    const done = pending.current;
    pending.current = null;
    setRemovedLabel(null);
    try {
      await done?.undo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't bring the account back.");
    }
    reload();
  };

  const onConnectZoom = async () => {
    try {
      const payload = await zoomRequest({ action: "start", origin: connectOrigin() });
      const url = typeof payload.url === "string" ? payload.url : "";
      if (!url) throw new Error("Zoom didn't return a sign-in page.");
      if (isTauriRuntime()) await runtime.window.openExternalUrl(url);
      else {
        rememberConnectStart(url);
        window.location.href = url;
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't connect Zoom.");
    }
  };

  const startGoogle = () => {
    if (isDesktop) return reconnect("");
    setStep("browser");
    reconnect("");
  };

  const onTile = (provider: ConnectProvider) => {
    if (provider === "google") return setStep("consent");
    if (!isDesktop) {
      toast(`Connect ${provider === "ics" ? "a calendar link" : "it"} in the Moduo app.`);
      return;
    }
    if (provider === "microsoft") {
      setOpen(false);
      dispatchOpenSettings({ section: "integrations" });
      return;
    }
    setOpen(false);
    setDesktopFlow(provider);
  };

  const onPicked = async (picks: CalendarPick[]) => {
    try {
      const saved = await saveGooglePicks({ runtime, workspaceId, picks });
      setHidden(saved.hiddenIds, true);
      setImportIds(saved.accountIds);
      setStep("import");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't add the calendars.");
    }
  };

  const imported = calendar.accounts.filter((a) => importIds.includes(a.id));
  const body = {
    accounts: (
      <CalendarAccountsView
        logins={logins}
        selectedKey={selectedKey}
        onSelect={setSelectedKey}
        onConnect={() => setStep("tiles")}
        onToggleShow={onToggleShow}
        onToggleBusy={onToggleBusy}
        onSyncNow={onSyncNow}
        syncing={syncing}
        onRemove={(key) => void onRemove(key)}
        onReconnect={(key) => reconnect(key.replace(/^google:/, ""))}
        meetingLinks={{ googleMeet: logins.some((l) => l.provider === "google"), zoom }}
        onConnectZoom={() => void onConnectZoom()}
        removed={removedLabel ? { label: removedLabel, onUndo: () => void onUndo() } : null}
        newEventsTo={
          <NewEventsToField
            calendars={newEventsCalendars(calendar.accounts)}
            to={resolveNewEventsTo(newEventsTo[workspaceId] ?? null, calendar.accounts)}
            onChange={(id) => updatePrefs((prev) => withNewEventsTo(prev, workspaceId, id))}
          />
        }
      />
    ),
    tiles: <ConnectTiles onPick={onTile} appOnly={!isDesktop} />,
    consent: <GoogleConsent onBack={() => setStep("tiles")} onContinue={startGoogle} />,
    browser: <FinishInBrowser onOpenAgain={startGoogle} onCancel={() => setStep("tiles")} />,
    pick: (
      <CalendarPicker
        key={`${pickEmail}:${status.calendars.length}`}
        email={pickEmail}
        picks={connectPicks(status.calendars, pickEmail)}
        onConfirm={(picks) => void onPicked(picks)}
      />
    ),
    import: (
      <ImportProgress
        events={calendar.events.filter((e) => importIds.includes(e.sourceAccountId ?? "")).length}
        done={imported.filter((a) => a.lastSyncAt).length}
        total={importIds.length}
        onClose={() => setOpen(false)}
      />
    ),
  }[step];

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) void finishRemoval();
        }}
      >
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{TITLES[step]}</DialogTitle>
            <DialogDescription className="sr-only">
              Your connected calendars and how they sync with Moduo.
            </DialogDescription>
          </DialogHeader>
          {body}
        </DialogContent>
      </Dialog>
      <CalendarConnectDialog
        open={desktopFlow === "caldav"}
        onOpenChange={(next) => !next && setDesktopFlow(null)}
        runtime={runtime}
        workspaceId={workspaceId}
        onDone={reload}
      />
      <IcsFeedDialog
        open={desktopFlow === "ics"}
        onOpenChange={(next) => !next && setDesktopFlow(null)}
        runtime={runtime}
        workspaceId={workspaceId}
        onDone={reload}
      />
    </>
  );
}
