// The Booking link view in the right panel (CALR-17, AC31, AC32): the link's
// settings at a glance, the quick edits (Taking bookings, Length, Focus time),
// its hosts, who booked, and how many open times this week has. Presentational:
// the page's hook reads and writes.

import { Copy } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";

import { Button } from "../../../components/ui/button";
import { Checkbox } from "../../../components/ui/checkbox";
import { PropertyRow } from "../../../components/ui/property-row";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Switch } from "../../../components/ui/switch";
import { formatDayTime } from "../../../lib/time-format";
import type { OpenTimes } from "../booking/availability";
import { type BookingLink, FOCUS_BUSY_ID, TASKS_BUSY_ID } from "../booking/model";
import { durationPhrase, zoneLabel } from "../booking/sentence";
import { normalizeWeeklyHours, WEEKDAYS } from "../booking/slots";
import { VIDEO_LABEL } from "../booking/video";
import type { CalendarAccountModel } from "../events";

export type BookingLinkPanelProps = {
  link: BookingLink;
  url: string;
  hosts: { userId: string; name: string; status: string }[];
  bookings: { id: string; name: string; email: string; startsAt: string }[];
  open: OpenTimes;
  accounts: CalendarAccountModel[];
  landsIn: string;
  /** An event is selected on the week: ⌘C is the week's then. */
  hasSelection: boolean;
  onPatch: (patch: {
    paused?: boolean;
    durationMinutes?: number;
    busyCalendarIds?: string[];
  }) => void;
  onEdit: () => void;
  onGuestView: () => void;
};

// "15 30 45 60 min" fits the panel's value column; each segment still says "N min".
const LENGTHS = [15, 30, 45, 60].map((n) => ({
  value: String(n),
  label: String(n),
  ariaLabel: `${n} min`,
}));

const HOST_STATUS: Record<string, string> = {
  accepted: "accepted",
  declined: "declined",
};

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.matches("input, textarea, [contenteditable]");
}

function useCopy(url: string, hasSelection: boolean) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(url).then(
      () => setCopied(true),
      () => toast.error("Couldn't copy the link."),
    );
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || hasSelection || e.key.toLowerCase() !== "c") return;
      if (!(e.metaKey || e.ctrlKey) || isTyping(e.target)) return;
      if (e.repeat || window.getSelection()?.toString()) return;
      copy();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [url, hasSelection]);
  return { copied, copy };
}

/** "Mon Tue Wed Thu Fri 09:00–17:00", one line per distinct set of hours. */
function hoursSummary(raw: unknown): string[] {
  const hours = normalizeWeeklyHours(raw);
  const byWindows = new Map<string, string[]>();
  for (const day of WEEKDAYS) {
    if (hours[day].length === 0) continue;
    const key = hours[day].map((w) => `${w.start}–${w.end}`).join(", ");
    byWindows.set(key, [...(byWindows.get(key) ?? []), day[0].toUpperCase() + day.slice(1)]);
  }
  return [...byWindows].map(([windows, days]) => `${days.join(" ")} ${windows}`);
}

function busyNames(link: BookingLink, accounts: CalendarAccountModel[]): string {
  const names = link.busyCalendarIds.flatMap((id) => {
    if (id === "moduo") return ["Your calendar · Moduo"];
    if (id === TASKS_BUSY_ID) return ["Work sessions"];
    const account = accounts.find((a) => a.id === id);
    return account ? [account.displayLabel] : [];
  });
  return names.join(", ") || "Nothing";
}

function limitsText(link: BookingLink): string {
  const buffer = link.bufferBeforeMinutes + link.bufferAfterMinutes;
  return [
    buffer > 0 ? `${buffer} min buffer` : "No buffer",
    link.minNoticeMinutes > 0 ? `${durationPhrase(link.minNoticeMinutes)} notice` : "No notice",
    `${link.horizonDays} days ahead`,
  ].join(" · ");
}

function weekCount(open: OpenTimes): string {
  const n = open.times.length;
  if (n === 0) return "No open times this week";
  return n === 1 ? "1 open time this week" : `${n} open times this week`;
}

function HostsRow({ hosts, open }: Pick<BookingLinkPanelProps, "hosts" | "open">) {
  if (hosts.length === 0) return <span className="text-base text-foreground">Only you</span>;
  return (
    <div className="flex flex-col gap-0.5 text-base text-foreground">
      <span>Only times you're all free</span>
      {hosts.map((h) => (
        <span key={h.userId} className="text-sm text-muted-foreground">
          {h.name} · {HOST_STATUS[h.status] ?? "hasn't accepted"}
        </span>
      ))}
      {open.state === "waiting" ? (
        <span className="text-sm text-muted-foreground">
          Paused until {open.waitingOn.join(", ")} accepts
        </span>
      ) : null}
    </div>
  );
}

function BookedRow({ bookings }: Pick<BookingLinkPanelProps, "bookings">) {
  if (bookings.length === 0) {
    return <span className="text-base text-muted-foreground">No bookings yet</span>;
  }
  return (
    <ul className="flex flex-col gap-0.5">
      {bookings.map((b) => (
        <li key={b.id} className="flex flex-col">
          <span className="text-base text-foreground">{b.name}</span>
          <span className="text-sm text-muted-foreground">{formatDayTime(b.startsAt)}</span>
        </li>
      ))}
    </ul>
  );
}

function FocusRow({ link, onPatch }: Pick<BookingLinkPanelProps, "link" | "onPatch">) {
  const id = useId();
  const on = link.busyCalendarIds.includes(FOCUS_BUSY_ID);
  return (
    <span className="flex items-center gap-2">
      <Checkbox
        id={id}
        checked={on}
        onCheckedChange={() =>
          onPatch({
            busyCalendarIds: on
              ? link.busyCalendarIds.filter((x) => x !== FOCUS_BUSY_ID)
              : [...link.busyCalendarIds, FOCUS_BUSY_ID],
          })
        }
      />
      <label htmlFor={id} className="text-base text-foreground">
        Focus time
      </label>
    </span>
  );
}

const value = "text-base text-foreground break-words";

export function BookingLinkPanel(props: BookingLinkPanelProps) {
  const { link, url, open, onPatch } = props;
  const { copied, copy } = useCopy(url, props.hasSelection);
  const where =
    link.videoProvider === "guest_choice" ? "Their choice" : VIDEO_LABEL[link.videoProvider];
  const asks = link.questions.map((q) => q.label).join(", ") || "Name and email only";
  return (
    <div className="flex flex-col gap-3 px-1 py-2">
      <h2 className="font-display text-lg font-medium text-foreground">{link.name}</h2>
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{url}</span>
        <Button type="button" variant="ghost" size="sm" onClick={copy}>
          <Copy aria-hidden />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <div className="flex flex-col">
        <PropertyRow label="Taking bookings">
          <Switch
            aria-label="Taking bookings"
            checked={!link.paused}
            onCheckedChange={(on) => onPatch({ paused: !on })}
          />
          {link.paused ? (
            <span className="ml-2 text-sm text-muted-foreground">Paused: guests can't book</span>
          ) : null}
        </PropertyRow>
        <PropertyRow label="Preview">
          <Button type="button" variant="ghost" size="sm" onClick={props.onGuestView}>
            Guest's view
          </Button>
        </PropertyRow>
        <PropertyRow label="Length">
          <SegmentedControl
            aria-label="Length"
            size="sm"
            value={String(link.durationMinutes)}
            items={LENGTHS}
            onValueChange={(v) => onPatch({ durationMinutes: Number(v) })}
          />
          <span aria-hidden className="ml-1.5 text-sm text-muted-foreground">
            min
          </span>
        </PropertyRow>
        <PropertyRow label="When" align="start">
          <span className={value}>
            {[...hoursSummary(link.weeklyHours), zoneLabel(link.hostTimeZone)].join(" · ")}
          </span>
        </PropertyRow>
        <PropertyRow label="Lands in">
          <span className={value}>{props.landsIn}</span>
        </PropertyRow>
        <PropertyRow label="Where">
          <span className={value}>{where}</span>
        </PropertyRow>
        <PropertyRow label="Busy from" align="start">
          <div className="flex flex-col gap-1">
            <span className={value}>{busyNames(link, props.accounts)}</span>
            <FocusRow link={link} onPatch={onPatch} />
          </div>
        </PropertyRow>
        <PropertyRow label="Hosts" align="start">
          <HostsRow hosts={props.hosts} open={open} />
        </PropertyRow>
        <PropertyRow label="Limits">
          <span className={value}>{limitsText(link)}</span>
        </PropertyRow>
        <PropertyRow label="Asks" align="start">
          <span className={value}>{asks}</span>
        </PropertyRow>
        <PropertyRow label="Booked" align="start">
          <BookedRow bookings={props.bookings} />
        </PropertyRow>
        <PropertyRow label="This week">
          <span className={value}>{weekCount(open)}</span>
        </PropertyRow>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        onClick={props.onEdit}
      >
        Edit…
      </Button>
    </div>
  );
}
