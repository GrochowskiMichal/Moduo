// A booking link's open times for the week shown (CALR-17, AC31, AC32). Pure.
// The busy rule matches booking-public's (supabase/functions/_shared/booking-busy.ts)
// and the slots come from the same computeOpenSlots, so the panel's outlines
// are the guest page's times. Repeats count at every occurrence in the week,
// skipped ones left out (a moved one is its own row), as the server expands
// them (calendar__booking_host_events).

import { expandEventOccurrences } from "../recurrence-expand";
import { FOCUS_BUSY_ID, TASKS_BUSY_ID } from "./model";
import { computeOpenSlots, type Interval, type WeeklyHours } from "./slots";

export type OpenTimesInput = {
  link: {
    durationMinutes: number;
    bufferBeforeMinutes: number;
    bufferAfterMinutes: number;
    horizonDays: number;
    minNoticeMinutes: number;
    hostTimeZone: string;
    weeklyHours: unknown;
    busyCalendarIds: string[];
    paused: boolean;
  };
  hostId: string;
  events: (Repeatable & {
    ownerId: string | null;
    sourceAccountId: string | null;
    calendarId: string | null;
    startsAt: string;
    endsAt: string;
    kind?: string | null;
    deletedAt: string | null;
  })[];
  sessions?: { userId: string | null; startsAt: string; endsAt: string }[];
  bookings?: { startsAt: string; endsAt: string }[];
  /** Co-hosts, without the link's owner. */
  hosts?: { userId: string; name: string; status: string }[];
  /**
   * What the app can see of accepted co-hosts' time (their events and busy
   * blocks): it only ever takes times away from the guest page's answer.
   */
  coHostBusy?: Repeatable[];
  /** The guest page's slots (its preview answer), once read. */
  guestSlots?: string[] | null;
  now: Date;
  from: Date;
  to: Date;
};

/** A busy span, or a repeat's first one with its rule and skipped starts. */
type Repeatable = {
  id?: string;
  startsAt: string;
  endsAt: string;
  rrule?: string | null;
  exdates?: string[];
};

export type OpenTime = { startMs: number; endMs: number };

export type OpenTimes =
  | { state: "open"; times: OpenTime[] }
  | { state: "paused"; times: [] }
  | { state: "waiting"; waitingOn: string[]; times: [] };

type Ev = OpenTimesInput["events"][number];

const span = (r: { startsAt: string; endsAt: string }): Interval => ({
  start: new Date(r.startsAt),
  end: new Date(r.endsAt),
});

function eventIsBusy(e: Ev, ids: Set<string>): boolean {
  if (e.kind === "focus") return ids.has(FOCUS_BUSY_ID);
  const calendarId = e.calendarId ?? "moduo";
  if (e.sourceAccountId != null) return ids.has(e.sourceAccountId);
  return (calendarId === "moduo" || calendarId === "") && ids.has("moduo");
}

// A day either side of the week: room for buffers and an occurrence under way.
const DAY_MS = 86_400_000;

function occurrences(rows: readonly Repeatable[], fromMs: number, toMs: number): Interval[] {
  return rows.flatMap((r) =>
    r.rrule
      ? expandEventOccurrences(
          {
            id: r.id ?? "",
            startsAt: r.startsAt,
            endsAt: r.endsAt,
            rrule: r.rrule,
            exdates: r.exdates,
          },
          fromMs,
          toMs,
        ).map((o) => ({ start: new Date(o.startMs), end: new Date(o.endMs) }))
      : [span(r)],
  );
}

function busyFor(input: OpenTimesInput): Interval[] {
  const ids = new Set(input.link.busyCalendarIds);
  const own = input.events.filter(
    (e) => e.ownerId === input.hostId && e.deletedAt == null && eventIsBusy(e, ids),
  );
  const sessions = ids.has(TASKS_BUSY_ID)
    ? (input.sessions ?? []).filter((s) => s.userId === input.hostId)
    : [];
  const fromMs = input.from.getTime() - DAY_MS;
  const toMs = input.to.getTime() + DAY_MS;
  return [
    ...occurrences([...own, ...(input.coHostBusy ?? [])], fromMs, toMs),
    ...[...sessions, ...(input.bookings ?? [])].map(span),
  ];
}

function nearGuestSlot(ms: number, guest: number[]): boolean {
  return guest.some((g) => Math.abs(g - ms) <= 1000);
}

export function openTimes(input: OpenTimesInput): OpenTimes {
  const { link } = input;
  if (link.paused) return { state: "paused", times: [] };
  const hosts = input.hosts ?? [];
  const waitingOn = hosts.filter((h) => h.status !== "accepted").map((h) => h.name);
  if (waitingOn.length > 0) return { state: "waiting", waitingOn, times: [] };
  const guestSlots = input.guestSlots ?? null;
  if (hosts.length > 0 && guestSlots == null) return { state: "open", times: [] };

  const slots = computeOpenSlots({
    now: input.now,
    hostTimeZone: link.hostTimeZone,
    weeklyHours: link.weeklyHours as WeeklyHours,
    durationMinutes: link.durationMinutes,
    bufferBeforeMinutes: link.bufferBeforeMinutes,
    bufferAfterMinutes: link.bufferAfterMinutes,
    horizonDays: link.horizonDays,
    minNoticeMinutes: link.minNoticeMinutes,
    busy: busyFor(input),
  });
  const from = input.from.getTime();
  const to = input.to.getTime();
  const guest = guestSlots?.map((s) => Date.parse(s));
  const times = slots
    .map((d) => d.getTime())
    .filter((ms) => ms >= from && ms < to && (!guest || nearGuestSlot(ms, guest)))
    .map((startMs) => ({ startMs, endMs: startMs + link.durationMinutes * 60_000 }));
  return { state: "open", times };
}
