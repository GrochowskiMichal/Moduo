import type { DateOrder, HourCycle } from "@contracts/vocabularies";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { getRuntime } from "../../../lib/runtime";
import { formatDate, formatTime } from "../../../lib/time-format";
import {
  applyTimeRegion,
  deviceDateOrder,
  deviceHour12,
  deviceWeekStart,
  rememberZoneAsked,
  saveTimeRegion,
  type TimeRegionPatch,
  useSavedTimeRegion,
  useTimeRegion,
  zoneCity,
} from "../../../lib/time-region";
import { useAuth } from "../../../providers/auth-provider";
import { PrefGroup, PrefRow } from "./preferences-section";
import { SettingsSectionShell } from "./section-shell";

const AUTO = "auto";
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEK_STARTS = [1, 0, 6] as const;
const SAMPLE = new Date(2026, 9, 16, 15, 0);

/** Every zone the browser knows, else the few this person needs. */
function knownZones(extra: ReadonlyArray<string | null>): string[] {
  let zones: string[] = [];
  try {
    const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    zones = supported ? supported("timeZone") : [];
  } catch {
    zones = [];
  }
  for (const z of [...extra, "UTC"]) if (z && !zones.includes(z)) zones.push(z);
  return zones;
}

/** "New York · America (GMT-4)". */
function zoneLabel(zone: string): string {
  const area = zone.includes("/") ? zone.split("/")[0]?.replace(/_/g, " ") : null;
  let offset = "";
  try {
    offset =
      new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "shortOffset" })
        .formatToParts(new Date())
        .find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    offset = "";
  }
  return [
    zoneCity(zone),
    area && area !== zoneCity(zone) ? `· ${area}` : "",
    offset ? `(${offset})` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * Settings → Time & region (TV-D14, REPLAN 76): one personal setting every
 * module reads, saved on the server so it follows the person; plus "Share your
 * tracked time with the workspace owner" (REPLAN 75).
 */
export function TimeRegionSection() {
  const { userId } = useAuth();
  const saved = useSavedTimeRegion();
  const resolved = useTimeRegion();
  const [busy, setBusy] = useState(false);
  const runtime = getRuntime();

  // The server's copy may be newer than this device's (changed elsewhere).
  useEffect(() => {
    if (!runtime || !userId) return;
    let live = true;
    runtime.preferences
      .getTimeRegion()
      .then((region) => {
        if (live && region) applyTimeRegion(region, userId);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [runtime, userId]);

  const zones = useMemo(
    () =>
      knownZones([saved.timeZone, resolved.deviceZone]).map((z) => ({
        value: z,
        label: zoneLabel(z),
      })),
    [saved.timeZone, resolved.deviceZone],
  );

  const save = (patch: TimeRegionPatch) => {
    if (!runtime) return;
    setBusy(true);
    saveTimeRegion(runtime.preferences, patch)
      .catch(() => toast.error("Couldn't save Time & region. Try again."))
      .finally(() => setBusy(false));
  };
  const pickZone = (zone: string) => {
    if (userId) rememberZoneAsked(userId, resolved.deviceZone);
    save({ timeZone: zone });
  };

  const autoWeek = DAY_NAMES[deviceWeekStart()] ?? "Monday";
  const autoClock = deviceHour12() ? "12-hour" : "24-hour";
  const autoOrder = deviceDateOrder() === "day_month" ? "16 Oct" : "Oct 16";
  const device = resolved.deviceZone;
  const differs = device && saved.timeZone && device !== saved.timeZone;

  return (
    <SettingsSectionShell
      title="Time & region"
      description="How every date and time in Moduo reads, and the clock your day runs on. These follow you across your devices."
    >
      <PrefGroup label="Time & region">
        <PrefRow
          title="Time zone"
          description={
            differs
              ? `Repeats come back at midnight here, and reminders, due times and time reports use it. This computer is on ${zoneCity(device)} time.`
              : "Repeats come back at midnight here, and reminders, due times and time reports use it."
          }
        >
          <div className="flex flex-col items-end gap-1.5">
            <Select
              value={saved.timeZone ?? device ?? "UTC"}
              onValueChange={pickZone}
              disabled={busy}
            >
              <SelectTrigger className="w-64" aria-label="Time zone">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {zones.map((z) => (
                  <SelectItem key={z.value} value={z.value}>
                    {z.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {differs ? (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => pickZone(device)}>
                Use {zoneCity(device)} time
              </Button>
            ) : null}
          </div>
        </PrefRow>
        <PrefRow
          title="Week starts on"
          description="Calendar weeks, This week and Next week follow it."
        >
          <Select
            value={saved.weekStart === null ? AUTO : String(saved.weekStart)}
            onValueChange={(v) => save({ weekStart: v === AUTO ? null : Number(v) })}
            disabled={busy}
          >
            <SelectTrigger className="w-44" aria-label="Week starts on">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Automatic ({autoWeek})</SelectItem>
              {WEEK_STARTS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  {DAY_NAMES[d]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PrefRow>
        <PrefRow title="Clock" description={`Times read like ${formatTime(SAMPLE)}.`}>
          <Select
            value={saved.hourCycle ?? AUTO}
            onValueChange={(v) => save({ hourCycle: v === AUTO ? null : (v as HourCycle) })}
            disabled={busy}
          >
            <SelectTrigger className="w-44" aria-label="Clock">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Automatic ({autoClock})</SelectItem>
              <SelectItem value="h12">12-hour (3:00 PM)</SelectItem>
              <SelectItem value="h23">24-hour (15:00)</SelectItem>
            </SelectContent>
          </Select>
        </PrefRow>
        <PrefRow title="Date order" description={`Dates read like ${formatDate(SAMPLE, SAMPLE)}.`}>
          <Select
            value={saved.dateOrder ?? AUTO}
            onValueChange={(v) => save({ dateOrder: v === AUTO ? null : (v as DateOrder) })}
            disabled={busy}
          >
            <SelectTrigger className="w-44" aria-label="Date order">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUTO}>Automatic ({autoOrder})</SelectItem>
              <SelectItem value="month_day">Month first (Oct 16)</SelectItem>
              <SelectItem value="day_month">Day first (16 Oct)</SelectItem>
            </SelectContent>
          </Select>
        </PrefRow>
      </PrefGroup>

      <PrefGroup
        label="Tracked time"
        description="A task's total always counts everyone's time. Who tracked what stays private unless you share it."
      >
        <PrefRow
          title="Share your tracked time with the workspace owner"
          description="Owners see your entries (length, day and note) in their time reports, only on tasks they can see. In every workspace you're in."
        >
          <Switch
            checked={saved.shareTimeWithOwner}
            disabled={busy}
            onCheckedChange={(on) => save({ shareTimeWithOwner: on })}
            aria-label="Share your tracked time with the workspace owner"
          />
        </PrefRow>
      </PrefGroup>
    </SettingsSectionShell>
  );
}
