import { describe, expect, it } from "@rstest/core";

import { compareVersions, desktopVersion, readBaseVersion } from "./version.mjs";

describe("release version", () => {
  it("reads a plain MAJOR.MINOR.PATCH from VERSION", () => {
    expect(readBaseVersion()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("numbers staging desktop builds by run and leaves production plain", () => {
    expect(desktopVersion("1.1.0", "staging", "42")).toBe("1.1.0-rc.42");
    expect(desktopVersion("1.1.0", "production", "42")).toBe("1.1.0");
    expect(() => desktopVersion("1.1.0", "staging", "")).toThrow();
    expect(() => desktopVersion("1.1.0", "beta", "1")).toThrow();
  });

  // The updater only installs a higher version. These are the installed apps
  // when the VERSION scheme replaced 1.0.<run number> (2026-10-17).
  it("keeps already installed desktop apps updating", () => {
    const base = readBaseVersion();
    expect(compareVersions(desktopVersion(base, "production", "1"), "1.0.22")).toBeGreaterThan(0);
    expect(compareVersions(desktopVersion(base, "staging", "1"), "1.0.41")).toBeGreaterThan(0);
  });

  it("orders versions the way semver (and the updater) does", () => {
    expect(compareVersions("1.1.0-rc.10", "1.1.0-rc.9")).toBeGreaterThan(0);
    expect(compareVersions("1.1.0", "1.1.0-rc.99")).toBeGreaterThan(0);
    expect(compareVersions("1.1.0-rc", "1.1.0-rc.1")).toBeLessThan(0);
    expect(compareVersions("1.2.0-rc.1", "1.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.1.0", "1.1.0")).toBe(0);
    expect(compareVersions("1.0.41", "1.0.22")).toBeGreaterThan(0);
    expect(() => compareVersions("1.1", "1.1.0")).toThrow();
  });
});
