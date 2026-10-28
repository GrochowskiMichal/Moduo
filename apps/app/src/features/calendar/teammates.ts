// Teammates beside your week (CALR-16, specs/calendar-rethink.md AC30, §Sharing
// "Shared with you"). Pure: the inputs are what the server already masked
// (calendar_shared_with_me, the masked read, calendar_busy_blocks); nothing is
// masked or renamed here.

import type { CalendarItemKind } from "@contracts/vocabularies";

import { LABEL_COLORS, type LabelColor } from "../../components/tag-colors";
import {
  type BusyBlockRow,
  busyBlockToEvent as busyRowToEvent,
  type SharedCalendar,
} from "../../lib/calendar-busy";
import type { CalendarEventModel } from "./events";
import { expandEventOccurrences } from "./recurrence-expand";

export type { BusyBlockRow, SharedCalendar };

export const busyBlockToEvent: (
  row: BusyBlockRow,
  workspaceId: string,
  i: number,
) => CalendarEventModel = busyRowToEvent;

export type Teammate = { userId: string; name: string; level: SharedCalendar["level"] };

export type TeammateBlock = {
  ownerId: string;
  calendarId: string;
  kind: CalendarItemKind;
  /** The masked read's title; null for a busy block. */
  title: string | null;
  /** The event row; null for a busy block. */
  eventId: string | null;
  startMs: number;
  endMs: number;
};

/** Each teammate sharing with you once, at their highest level, by name. */
export function teammatesSharing(
  shared: SharedCalendar[],
  members: { userId: string; name: string }[],
  me: string,
): Teammate[] {
  const out = new Map<string, Teammate>();
  for (const s of shared) {
    const m = members.find((x) => x.userId === s.ownerId);
    if (!m || m.userId === me) continue;
    const prev = out.get(m.userId);
    if (!prev || s.level === "view")
      out.set(m.userId, { userId: m.userId, name: m.name, level: s.level });
  }
  return [...out.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export const toggleTeammate = (on: string[], id: string): string[] =>
  on.includes(id) ? on.filter((x) => x !== id) : [...on, id];

/** Lanes: the teammates turned on, then the ones named in the composer. */
export const laneOwners = (shown: string[], named: string[]): string[] => [
  ...shown,
  ...named.filter((id, i) => !shown.includes(id) && named.indexOf(id) === i),
];

export function legendLine(shown: Teammate[]): string {
  if (shown.length === 0) return "";
  const parts = shown.map((t) => `${t.name} ${t.level === "view" ? "all details" : "busy only"}`);
  return ["Beside your week", ...parts].join(" · ");
}

const isTheirs = (e: CalendarEventModel, cals: Set<string>) =>
  e.calendarId === "busy" || (!!e.calendarRef && cals.has(e.calendarRef));

/** Teammates' events (on their calendars, and busy blocks) leave your week. */
export function splitTeammateEvents(
  events: CalendarEventModel[],
  shared: SharedCalendar[],
): { mine: CalendarEventModel[]; theirs: CalendarEventModel[] } {
  const cals = new Set(shared.map((s) => s.calendarId));
  return {
    mine: events.filter((e) => !isTheirs(e, cals)),
    theirs: events.filter((e) => isTheirs(e, cals)),
  };
}

function blocksOf(
  e: CalendarEventModel,
  ownerId: string,
  window: { startMs: number; endMs: number },
): TeammateBlock[] {
  const busy = e.calendarId === "busy";
  return expandEventOccurrences(e, window.startMs, window.endMs).map((o) => ({
    ownerId,
    calendarId: e.calendarRef ?? "",
    kind: e.kind ?? "event",
    title: busy ? null : e.title,
    eventId: busy ? null : e.id,
    startMs: o.startMs,
    endMs: o.endMs,
  }));
}

/** The timed blocks of teammates' events in a window, repeats expanded, by start. */
export function teammateBlocks(
  events: CalendarEventModel[],
  shared: SharedCalendar[],
  window: { startMs: number; endMs: number },
): TeammateBlock[] {
  const owner = new Map(shared.map((s) => [s.calendarId, s.ownerId]));
  return events
    .flatMap((e) => {
      const ownerId = owner.get(e.calendarRef ?? "") ?? e.ownerId;
      return e.allDay || e.deletedAt || !ownerId ? [] : blocksOf(e, ownerId, window);
    })
    .sort((a, b) => a.startMs - b.startMs);
}

/** One lane per owner, in order, with the blocks touching the day. */
export const lanesForDay = (
  blocks: TeammateBlock[],
  owners: string[],
  dayStartMs: number,
  dayEndMs: number,
): { ownerId: string; blocks: TeammateBlock[] }[] =>
  owners.map((ownerId) => ({
    ownerId,
    blocks: blocks.filter(
      (b) => b.ownerId === ownerId && b.startMs < dayEndMs && b.endMs > dayStartMs,
    ),
  }));

const HUES = LABEL_COLORS.filter((h) => h !== "gray");

/** A hue per teammate: not one of yours while any is free, never the same as the one before. */
export function teammateHues(ids: string[], taken: string[]): Record<string, LabelColor> {
  const free = HUES.filter((h) => !taken.includes(h));
  const pool = free.length > 1 ? free : HUES;
  const out: Record<string, LabelColor> = {};
  let prev: LabelColor | null = null;
  ids.forEach((id, i) => {
    let hue = pool[i % pool.length];
    if (hue === prev) hue = pool[(i + 1) % pool.length];
    out[id] = hue;
    prev = hue;
  });
  return out;
}
