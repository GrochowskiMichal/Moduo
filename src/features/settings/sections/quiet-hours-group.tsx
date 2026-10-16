import { useState } from "react";
import { toast } from "sonner";

import { TimeInput } from "../../../components/ui/date-field";
import { Switch } from "../../../components/ui/switch";
import {
  DEFAULT_QUIET_RANGE,
  saveTimeRegion,
  useSavedTimeRegion,
  useTimeRegion,
  zoneCity,
} from "../../../lib/time-region";
import { useAuth } from "../../../providers/auth-provider";

import { PrefGroup, PrefRow } from "./preferences-section";

/**
 * Settings → Notifications · Quiet hours (CV-18, spec §15; CH7, CH41): one
 * switch and a range, in your Time & region zone, off by default. They hold
 * every module's notices (Tasks' reminders included): nothing pings and
 * nothing emails; the bell and Catch up keep everything. Saved through the
 * Time & region op, so they follow you across devices.
 */
export function QuietHoursGroup() {
  const { runtime } = useAuth();
  const saved = useSavedTimeRegion();
  const { timeZone } = useTimeRegion();
  const [busy, setBusy] = useState(false);
  const quiet = saved.quietHours;
  const from = quiet.from ?? DEFAULT_QUIET_RANGE.from;
  const to = quiet.to ?? DEFAULT_QUIET_RANGE.to;

  const save = (next: { on: boolean; from: string; to: string }) => {
    if (!runtime) return;
    if (next.from === next.to) {
      toast("Quiet hours start and end at different times.");
      return;
    }
    setBusy(true);
    // The server reads quiet hours in the saved zone: save the one named here
    // when none is saved yet (as signing in does), so both read the same clock.
    saveTimeRegion(runtime.preferences, {
      quietHours: next,
      ...(saved.timeZone ? {} : { timeZone }),
    })
      .catch(() => toast.error("Couldn't save quiet hours. Try again."))
      .finally(() => setBusy(false));
  };

  return (
    <PrefGroup
      label="Quiet hours"
      description={`Notifications from every module stay silent during quiet hours. Nothing is lost: your bell and Catch up keep everything. Times are in ${zoneCity(timeZone)} time (Time & region).`}
    >
      <PrefRow title="Quiet hours" description="No notifications and no emails while they're on.">
        <Switch
          checked={quiet.on}
          disabled={!runtime || busy}
          onCheckedChange={(on) => save({ on, from, to })}
          aria-label="Quiet hours"
        />
      </PrefRow>
      {quiet.on ? (
        <PrefRow
          title="From"
          description="A range that ends earlier than it starts runs overnight."
        >
          <div className="flex items-center gap-2">
            <TimeInput
              value={from}
              disabled={busy}
              className="w-24"
              onValueChange={(v) => save({ on: true, from: v, to })}
              aria-label="Quiet hours start"
            />
            <span className="text-sm text-muted-foreground">to</span>
            <TimeInput
              value={to}
              disabled={busy}
              className="w-24"
              onValueChange={(v) => save({ on: true, from, to: v })}
              aria-label="Quiet hours end"
            />
          </div>
        </PrefRow>
      ) : null}
    </PrefGroup>
  );
}
