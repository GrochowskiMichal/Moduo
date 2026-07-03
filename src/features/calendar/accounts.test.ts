import { describe, expect, it } from "vitest";

import {
  accountSourceLabel,
  providerLabel,
  resolveAccountHues,
  syncAgeLabel,
  visibleEvents,
} from "./accounts";
import type { CalendarAccountModel, CalendarEventModel } from "./events";

function account(over: Partial<CalendarAccountModel>): CalendarAccountModel {
  return {
    id: over.id ?? "a1",
    workspaceId: "w",
    ownerId: "u",
    provider: over.provider ?? "google",
    externalId: "",
    displayLabel: over.displayLabel ?? "Personal — me@gmail.com",
    isDefaultTarget: false,
    color: over.color ?? null,
    lastSyncAt: over.lastSyncAt ?? null,
    status: over.status ?? "ok",
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
    expect(accountSourceLabel(account({ displayLabel: "Work — a@co", provider: "microsoft" }))).toBe(
      "Work — a@co — Outlook",
    );
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
