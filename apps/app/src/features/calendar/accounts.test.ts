import { describe, expect, it, rs } from "@rstest/core";

import {
  accountCalendars,
  connectPicks,
  defaultBusyIds,
  importProgressLabel,
  loginsAwaitingPick,
  parseGoogleStatus,
  planGooglePicks,
} from "./account-picks";
import { REMOVE_CONSEQUENCES, removeCalendarLogin } from "./account-removal";
import {
  accountSourceLabel,
  groupRailAccounts,
  hiddenIdsForSet,
  providerLabel,
  resolveAccountHues,
  syncAgeLabel,
  visibleEvents,
} from "./accounts";
import type { CalendarAccountModel, CalendarEventModel } from "./events";
import type { LinkedGoogleCalendar } from "./google-web";
import { buildCaldavDescriptor, buildIcsDescriptor } from "./sync";
import { writableEvent } from "./writable";

function account(over: Partial<CalendarAccountModel>): CalendarAccountModel {
  return {
    id: over.id ?? "a1",
    workspaceId: "w",
    ownerId: "u",
    provider: over.provider ?? "google",
    externalId: over.externalId ?? "",
    displayLabel: over.displayLabel ?? "Personal — me@gmail.com",
    isDefaultTarget: false,
    color: over.color ?? null,
    lastSyncAt: over.lastSyncAt ?? null,
    status: over.status ?? "ok",
    syncToken: over.syncToken ?? null,
    deletedAt: null,
  };
}
function event(over: Partial<CalendarEventModel>): CalendarEventModel {
  return {
    id: over.id ?? "e1",
    workspaceId: "w",
    ownerId: "u",
    sourceAccountId: over.sourceAccountId ?? null,
    externalEventId: over.externalEventId ?? null,
    calendarId: "c",
    title: "e",
    description: "",
    startsAt: "2026-07-02T09:00:00Z",
    endsAt: "2026-07-02T09:30:00Z",
    allDay: false,
    rrule: null,
    status: "confirmed",
    color: null,
    calendarRef: over.calendarRef ?? null,
    createdAt: "",
    updatedAt: "",
    deletedAt: null,
  };
}

describe("accounts — attribution (AC12)", () => {
  it("names providers for the source line", () => {
    expect(providerLabel("google")).toBe("Google");
    expect(providerLabel("microsoft")).toBe("Outlook");
    expect(providerLabel("caldav")).toBe("CalDAV");
    expect(providerLabel("ics")).toBe("ICS feed");
    expect(
      accountSourceLabel(account({ displayLabel: "Work — a@co", provider: "microsoft" })),
    ).toBe("Work — a@co — Outlook");
  });

  it("honors an override, then a stored bounded name, then spreads distinct hues", () => {
    const hues = resolveAccountHues(
      [account({ id: "a" }), account({ id: "b", color: "teal" }), account({ id: "c" })],
      { a: "pink" },
    );
    expect(hues.a).toBe("pink"); // override
    expect(hues.b).toBe("teal"); // stored name
    // c gets a colored hue distinct from the used ones, deterministically.
    expect(hues.c).not.toBe("pink");
    expect(hues.c).not.toBe("teal");
    expect(hues.c).not.toBe("gray");
  });

  it("assigns distinct spread hues when nothing is stored", () => {
    const hues = resolveAccountHues([account({ id: "a" }), account({ id: "b" })]);
    expect(hues.a).not.toBe(hues.b);
  });

  it("hides events from toggled-off accounts; native events always show", () => {
    const evs = [
      event({ id: "native", sourceAccountId: null }),
      event({ id: "ext-a", sourceAccountId: "a" }),
      event({ id: "ext-b", sourceAccountId: "b" }),
    ];
    const visible = visibleEvents(evs, ["a"]);
    expect(visible.map((e) => e.id)).toEqual(["native", "ext-b"]);
  });

  it("hides native events on a hidden calendar (custom calendars, CALR-6)", () => {
    const evs = [
      event({ id: "mine", calendarRef: "cal-moduo" }),
      event({ id: "work", calendarRef: "cal-work" }),
      event({ id: "ext-a", sourceAccountId: "a", calendarRef: "cal-a" }),
    ];
    expect(visibleEvents(evs, ["cal-work"]).map((e) => e.id)).toEqual(["mine", "ext-a"]);
    expect(visibleEvents(evs, ["a"]).map((e) => e.id)).toEqual(["mine", "work"]);
  });

  it("a saved set with a custom calendar hides the rest, and its events show (CALR-6)", () => {
    const evs = [
      event({ id: "work", calendarRef: "cal-work" }),
      event({ id: "mine", calendarRef: "cal-moduo" }),
      event({ id: "ext-a", sourceAccountId: "a" }),
    ];
    const hidden = hiddenIdsForSet(["cal-work"], ["a", "cal-work", "cal-moduo", "a"]);
    expect(hidden).toEqual(["a", "cal-moduo"]);
    expect(visibleEvents(evs, hidden).map((e) => e.id)).toEqual(["work"]);
  });

  it("returns all events unfiltered when nothing is hidden", () => {
    const evs = [event({ id: "x", sourceAccountId: "a" })];
    expect(visibleEvents(evs, [])).toBe(evs);
  });

  it("groups CalDAV calendars under their account header, feeds under Feeds, OAuth flat", () => {
    const cd = (id: string, cal: string) =>
      account({
        id,
        provider: "caldav",
        displayLabel: `${cal} — me@fastmail.com`,
        syncToken: buildCaldavDescriptor({
          serverUrl: "https://caldav.fastmail.com",
          username: "me@fastmail.com",
          calendarUrl: `https://caldav.fastmail.com/dav/cal/${id}/`,
          calendarName: cal,
        }),
      });
    const groups = groupRailAccounts([
      account({ id: "g1", provider: "google", displayLabel: "me@gmail.com" }),
      cd("c1", "Personal"),
      account({ id: "f1", provider: "ics", displayLabel: "Team holidays" }),
      cd("c2", "Work"),
      account({ id: "f2", provider: "ics", displayLabel: "Sports" }),
    ]);
    // Google flat first (input order), then the CalDAV group (first appearance),
    // then the Feeds group — c2 joins the EXISTING caldav group even though a
    // feed appeared between c1 and c2.
    expect(
      groups.map((g) => (g.kind === "flat" ? `flat:${g.row.account.id}` : `group:${g.header}`)),
    ).toEqual(["flat:g1", "group:me@fastmail.com", "group:Feeds"]);
    const caldavGroup = groups[1];
    const feeds = groups[2];
    if (caldavGroup.kind !== "group" || feeds.kind !== "group") throw new Error("shape");
    expect(caldavGroup.rows.map((r) => r.label)).toEqual(["Personal", "Work"]);
    expect(feeds.rows.map((r) => r.account.id)).toEqual(["f1", "f2"]);
    expect(feeds.rows.map((r) => r.label)).toEqual(["Team holidays", "Sports"]);
  });

  it("splits CalDAV calendars from two different accounts into two groups", () => {
    const row = (id: string, user: string) =>
      account({
        id,
        provider: "caldav",
        syncToken: buildCaldavDescriptor({
          serverUrl: "https://caldav.icloud.com",
          username: user,
          calendarUrl: `https://caldav.icloud.com/${id}/`,
          calendarName: id,
        }),
      });
    const groups = groupRailAccounts([row("a", "me@icloud.com"), row("b", "partner@icloud.com")]);
    expect(groups).toHaveLength(2);
    expect(groups.every((g) => g.kind === "group")).toBe(true);
  });

  it("groups Google calendars from one mailbox under that login", () => {
    const groups = groupRailAccounts([
      account({
        id: "g1",
        provider: "google",
        externalId: "google:me@gmail.com:primary",
        displayLabel: "Familijne",
      }),
      account({
        id: "g2",
        provider: "google",
        externalId: "google:me@gmail.com:work",
        displayLabel: "IT Events",
      }),
      account({
        id: "o1",
        provider: "google",
        externalId: "google:other@gmail.com:primary",
        displayLabel: "Other",
      }),
    ]);
    expect(groups.map((g) => (g.kind === "group" ? g.detail : ""))).toEqual([
      "me@gmail.com",
      "other@gmail.com",
    ]);
    const first = groups[0];
    if (first.kind !== "group") throw new Error("shape");
    expect(first.header).toBe("Google");
    expect(first.rows.map((row) => row.label)).toEqual(["Familijne", "IT Events"]);
    expect(first.rows.every((row) => row.scope === "calendar")).toBe(true);
  });

  it("falls back to a flat row for a caldav account with an unparseable descriptor", () => {
    const groups = groupRailAccounts([
      account({ id: "x", provider: "caldav", syncToken: null, displayLabel: "Legacy" }),
    ]);
    expect(groups).toEqual([
      {
        kind: "flat",
        row: { account: expect.anything(), label: "Legacy", scope: "account" },
      },
    ]);
  });

  it("uses a plain ICS descriptor for feeds (no server fields needed)", () => {
    expect(buildIcsDescriptor()).toBe('{"kind":"ics"}');
  });

  it("labels the freshest sync age; null when never synced", () => {
    const now = new Date(2026, 6, 2, 12, 0).getTime();
    expect(
      syncAgeLabel(
        [
          account({ lastSyncAt: new Date(now - 12 * 60_000).toISOString() }),
          account({ lastSyncAt: new Date(now - 3 * 60_000).toISOString() }),
        ],
        now,
      ),
    ).toBe("synced 3 min ago");
    expect(syncAgeLabel([account({ lastSyncAt: null })], now)).toBeNull();
    expect(syncAgeLabel([account({ lastSyncAt: new Date(now - 20_000).toISOString() })], now)).toBe(
      "synced just now",
    );
  });
});

describe("caldav credential cleanup (CAL-8b)", () => {
  it("only deletes the shared keychain secret when the LAST calendar row of an account goes", async () => {
    const { isLastCaldavRowForAccount } = await import("./caldav-connect");
    const cd = (id: string, cal: string, user = "me@fastmail.com") =>
      account({
        id,
        provider: "caldav",
        syncToken: buildCaldavDescriptor({
          serverUrl: "https://caldav.fastmail.com",
          username: user,
          calendarUrl: `https://caldav.fastmail.com/${id}/`,
          calendarName: cal,
        }),
      });
    const c1 = cd("c1", "Personal");
    const c2 = cd("c2", "Work");
    // Two rows share the account → removing one is NOT the last.
    expect(isLastCaldavRowForAccount([c1, c2], c1)).toBe(false);
    // Only one row left → removing it orphans the secret.
    expect(isLastCaldavRowForAccount([c1], c1)).toBe(true);
    // A different account's row doesn't keep this secret alive.
    const other = cd("c3", "Family", "partner@fastmail.com");
    expect(isLastCaldavRowForAccount([c1, other], c1)).toBe(true);
  });
});

// ── Calendar accounts, the picker and Remove with Undo (CALR-20, AC35, AC36) ──

describe("accounts, picker and remove with undo", () => {
  const ROBIN = "robin.hale@gmail.com";
  function acct(over: Partial<CalendarAccountModel> & { id: string; externalId: string }) {
    return {
      workspaceId: "w",
      ownerId: "u",
      provider: "google",
      displayLabel: over.id,
      isDefaultTarget: false,
      color: null,
      lastSyncAt: null,
      status: "ok",
      syncToken: null,
      deletedAt: null,
      ...over,
    } satisfies CalendarAccountModel;
  }
  function linked(id: string, summary: string, over: Partial<LinkedGoogleCalendar> = {}) {
    return {
      email: ROBIN,
      accountId: `google:${ROBIN}:${id}`,
      summary,
      googleCalendarId: id,
      primary: false,
      readOnly: false,
      ...over,
    } satisfies LinkedGoogleCalendar;
  }
  const primary = linked(ROBIN, "Robin", { primary: true });
  const family = linked("family", "Family");
  const holidays = linked("holidays", "Holidays in Poland", { readOnly: true });

  it("reads the status answer: calendars with their access, and the logins that need reconnecting", () => {
    const parsed = parseGoogleStatus({
      calendars: [
        { ...primary },
        { ...holidays },
        {
          email: ROBIN,
          accountId: "google:x",
          summary: "old function, no access fields",
          googleCalendarId: "x",
        },
        { email: 3 },
      ],
      reauth: ["ana@halefounders.co", 7],
    });
    expect(parsed.calendars.map((c) => [c.googleCalendarId, c.primary, c.readOnly])).toEqual([
      [ROBIN, true, false],
      ["holidays", false, true],
      ["x", false, false],
    ]);
    expect(parsed.reauth).toEqual(["ana@halefounders.co"]);
    expect(parseGoogleStatus({})).toEqual({ calendars: [], reauth: [] });
    expect(parseGoogleStatus(null)).toEqual({ calendars: [], reauth: [] });
  });

  it("the picker after connecting starts with the calendars you can write shown and busy, read-only ones off", () => {
    const picks = connectPicks([primary, family, holidays], ROBIN);
    expect(picks).toEqual([
      {
        externalId: primary.accountId,
        name: "Robin",
        readOnly: false,
        primary: true,
        accountId: null,
        show: true,
        busy: true,
      },
      {
        externalId: family.accountId,
        name: "Family",
        readOnly: false,
        primary: false,
        accountId: null,
        show: true,
        busy: true,
      },
      {
        externalId: holidays.accountId,
        name: "Holidays in Poland",
        readOnly: true,
        primary: false,
        accountId: null,
        show: false,
        busy: false,
      },
    ]);
    expect(
      connectPicks([primary, linked("x", "Other", { email: "ana@halefounders.co" })], ROBIN),
    ).toHaveLength(1);
  });

  it("only picked calendars sync: shown or busy ones are added, busy-but-hidden ones hide from the week", () => {
    const plan = planGooglePicks([
      {
        externalId: "google:r:a",
        name: "A",
        readOnly: false,
        primary: true,
        accountId: null,
        show: true,
        busy: true,
      },
      {
        externalId: "google:r:b",
        name: "B",
        readOnly: false,
        primary: false,
        accountId: null,
        show: false,
        busy: false,
      },
      {
        externalId: "google:r:c",
        name: "C",
        readOnly: true,
        primary: false,
        accountId: null,
        show: true,
        busy: false,
      },
      {
        externalId: "google:r:d",
        name: "D",
        readOnly: false,
        primary: false,
        accountId: null,
        show: false,
        busy: true,
      },
    ]);
    expect(plan.add).toEqual([
      { externalId: "google:r:a", displayLabel: "A", readOnly: false, busyDefault: true },
      { externalId: "google:r:c", displayLabel: "C", readOnly: true, busyDefault: false },
      { externalId: "google:r:d", displayLabel: "D", readOnly: false, busyDefault: true },
    ]);
    expect(plan.hide).toEqual(["google:r:d"]);
  });

  it("a login connected with nothing picked yet waits for the picker; one with calendars, or a desktop login row, doesn't", () => {
    const ana = linked("primary", "Ana", {
      email: "ana@halefounders.co",
      accountId: "google:ana@halefounders.co:primary",
    });
    const kai = linked("primary", "Kai", {
      email: "kai@ito.dev",
      accountId: "google:kai@ito.dev:primary",
    });
    const accounts = [
      acct({ id: "fam", externalId: family.accountId }),
      acct({ id: "kai-login", externalId: "google:kai@ito.dev" }),
      acct({ id: "ana-old", externalId: ana.accountId, deletedAt: "2026-10-01T00:00:00Z" }),
    ];
    expect(loginsAwaitingPick([primary, family, ana, kai], accounts)).toEqual([
      "ana@halefounders.co",
    ]);
  });

  it("Calendar accounts lists a login's calendars with Show in your week and Counts as busy", () => {
    const accounts = [
      acct({ id: "a-primary", externalId: primary.accountId, busyDefault: true }),
      acct({ id: "a-family", externalId: family.accountId, busyDefault: false }),
      acct({
        id: "a-gone",
        externalId: `google:${ROBIN}:gone`,
        displayLabel: "Gone",
        deletedAt: "2026-10-01T00:00:00Z",
      }),
      acct({
        id: "a-team",
        externalId: `google:${ROBIN}:team`,
        displayLabel: "Team",
        readOnly: true,
      }),
      acct({ id: "ana", externalId: "google:ana@halefounders.co:primary" }),
    ];
    const rows = accountCalendars([primary, family, holidays], accounts, ["a-family"], ROBIN);
    expect(rows).toEqual([
      {
        externalId: primary.accountId,
        name: "Robin",
        readOnly: false,
        primary: true,
        accountId: "a-primary",
        show: true,
        busy: true,
      },
      {
        externalId: family.accountId,
        name: "Family",
        readOnly: false,
        primary: false,
        accountId: "a-family",
        show: false,
        busy: false,
      },
      {
        externalId: holidays.accountId,
        name: "Holidays in Poland",
        readOnly: true,
        primary: false,
        accountId: null,
        show: false,
        busy: false,
      },
      // Synced but not in Google's list right now (a revoked token lists nothing): still listed.
      {
        externalId: `google:${ROBIN}:team`,
        name: "Team",
        readOnly: true,
        primary: false,
        accountId: "a-team",
        show: true,
        busy: true,
      },
    ]);
  });

  it("busy defaults seed new booking links", () => {
    const accounts = [
      acct({ id: "work", externalId: "google:r:work" }),
      acct({ id: "family", externalId: "google:r:family", busyDefault: true }),
      acct({ id: "holidays", externalId: "google:r:holidays", busyDefault: false }),
      acct({ id: "removed", externalId: "google:r:removed", deletedAt: "2026-10-01T00:00:00Z" }),
    ];
    expect(defaultBusyIds(accounts)).toEqual(["moduo", "tasks", "work", "family"]);
    expect(defaultBusyIds([])).toEqual(["moduo", "tasks"]);
  });

  it("import progress says how much is coming and that it carries on", () => {
    expect(importProgressLabel({ events: 214, done: 1, total: 2 })).toBe(
      "Bringing in 214 events · 50%",
    );
    expect(importProgressLabel({ events: 1, done: 2, total: 3 })).toBe("Bringing in 1 event · 67%");
    expect(importProgressLabel({ events: 0, done: 0, total: 2 })).toBe(
      "Bringing in your events · 0%",
    );
    expect(importProgressLabel({ events: 214, done: 2, total: 2 })).toBe(
      "214 events are in your week",
    );
    expect(importProgressLabel({ events: 0, done: 0, total: 0 })).toBe(
      "Bringing in your events · 0%",
    );
  });

  it("remove soft-deletes every calendar of the login and Undo restores them", async () => {
    const calls: string[] = [];
    const runtime = {
      calendar: {
        removeAccount: rs.fn(async ({ accountId }: { workspaceId: string; accountId: string }) => {
          calls.push(`remove ${accountId}`);
        }),
        restoreAccount: rs.fn(async ({ accountId }: { workspaceId: string; accountId: string }) => {
          calls.push(`restore ${accountId}`);
          return acct({ id: accountId, externalId: `google:${ROBIN}:${accountId}` });
        }),
      },
    };
    const removal = await removeCalendarLogin({
      runtime,
      workspaceId: "w",
      accountIds: ["a", "b"],
    });
    expect(calls).toEqual(["remove a", "remove b"]);
    expect(runtime.calendar.removeAccount).toHaveBeenCalledWith({
      workspaceId: "w",
      accountId: "a",
    });
    await removal.undo();
    expect(calls).toEqual(["remove a", "remove b", "restore a", "restore b"]);
    expect(runtime.calendar.restoreAccount).toHaveBeenCalledWith({
      workspaceId: "w",
      accountId: "b",
    });
  });

  it("a remove that fails part-way puts back what it took, then says so", async () => {
    const calls: string[] = [];
    const runtime = {
      calendar: {
        removeAccount: async ({ accountId }: { workspaceId: string; accountId: string }) => {
          if (accountId === "b") throw new Error("network");
          calls.push(`remove ${accountId}`);
        },
        restoreAccount: async ({ accountId }: { workspaceId: string; accountId: string }) => {
          calls.push(`restore ${accountId}`);
          return acct({ id: accountId, externalId: accountId });
        },
      },
    };
    await expect(
      removeCalendarLogin({ runtime, workspaceId: "w", accountIds: ["a", "b"] }),
    ).rejects.toThrow();
    expect(calls).toEqual(["remove a", "restore a"]);
  });

  it("states what Remove does", () => {
    expect(REMOVE_CONSEQUENCES).toBe(
      "Its calendars and their events leave Moduo. Notes, tasks and people you linked stay, marked “event removed”. Nothing changes in Google.",
    );
  });

  it("a read-only Google calendar doesn't look editable", () => {
    const readOnly = acct({
      id: "hol",
      externalId: `google:${ROBIN}:holidays`,
      ownerId: "u",
      readOnly: true,
    });
    const writable = acct({ id: "fam", externalId: family.accountId, ownerId: "u" });
    expect(
      writableEvent({ sourceAccountId: "hol", externalEventId: "e1" }, [readOnly], "u"),
    ).toBeNull();
    expect(writableEvent({ sourceAccountId: "fam", externalEventId: "e1" }, [writable], "u")).toBe(
      "google",
    );
  });
});
