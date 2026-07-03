import { describe, expect, it } from "vitest";

import { isSyncableProvider, syncWindow } from "./sync";

describe("sync — orchestration helpers (CAL-6b)", () => {
  it("recognizes syncable providers", () => {
    expect(isSyncableProvider("google")).toBe(true);
    expect(isSyncableProvider("microsoft")).toBe(true);
    expect(isSyncableProvider("moduo")).toBe(false);
    expect(isSyncableProvider("caldav")).toBe(false);
  });

  it("spans a rolling past/future window around now", () => {
    const now = new Date("2026-07-02T12:00:00.000Z");
    const { timeMin, timeMax } = syncWindow(now, 30, 120);
    expect(timeMin).toBe("2026-06-02T12:00:00.000Z");
    expect(timeMax).toBe("2026-10-30T12:00:00.000Z");
  });
});
