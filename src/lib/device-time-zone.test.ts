import { describe, expect, it } from "@rstest/core";

import { deviceTimeZone, resetDeviceTimeZoneSends, sendDeviceTimeZone } from "./device-time-zone";

function fakeRuntime(fail = false) {
  const zones: string[] = [];
  return {
    zones,
    runtime: {
      preferences: {
        setTimeZone: async (zone: string) => {
          zones.push(zone);
          if (fail) throw new Error("offline");
        },
      },
    } as never,
  };
}

describe("sending the device's time zone (TV-D8)", () => {
  it("reads the device zone", () => {
    expect(typeof deviceTimeZone()).toBe("string");
  });

  it("sends once per person per app start", async () => {
    resetDeviceTimeZoneSends();
    const { zones, runtime } = fakeRuntime();
    sendDeviceTimeZone(runtime, "u1", "Europe/Warsaw");
    sendDeviceTimeZone(runtime, "u1", "Europe/Warsaw");
    sendDeviceTimeZone(runtime, "u2", "Asia/Tokyo");
    await new Promise((r) => setTimeout(r, 0));
    expect(zones).toEqual(["Europe/Warsaw", "Asia/Tokyo"]);
  });

  it("does nothing on a runtime without the call", () => {
    resetDeviceTimeZoneSends();
    expect(() => sendDeviceTimeZone({} as never, "u1", "Europe/Warsaw")).not.toThrow();
  });

  it("tries again at the next sign-in when it failed", async () => {
    resetDeviceTimeZoneSends();
    const { zones, runtime } = fakeRuntime(true);
    sendDeviceTimeZone(runtime, "u1", "Europe/Warsaw");
    await new Promise((r) => setTimeout(r, 0));
    sendDeviceTimeZone(runtime, "u1", "Europe/Warsaw");
    await new Promise((r) => setTimeout(r, 0));
    expect(zones).toEqual(["Europe/Warsaw", "Europe/Warsaw"]);
  });

  it("sends nothing without a zone", () => {
    resetDeviceTimeZoneSends();
    const { zones, runtime } = fakeRuntime();
    sendDeviceTimeZone(runtime, "u1", null);
    expect(zones).toEqual([]);
  });
});
