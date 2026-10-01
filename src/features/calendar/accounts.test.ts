import { describe, expect, it } from "vitest";

import {
  accountSourceLabel,
  groupRailAccounts,
  providerLabel,
  resolveAccountHues,
  syncAgeLabel,
  visibleEvents,
} from "./accounts";
import type { CalendarAccountModel, CalendarEventModel } from "./events";
import { buildCaldavDescriptor, buildIcsDescriptor } from "./sync";

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
