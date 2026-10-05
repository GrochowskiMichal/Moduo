import { describe, expect, it } from "vitest";

import {
  ABOUT_LINKS,
  ABOUT_RUNTIME_LINE,
  ABOUT_STORAGE_LINE,
  ABOUT_TAGLINE,
  APP_VERSION,
  desktopDownloads,
  resolveDesktopChannel,
  versionLabel,
} from "./about";

// Every human-facing string About renders, gathered so the copy assertions
// below can't miss one.
const ALL_COPY = [
  ABOUT_TAGLINE,
  ABOUT_STORAGE_LINE,
  ABOUT_RUNTIME_LINE,
  versionLabel(),
  ...ABOUT_LINKS.flatMap((l) => [l.label, l.href]),
].join(" ");

describe("About copy is cloud-first (AC12)", () => {
  it("contains no local-first / on-device wording", () => {
    const lower = ALL_COPY.toLowerCase();
    expect(lower).not.toContain("local-first");
    expect(lower).not.toContain("redb");
    expect(lower).not.toContain("on your machine");
    expect(lower).not.toContain("local vault");
  });

  it("states cloud sync as the storage truth", () => {
    expect(ABOUT_STORAGE_LINE.toLowerCase()).toContain("cloud");
    expect(ABOUT_STORAGE_LINE.toLowerCase()).toContain("supabase");
  });
});

describe("About shows version + build (AC12)", () => {
  it("version label carries the app version and a build id", () => {
    expect(APP_VERSION).toBeTruthy();
    const label = versionLabel();
    expect(label).toContain(APP_VERSION);
    expect(label).toContain("build");
  });
});

describe("About links (AC12)", () => {
  it("includes a What's-new / changelog link", () => {
    const changelog = ABOUT_LINKS.find((l) => l.kind === "changelog");
    expect(changelog).toBeDefined();
    expect(changelog?.label).toMatch(/new/i);
  });

  it("includes Privacy, Terms, and Support links", () => {
    const labels = ABOUT_LINKS.map((l) => l.label.toLowerCase());
    expect(labels).toContain("privacy");
    expect(labels).toContain("terms");
    expect(labels).toContain("support");
  });

  it("every link is an absolute https URL", () => {
    for (const link of ABOUT_LINKS) {
      expect(link.href).toMatch(/^https:\/\//);
    }
  });
});

describe("Desktop downloads", () => {
  it("staging points at the rolling staging release", () => {
    expect(desktopDownloads("staging").map((d) => d.href)).toEqual([
      "https://github.com/GrochowskiMichal/moduohyb/releases/download/staging-latest/Moduo_universal.dmg",
      "https://github.com/GrochowskiMichal/moduohyb/releases/download/staging-latest/Moduo_x64-setup.exe",
    ]);
  });

  it("production points at the rolling prod release", () => {
    expect(desktopDownloads("production").map((d) => d.href)).toEqual([
      "https://github.com/GrochowskiMichal/moduohyb/releases/download/prod-latest/Moduo_universal.dmg",
      "https://github.com/GrochowskiMichal/moduohyb/releases/download/prod-latest/Moduo_x64-setup.exe",
    ]);
  });

  it("resolves the channel from env, then from the prod web host", () => {
    expect(resolveDesktopChannel({ channel: "production" }, undefined)).toBe("production");
    expect(resolveDesktopChannel({ stagingPortal: "true" }, "app.moduo.app")).toBe("staging");
    expect(resolveDesktopChannel({}, "app.moduo.app")).toBe("production");
    expect(resolveDesktopChannel({}, "app.staging.moduo.app")).toBeNull();
    expect(resolveDesktopChannel({}, "127.0.0.1")).toBeNull();
  });
});
