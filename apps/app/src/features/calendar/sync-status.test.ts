// AC2: when one account fails to sync, the banner names it, says what is stale
// since when and what is current, and offers Try again; that account's events
// keep showing with a sync mark; the week never reads "Nothing scheduled".
// This file pins the pure half: which accounts are stale, the banner's words,
// the rail's "Not synced · 9:12" and the empty-week hint's guard.

import { describe, expect, it } from "@rstest/core";

import type { CalendarAccountModel } from "./events";
import {
  calendarSyncStatus,
  emptyWeekHint,
  notSyncedLabel,
  syncBannerText,
  syncSinceLabel,
} from "./sync-status";
import { formatTimeOfDay } from "./ui/time-format";

const now = new Date(2026, 9, 28, 11, 40).getTime();
const nineTwelve = new Date(2026, 9, 28, 9, 12);
const sundayEvening = new Date(2026, 9, 25, 18, 2);

function account(over: Partial<CalendarAccountModel>): CalendarAccountModel {
  return {
    id: "a",
    workspaceId: "w1",
    ownerId: "u1",
    provider: "google",
    externalId: "google:robin.hale@gmail.com:primary",
    displayLabel: "Personal",
    isDefaultTarget: false,
    color: null,
    lastSyncAt: new Date(2026, 9, 28, 11, 30).toISOString(),
    status: "ok",
    syncToken: null,
    deletedAt: null,
    ...over,
  };
}

const personal = account({ id: "personal" });
const work = account({
  id: "work",
  externalId: "google:robin.hale@gmail.com:work",
  displayLabel: "Work",
  status: "error",
  lastSyncAt: nineTwelve.toISOString(),
});
const family = account({
  id: "family",
  externalId: "google:robin.hale@gmail.com:family",
  displayLabel: "Family",
  status: "error",
  lastSyncAt: sundayEvening.toISOString(),
});
const ana = account({
  id: "ana",
  externalId: "google:ana@halefounders.co:primary",
  displayLabel: "Ana",
});

describe("a failed account is scoped and its events stay", () => {
  it("marks only the failing account's calendars as stale", () => {
    const status = calendarSyncStatus({ accounts: [personal, work, ana], degraded: false });
    expect([...status.staleAccountIds]).toEqual(["work"]);
    expect(status.faulted).toBe(true);
    expect(status.loadFailed).toBe(false);
    expect(status.faults).toHaveLength(1);
    expect(status.faults[0].login).toBe("robin.hale@gmail.com");
    expect(status.faults[0].calendars).toEqual(["Work"]);
    expect(status.faults[0].staleSinceMs).toBe(nineTwelve.getTime());
  });

  it("says what is current: your own calendar first, then the accounts that synced", () => {
    const status = calendarSyncStatus({ accounts: [personal, work, ana], degraded: false });
    expect(status.current).toEqual(["Your calendar", "Personal", "Ana"]);
  });

  it("the banner names the account, what is stale since when, and what is current", () => {
    const status = calendarSyncStatus({ accounts: [personal, work, ana], degraded: false });
    const text = syncBannerText(status, now);
    expect(text).not.toBeNull();
    expect(text).toContain("robin.hale@gmail.com");
    expect(text).toContain("Google Calendar");
    expect(text).toContain(`Work shows as of ${formatTimeOfDay(nineTwelve.getTime())}`);
    expect(text).toContain("Your calendar, Personal and Ana are current");
  });

  it("two stale calendars of one login read as one fault, as of the older sync", () => {
    const status = calendarSyncStatus({ accounts: [personal, work, family], degraded: false });
    expect(status.faults).toHaveLength(1);
    expect(status.faults[0].calendars).toEqual(["Work", "Family"]);
    expect(status.faults[0].staleSinceMs).toBe(sundayEvening.getTime());
    const text = syncBannerText(status, now)!;
    expect(text).toContain("Work and Family show as of");
    expect(text).toContain(syncSinceLabel(sundayEvening.getTime(), now));
  });

  it("a calendar that never synced says so instead of a time", () => {
    const fresh = account({ ...work, lastSyncAt: null });
    const text = syncBannerText(calendarSyncStatus({ accounts: [fresh], degraded: false }), now)!;
    expect(text).toContain("Work hasn't synced yet");
    expect(text).toContain("Your calendar is current");
  });

  it("everything synced: no banner, nothing stale", () => {
    const status = calendarSyncStatus({ accounts: [personal, ana], degraded: false });
    expect(status.faulted).toBe(false);
    expect(status.staleAccountIds.size).toBe(0);
    expect(syncBannerText(status, now)).toBeNull();
  });

  it("a removed account is never a fault", () => {
    const gone = account({ ...work, deletedAt: new Date(now).toISOString() });
    expect(calendarSyncStatus({ accounts: [gone], degraded: false }).faulted).toBe(false);
  });

  it("a read that failed is a fault of its own, said plainly", () => {
    const status = calendarSyncStatus({ accounts: [], degraded: true });
    expect(status.loadFailed).toBe(true);
    expect(status.faulted).toBe(true);
    const text = syncBannerText(status, now)!;
    expect(text).toContain("didn't load");
    expect(text).toContain("Tasks are current");
  });
});

describe("since labels", () => {
  it("today is a time; an earlier day carries its weekday", () => {
    expect(syncSinceLabel(nineTwelve.getTime(), now)).toBe(formatTimeOfDay(nineTwelve.getTime()));
    const earlier = syncSinceLabel(sundayEvening.getTime(), now);
    expect(earlier).toContain(formatTimeOfDay(sundayEvening.getTime()));
    expect(earlier).toMatch(/Sunday/);
  });

  it("the account group says Not synced · 9:12", () => {
    expect(notSyncedLabel(work, now)).toBe(`Not synced · ${formatTimeOfDay(nineTwelve.getTime())}`);
    expect(notSyncedLabel({ lastSyncAt: null }, now)).toBe("Not synced");
  });
});

describe("the week never reads Nothing scheduled over a fault", () => {
  const quiet = { loading: false, failed: false, hasAnyChips: false, drafting: false };

  it("an empty, healthy week gets the hint", () => {
    expect(emptyWeekHint(quiet)).toMatch(/Nothing scheduled/);
  });

  it("a fault, a load or anything on the grid keeps it away", () => {
    expect(emptyWeekHint({ ...quiet, failed: true })).toBeNull();
    expect(emptyWeekHint({ ...quiet, loading: true })).toBeNull();
    expect(emptyWeekHint({ ...quiet, hasAnyChips: true })).toBeNull();
    expect(emptyWeekHint({ ...quiet, drafting: true })).toBeNull();
  });
});
