// AC2, quiet by default: a sync that fails retries in the background and says
// nothing for its first QUIET_STALE_MS. Past that, the account's events carry the
// sync mark and its rail row a muted "Last synced …", never a banner. A banner
// speaks only when the person must act: a login Google stopped accepting, or a
// calendar read that failed outright. The week never reads "Nothing scheduled"
// while anything is stale. This file pins the pure half.

import { describe, expect, it } from "@rstest/core";

import type { CalendarAccountModel } from "./events";
import {
  accountSyncNote,
  calendarSyncStatus,
  emptyWeekHint,
  QUIET_STALE_MS,
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

describe("a failing account is quiet until it has been stale for hours", () => {
  it("a failure this morning says nothing: no mark, no banner, no rail note", () => {
    const status = calendarSyncStatus({ accounts: [personal, work, ana], degraded: false, now });
    expect(status.staleAccountIds.size).toBe(0);
    expect(status.faulted).toBe(false);
    expect(syncBannerText(status, now)).toBeNull();
    expect(accountSyncNote(work, now)).toBeNull();
    expect(status.current).toEqual(["Your calendar", "Personal", "Work", "Ana"]);
  });

  it("just under the quiet hours it is still quiet; at them it is stale", () => {
    const at = nineTwelve.getTime();
    expect(
      calendarSyncStatus({ accounts: [work], degraded: false, now: at + QUIET_STALE_MS - 1 })
        .faulted,
    ).toBe(false);
    expect(
      calendarSyncStatus({ accounts: [work], degraded: false, now: at + QUIET_STALE_MS }).faulted,
    ).toBe(true);
  });

  it("past the quiet hours its events carry the mark and its row says when it last synced, never a banner", () => {
    const status = calendarSyncStatus({ accounts: [personal, family, ana], degraded: false, now });
    expect([...status.staleAccountIds]).toEqual(["family"]);
    expect(status.faulted).toBe(true);
    expect(status.faults[0].login).toBe("robin.hale@gmail.com");
    expect(status.faults[0].staleSinceMs).toBe(sundayEvening.getTime());
    expect(syncBannerText(status, now)).toBeNull();
    expect(accountSyncNote(family, now)).toEqual({
      text: `Last synced ${syncSinceLabel(sundayEvening.getTime(), now)}`,
      tone: "muted",
    });
    expect(status.current).toEqual(["Your calendar", "Personal", "Ana"]);
  });

  it("a calendar that never synced says so quietly", () => {
    const fresh = account({ ...work, lastSyncAt: null });
    const status = calendarSyncStatus({ accounts: [fresh], degraded: false, now });
    expect(status.staleAccountIds.has("work")).toBe(true);
    expect(syncBannerText(status, now)).toBeNull();
    expect(accountSyncNote(fresh, now)).toEqual({ text: "Not synced yet", tone: "muted" });
  });

  it("everything synced: nothing stale, nothing said", () => {
    const status = calendarSyncStatus({ accounts: [personal, ana], degraded: false, now });
    expect(status.faulted).toBe(false);
    expect(status.staleAccountIds.size).toBe(0);
    expect(syncBannerText(status, now)).toBeNull();
    expect(accountSyncNote(personal, now)).toBeNull();
  });

  it("a removed account is never a fault", () => {
    const gone = account({ ...family, deletedAt: new Date(now).toISOString() });
    expect(calendarSyncStatus({ accounts: [gone], degraded: false, now }).faulted).toBe(false);
  });

  it("a read that failed is a fault of its own, said plainly", () => {
    const status = calendarSyncStatus({ accounts: [], degraded: true, now });
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

describe("a revoked Google connection asks to reconnect (AC37)", () => {
  const familyReauth = account({
    id: "family",
    externalId: "google:robin.hale@gmail.com:family",
    displayLabel: "Family",
    status: "reauth",
    lastError: "invalid_grant",
    lastSyncAt: sundayEvening.toISOString(),
  });

  it("a reauth account is stale like a failed one: its events keep the sync mark", () => {
    const status = calendarSyncStatus({ accounts: [personal, familyReauth], degraded: false, now });
    expect([...status.staleAccountIds]).toEqual(["family"]);
    expect(status.faulted).toBe(true);
    expect(status.faults).toHaveLength(1);
    expect(status.faults[0].reauth).toBe(true);
    expect(status.faults[0].login).toBe("robin.hale@gmail.com");
    expect(status.current).not.toContain("Family");
  });

  it("a plain sync failure is not a reauth", () => {
    const status = calendarSyncStatus({ accounts: [personal, family], degraded: false, now });
    expect(status.faults[0].reauth).toBe(false);
  });

  it("a reauth asks at once: it never waits out the quiet hours", () => {
    const justNow = { ...familyReauth, lastSyncAt: new Date(now - 60_000).toISOString() };
    const status = calendarSyncStatus({ accounts: [justNow], degraded: false, now });
    expect(status.faults[0].reauth).toBe(true);
    expect(syncBannerText(status, now)).toContain("Google stopped accepting");
  });

  it("one calendar needing reconnecting makes its whole login a reauth fault", () => {
    const workOld = { ...work, lastSyncAt: sundayEvening.toISOString() };
    const status = calendarSyncStatus({ accounts: [workOld, familyReauth], degraded: false, now });
    expect(status.faults).toHaveLength(1);
    expect(status.faults[0].reauth).toBe(true);
    expect(status.faults[0].accountIds).toEqual(["work", "family"]);
  });

  it("the banner names the address, what shows as of when, and the booking-link risk", () => {
    const status = calendarSyncStatus({ accounts: [personal, familyReauth], degraded: false, now });
    expect(syncBannerText(status, now)).toBe(
      `Google stopped accepting Moduo's access to robin.hale@gmail.com. Family shows as of ${syncSinceLabel(sundayEvening.getTime(), now)}, and booking links can't see it until you reconnect.`,
    );
  });

  it("two calendars of the revoked login: they show, and booking links can't see them", () => {
    const workReauth = { ...work, status: "reauth" };
    const status = calendarSyncStatus({
      accounts: [workReauth, familyReauth],
      degraded: false,
      now,
    });
    const text = syncBannerText(status, now) ?? "";
    expect(text).toContain("Work and Family show as of");
    expect(text).toContain("booking links can't see them until you reconnect.");
  });

  it("a reauth next to another account's stale sync speaks only of the reauth", () => {
    const anaStale = { ...ana, status: "error", lastSyncAt: sundayEvening.toISOString() };
    const status = calendarSyncStatus({
      accounts: [personal, familyReauth, anaStale],
      degraded: false,
      now,
    });
    const text = syncBannerText(status, now) ?? "";
    expect(text).toContain("Google stopped accepting Moduo's access to robin.hale@gmail.com.");
    expect(text).not.toContain("ana@halefounders.co");
  });

  it("the account's row says Reconnect, as a warning", () => {
    expect(accountSyncNote(familyReauth, now)).toEqual({ text: "Reconnect", tone: "warning" });
  });
});
