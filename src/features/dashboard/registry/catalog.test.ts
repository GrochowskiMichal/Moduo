// DB-5 AC2 + AC8 — the widget catalog declares valid sizes/default config for
// every type, and the gallery filter hides permission-"none" + platform-
// unavailable types (while keeping an existing instance renderable elsewhere).

import { describe, expect, it } from "@rstest/core";

import type { RuntimeCapabilities } from "@/lib/runtime.types";

import { WIDGET_TYPES } from "../engine/types";
import {
  allowedSizesFor,
  defaultSizeFor,
  galleryTypes,
  isTypeAvailable,
  type LanePermissions,
  permissionFor,
  WIDGET_CATALOG,
} from "./catalog";

const ALL_EDIT: LanePermissions = { tasks: "edit", notes: "edit" };
const DESKTOP_CAPS: RuntimeCapabilities = {
  isDesktop: true,
  isWeb: false,
  hasEmail: true,
  hasTimeTracking: true,
  hasCalendarOAuth: true,
  hasLocalMnemonic: true,
  hasOfflineMode: true,
};
const WEB_CAPS: RuntimeCapabilities = {
  isDesktop: false,
  isWeb: true,
  hasEmail: false,
  hasTimeTracking: false,
  hasCalendarOAuth: true,
  hasLocalMnemonic: false,
  hasOfflineMode: false,
};

describe("widget catalog declarations (AC2)", () => {
  it("has an entry for all 16 widget types", () => {
    expect(Object.keys(WIDGET_CATALOG).sort()).toEqual([...WIDGET_TYPES].sort());
  });

  it("every type declares ≥1 size and a defaultSize within its sizes", () => {
    for (const type of WIDGET_TYPES) {
      const meta = WIDGET_CATALOG[type];
      expect(meta.sizes.length).toBeGreaterThan(0);
      expect(meta.sizes).toContain(meta.defaultSize);
      expect(defaultSizeFor(type)).toBe(meta.defaultSize);
      expect(allowedSizesFor(type)).toBe(meta.sizes);
    }
  });

  it("only uses the four sanctioned sizes", () => {
    for (const type of WIDGET_TYPES) {
      for (const size of WIDGET_CATALOG[type].sizes) {
        expect(["S", "M", "L", "XL"]).toContain(size);
      }
    }
  });

  it("every type has an object default config (opaque to the engine)", () => {
    for (const type of WIDGET_TYPES) {
      expect(typeof WIDGET_CATALOG[type].defaultConfig).toBe("object");
      expect(WIDGET_CATALOG[type].defaultConfig).not.toBeNull();
    }
  });
});

describe("permission + capability gating (AC8)", () => {
  it("utility widgets with no lane are always writable", () => {
    const locked: LanePermissions = { tasks: "none", notes: "none" };
    expect(permissionFor("clock", locked)).toBe("edit");
    expect(permissionFor("countdown", locked)).toBe("edit");
  });

  it("tasks-lane widgets follow the tasks permission", () => {
    expect(permissionFor("tasks", { tasks: "view", notes: "edit" })).toBe("view");
    expect(permissionFor("needs-attention", { tasks: "none", notes: "edit" })).toBe("none");
    expect(permissionFor("calendar", { tasks: "edit", notes: "none" })).toBe("edit");
  });

  it("notes widget follows the notes permission", () => {
    expect(permissionFor("notes", { tasks: "edit", notes: "view" })).toBe("view");
  });

  it("email + time-tracking are unavailable on web, available on desktop", () => {
    expect(isTypeAvailable("email", WEB_CAPS)).toBe(false);
    expect(isTypeAvailable("timetracking", WEB_CAPS)).toBe(false);
    expect(isTypeAvailable("email", DESKTOP_CAPS)).toBe(true);
    expect(isTypeAvailable("timetracking", DESKTOP_CAPS)).toBe(true);
    expect(isTypeAvailable("tasks", WEB_CAPS)).toBe(true);
  });

  it("gallery hides a locked module's widgets (permission none)", () => {
    const noTasks: LanePermissions = { tasks: "none", notes: "edit" };
    const gallery = galleryTypes(noTasks, DESKTOP_CAPS);
    expect(gallery).not.toContain("tasks");
    expect(gallery).not.toContain("needs-attention");
    expect(gallery).not.toContain("calendar");
    expect(gallery).toContain("notes");
    expect(gallery).toContain("clock");
  });

  it("gallery hides platform-unavailable widgets (email on web)", () => {
    const gallery = galleryTypes(ALL_EDIT, WEB_CAPS);
    expect(gallery).not.toContain("email");
    expect(gallery).not.toContain("timetracking");
    expect(gallery).toContain("tasks");
  });

  it("gallery includes every type when all lanes edit + all capabilities present", () => {
    expect(galleryTypes(ALL_EDIT, DESKTOP_CAPS).sort()).toEqual([...WIDGET_TYPES].sort());
  });
});
