// Connect a calendar, step by step (CALR-20, AC36): provider tiles that say the
// truth, Google's consent step, "Finish in your browser", the calendar picker
// and import progress. Presentational: calendar-accounts-dialog.tsx runs them.

import { useState } from "react";

import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { Progress } from "../../../components/ui/progress";
import { type CalendarPick, importProgressLabel } from "../account-picks";

export type ConnectProvider = "google" | "microsoft" | "caldav" | "ics";

const TILES: { id: ConnectProvider; name: string; detail: string }[] = [
  { id: "google", name: "Google", detail: "Syncs both ways · Meet links" },
  { id: "microsoft", name: "Microsoft 365 or Outlook", detail: "View only, for now" },
  { id: "caldav", name: "iCloud or CalDAV", detail: "View only · app-specific password" },
  { id: "ics", name: "Subscribe by link", detail: ".ics · view only" },
];

/** `appOnly`: the providers that connect only in the Moduo app (the web says so). */
export function ConnectTiles({
  onPick,
  appOnly = false,
}: {
  onPick: (provider: ConnectProvider) => void;
  appOnly?: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {TILES.map((tile) => (
        <button
          key={tile.id}
          type="button"
          onClick={() => onPick(tile.id)}
          className="flex flex-col items-start gap-1 rounded-lg border border-hairline p-3 text-left hover:bg-state-hover"
        >
          <span className="text-sm text-foreground">{tile.name}</span>
          <span className="text-xs text-muted-foreground">
            {tile.detail}
            {appOnly && tile.id !== "google" ? " · In the Moduo app" : ""}
          </span>
        </button>
      ))}
    </div>
  );
}

const PERMISSIONS: [string, string][] = [
  ["See your calendars and their events", "to show them in your week."],
  ["Add, change and delete events", "so changes you make here save to Google."],
  ["Your name and email address", "to tell your accounts apart."],
];

export function GoogleConsent({
  onBack,
  onContinue,
}: {
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-foreground">Google will ask you to let Moduo:</p>
      <ul className="flex flex-col gap-1.5">
        {PERMISSIONS.map(([what, why]) => (
          <li key={what}>
            <span className="text-foreground">{what}</span>{" "}
            <span className="text-muted-foreground">{why}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground">
        Events are copied into Moduo's database in London, UK, and the Google sign-in is stored
        encrypted. Moduo doesn't read your email, contacts or files.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
        <Button onClick={onContinue}>Continue to Google ↵</Button>
      </div>
    </div>
  );
}

export function FinishInBrowser({
  onOpenAgain,
  onCancel,
}: {
  onOpenAgain: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-foreground">Finish in your browser</p>
      <p className="text-muted-foreground">Sign in to Google there, then come back here.</p>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="outline" onClick={onOpenAgain}>
          Open the Google page again
        </Button>
      </div>
    </div>
  );
}

/** One calendar's two choices, shared with Calendar accounts. */
export function PickRow({
  pick,
  onShow,
  onBusy,
}: {
  pick: CalendarPick;
  onShow: (show: boolean) => void;
  onBusy: (busy: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-1 text-sm">
      <Checkbox
        aria-label={`Show ${pick.name} in your week`}
        checked={pick.show}
        onCheckedChange={(checked) => onShow(checked === true)}
      />
      <span className="min-w-0 flex-1 truncate text-foreground">{pick.name}</span>
      {pick.readOnly ? <span className="text-xs text-muted-foreground">View only</span> : null}
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox
          aria-label={`${pick.name} counts as busy for booking links`}
          checked={pick.busy}
          onCheckedChange={(checked) => onBusy(checked === true)}
        />
        Busy
      </label>
    </div>
  );
}

export function CalendarPicker({
  email,
  picks: initial,
  onConfirm,
}: {
  email: string;
  picks: CalendarPick[];
  onConfirm: (picks: CalendarPick[]) => void;
}) {
  const [picks, setPicks] = useState(initial);
  const change = (index: number, patch: Partial<CalendarPick>) =>
    setPicks((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)));
  const shown = picks.filter((p) => p.show).length;
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-foreground">{email} is connected. Pick the calendars to show.</p>
      <div className="flex flex-col">
        {picks.map((pick, i) => (
          <PickRow
            key={pick.externalId}
            pick={pick}
            onShow={(show) => change(i, { show })}
            onBusy={(busy) => change(i, { busy })}
          />
        ))}
      </div>
      <div className="flex justify-end">
        <Button onClick={() => onConfirm(picks)}>
          Show {shown} {shown === 1 ? "calendar" : "calendars"} ↵
        </Button>
      </div>
    </div>
  );
}

export function ImportProgress({
  events,
  done,
  total,
  onClose,
}: {
  events: number;
  done: number;
  total: number;
  onClose: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-foreground">{importProgressLabel({ events, done, total })}</p>
      <Progress value={done} max={total} label="Import progress" />
      <p className="text-muted-foreground">You can close this; it carries on.</p>
      <div className="flex justify-end">
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  );
}
