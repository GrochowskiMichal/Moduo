import { describe, expect, it } from "vitest";

import { isIcsProvider, isSyncableProvider, parseSyncDescriptor, syncWindow } from "./sync";

describe("sync — orchestration helpers (CAL-6b/CAL-8)", () => {
  it("recognizes syncable providers (caldav/ics joined with CAL-8)", () => {
    expect(isSyncableProvider("google")).toBe(true);
    expect(isSyncableProvider("microsoft")).toBe(true);
    expect(isSyncableProvider("caldav")).toBe(true);
    expect(isSyncableProvider("ics")).toBe(true);
    expect(isSyncableProvider("moduo")).toBe(false);
    expect(isSyncableProvider("")).toBe(false);
  });

  it("routes caldav/ics raws to the ics mapper, OAuth providers to mirror.ts", () => {
    expect(isIcsProvider("caldav")).toBe(true);
    expect(isIcsProvider("ics")).toBe(true);
    expect(isIcsProvider("google")).toBe(false);
    expect(isIcsProvider("microsoft")).toBe(false);
  });

  it("spans a rolling past/future window around now", () => {
    const now = new Date("2026-07-02T12:00:00.000Z");
    const { timeMin, timeMax } = syncWindow(now, 30, 120);
    expect(timeMin).toBe("2026-06-02T12:00:00.000Z");
    expect(timeMax).toBe("2026-10-30T12:00:00.000Z");
  });

  it("parses caldav/ics sync descriptors and rejects everything else", () => {
    expect(
      parseSyncDescriptor(
        JSON.stringify({
          kind: "caldav",
          serverUrl: "https://caldav.fastmail.com",
          username: "me@fastmail.com",
          calendarUrl: "https://caldav.fastmail.com/dav/calendars/user/me/work/",
          calendarName: "Work",
        }),
      ),
    ).toEqual({
      kind: "caldav",
      serverUrl: "https://caldav.fastmail.com",
      username: "me@fastmail.com",
      calendarUrl: "https://caldav.fastmail.com/dav/calendars/user/me/work/",
      calendarName: "Work",
    });
    expect(parseSyncDescriptor(JSON.stringify({ kind: "ics" }))).toEqual({ kind: "ics" });
    // Legacy/OAuth/pre-deploy rows: opaque tokens or null — never a descriptor.
    expect(parseSyncDescriptor(null)).toBeNull();
    expect(parseSyncDescriptor(undefined)).toBeNull();
    expect(parseSyncDescriptor("")).toBeNull();
    expect(parseSyncDescriptor("some-opaque-provider-token")).toBeNull();
    expect(parseSyncDescriptor(JSON.stringify({ kind: "caldav" }))).toBeNull();
  });
});
