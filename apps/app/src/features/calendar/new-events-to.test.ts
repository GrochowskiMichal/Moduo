// CALR-20b contract: the "New events go to" setting (specs/calendar-rethink.md,
// Assumptions "New events go to ... one event, never two"). Your calendar · Moduo
// by default, or any writable calendar of a connected Google login; a chosen
// calendar that disappears, turns read-only or waits on a reconnect falls back
// to Your calendar, and says so.

process.env.TZ = "Europe/Warsaw";

import { describe, expect, it } from "@rstest/core";

import { type ComposerAccount, planComposer } from "./composer/defaults";
import { type ComposerContext, parseComposer } from "./composer/parse";
import type { CalendarAccountModel } from "./events";
import {
  chosenNewEventsTo,
  newEventsCalendars,
  resolveNewEventsTo,
  withNewEventsTo,
  YOUR_CALENDAR_LABEL,
} from "./new-events-to";
import { DEFAULT_CALENDAR_PREFS, sanitizeCalendarPrefs } from "./prefs";

function account(over: Partial<CalendarAccountModel> & { id: string }): CalendarAccountModel {
  return {
    workspaceId: "w1",
    ownerId: "u1",
    provider: "google",
    externalId: `google:robin@gmail.com:${over.id}`,
    displayLabel: over.id,
    isDefaultTarget: false,
    color: null,
    lastSyncAt: null,
    status: "ok",
    syncToken: null,
    deletedAt: null,
    readOnly: false,
    busyDefault: true,
    lastError: null,
    ...over,
  };
}

const WORK = account({ id: "acc-work", displayLabel: "Work" });
const FAMILY = account({ id: "acc-family", displayLabel: "Family" });
const HOLIDAYS = account({ id: "acc-holidays", displayLabel: "Holidays", readOnly: true });
const OLD = account({ id: "acc-old", displayLabel: "Old", status: "reauth" });
const GONE = account({ id: "acc-gone", displayLabel: "Gone", deletedAt: "2026-10-27T10:00:00Z" });
const ICS = account({ id: "acc-ics", provider: "ics", externalId: "x", displayLabel: "Feed" });
const OUTLOOK = account({ id: "acc-ms", provider: "microsoft", displayLabel: "Outlook" });
const ALL = [WORK, FAMILY, HOLIDAYS, OLD, GONE, ICS, OUTLOOK];

describe("which calendars the setting offers", () => {
  it("offers only writable, connected Google calendars that don't wait on a reconnect", () => {
    expect(newEventsCalendars(ALL).map((c) => c.id)).toEqual(["acc-work", "acc-family"]);
    expect(newEventsCalendars(ALL).map((c) => c.label)).toEqual(["Work", "Family"]);
  });

  it("offers nothing beyond Your calendar without Google", () => {
    expect(newEventsCalendars([ICS, OUTLOOK])).toEqual([]);
  });
});

describe("where new events go", () => {
  it("goes to Your calendar · Moduo by default", () => {
    expect(resolveNewEventsTo(null, ALL)).toEqual({
      accountId: null,
      label: YOUR_CALENDAR_LABEL,
      fallback: null,
    });
    expect(YOUR_CALENDAR_LABEL).toBe("Your calendar · Moduo");
  });

  it("goes to the chosen Google calendar while it can take events", () => {
    expect(resolveNewEventsTo("acc-family", ALL)).toEqual({
      accountId: "acc-family",
      label: "Family",
      fallback: null,
    });
  });

  it.each([
    ["removed", "acc-gone"],
    ["no longer connected", "acc-unknown"],
    ["read-only now", "acc-holidays"],
    ["waiting on a reconnect", "acc-old"],
    ["not a Google calendar", "acc-ics"],
  ])("falls back to Your calendar, and says so, when the chosen one is %s", (_why, id) => {
    const to = resolveNewEventsTo(id, ALL);
    expect(to.accountId).toBeNull();
    expect(to.label).toBe(YOUR_CALENDAR_LABEL);
    expect(to.fallback).toMatch(/Your calendar/);
  });

  it("names the calendar it fell back from when it still knows it", () => {
    expect(resolveNewEventsTo("acc-holidays", ALL).fallback).toMatch(/Holidays/);
    expect(resolveNewEventsTo("acc-old", ALL).fallback).toMatch(/Old/);
  });
});

describe("the setting is synced, per workspace", () => {
  it("defaults to nothing chosen", () => {
    expect(DEFAULT_CALENDAR_PREFS.newEventsTo).toEqual({});
    expect(chosenNewEventsTo(DEFAULT_CALENDAR_PREFS, "w1")).toBeNull();
  });

  it("keeps a choice per workspace and drops anything that isn't an account id", () => {
    const prefs = sanitizeCalendarPrefs({
      newEventsTo: { w1: "acc-family", w2: 42, w3: "", w4: null },
    });
    expect(prefs.newEventsTo).toEqual({ w1: "acc-family" });
    expect(chosenNewEventsTo(prefs, "w1")).toBe("acc-family");
    expect(chosenNewEventsTo(prefs, "w2")).toBeNull();
    expect(sanitizeCalendarPrefs({ newEventsTo: "acc-family" }).newEventsTo).toEqual({});
  });

  it("sets and clears one workspace's choice without touching the others", () => {
    const prefs = sanitizeCalendarPrefs({ newEventsTo: { w1: "acc-family", w2: "acc-x" } });
    expect(withNewEventsTo(prefs, "w1", "acc-work")).toEqual({
      newEventsTo: { w1: "acc-work", w2: "acc-x" },
    });
    expect(withNewEventsTo(prefs, "w1", null)).toEqual({ newEventsTo: { w2: "acc-x" } });
  });
});

// ── The composer follows the setting ─────────────────────────────────────────

const NOW = new Date(2026, 9, 28, 10, 7).getTime();
const COMPOSER: ComposerAccount[] = [
  {
    id: "acc-main",
    provider: "google",
    externalId: "google:robin@gmail.com:robin@gmail.com",
    label: "robin@gmail.com",
    isDefaultTarget: false,
  },
  {
    id: "acc-family",
    provider: "google",
    externalId: "google:robin@gmail.com:family123@group.calendar.google.com",
    label: "Family",
    isDefaultTarget: true,
  },
];

function plan(text: string, accounts: ComposerAccount[] = COMPOSER) {
  const ctx: ComposerContext = {
    nowMs: NOW,
    base: { dayStartMs: new Date(2026, 9, 28).getTime(), startMinute: 11 * 60 },
    workStartMinute: 9 * 60,
    workEndMinute: 18 * 60,
    busyOn: () => [],
    calendars: [
      { id: "moduo", name: "Your calendar", google: false },
      ...accounts.map((a) => ({ id: a.id, name: a.label, google: true })),
    ],
    people: [{ id: "c-priya", name: "Priya Shah", email: "priya@acme.com", member: false }],
  };
  return planComposer(parseComposer(text, ctx), { accounts });
}

describe("the composer puts new events where the setting says", () => {
  it("an event with nobody goes to the chosen Google calendar", () => {
    expect(plan("Deep think").target).toEqual({ kind: "google", accountId: "acc-family" });
  });

  it("an event with outside guests goes there too, so Google invites them", () => {
    const p = plan("Coffee with Priya Shah");
    expect(p.target).toEqual({ kind: "google", accountId: "acc-family" });
    expect(p.invites).toBe(true);
  });

  it("focus time stays on Your calendar", () => {
    expect(plan("focus Write the spec tomorrow 9am").target).toEqual({
      kind: "moduo",
      calendarId: null,
    });
  });

  it("#calendar still wins", () => {
    expect(plan("Retro #robin").target).toEqual({ kind: "google", accountId: "acc-main" });
    expect(plan("Retro #me").target).toEqual({ kind: "moduo", calendarId: null });
  });

  it("without a chosen calendar an event with nobody stays on Your calendar", () => {
    const none = COMPOSER.map((a) => ({ ...a, isDefaultTarget: false }));
    expect(plan("Deep think", none).target).toEqual({ kind: "moduo", calendarId: null });
  });
});
