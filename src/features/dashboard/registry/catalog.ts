// DB-5 — the pure widget catalog: metadata + gating predicates for all 16
// widget types. No React here, so the AC2/AC8 test imports this without pulling
// component code (and without the `@/lib` value-import trap under vitest).
//
// The 9 module widgets (tasks, notes, calendar, email, timetracking,
// recently-linked, activity, needs-attention, reconnect) ship their bodies in
// DB-5; the other 7 (clock, weather, pomodoro, countdown, quick-capture,
// habits, pinned) render a "coming soon" placeholder until DB-6/DB-7 attach
// their real components — but they still declare their catalog sizes here so
// resize + the future gallery are correct from day one.

import type { ModulePermission } from "@/features/workspaces/types";
import type { RuntimeCapabilities } from "@/lib/runtime.types";

import { WIDGET_TYPES, type WidgetType } from "../engine/types";
import type { WidgetMeta, WidgetPermissionModule, WidgetSize } from "./types";

/** Permission for each lane the workspace exposes (Contacts/Calendar ride tasks). */
export type LanePermissions = Record<WidgetPermissionModule, ModulePermission>;

export const WIDGET_CATALOG: Record<WidgetType, WidgetMeta> = {
  tasks: {
    type: "tasks",
    label: "Tasks",
    moduleLabel: "Tasks",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    defaultConfig: {},
    permissionModule: "tasks",
    openRoute: "/tasks",
  },
  notes: {
    type: "notes",
    label: "Notes",
    moduleLabel: "Notes",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    defaultConfig: {},
    permissionModule: "notes",
    openRoute: "/notes",
  },
  calendar: {
    type: "calendar",
    label: "Today",
    moduleLabel: "Calendar",
    sizes: ["S", "M", "XL"],
    defaultSize: "M",
    defaultConfig: {},
    permissionModule: "tasks",
    openRoute: "/calendar",
  },
  timetracking: {
    type: "timetracking",
    label: "Time tracking",
    moduleLabel: "Time tracking",
    sizes: ["S", "M"],
    defaultSize: "S",
    defaultConfig: {},
    isAvailable: (caps) => caps.hasTimeTracking,
  },
  email: {
    type: "email",
    label: "Inbox",
    moduleLabel: "Email",
    sizes: ["M", "L"],
    defaultSize: "M",
    defaultConfig: {},
    isAvailable: (caps) => caps.hasEmail,
    openRoute: "/email",
  },
  "recently-linked": {
    type: "recently-linked",
    label: "Recently linked",
    moduleLabel: "Tasks",
    sizes: ["S", "M"],
    defaultSize: "S",
    defaultConfig: {},
    permissionModule: "tasks",
  },
  activity: {
    type: "activity",
    label: "Activity",
    moduleLabel: "Tasks",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    defaultConfig: {},
    permissionModule: "tasks",
  },
  "needs-attention": {
    type: "needs-attention",
    label: "Needs attention",
    moduleLabel: "Contacts",
    sizes: ["S", "M"],
    defaultSize: "S",
    defaultConfig: {},
    permissionModule: "tasks",
    openRoute: "/contacts",
  },
  reconnect: {
    type: "reconnect",
    label: "Reconnect",
    moduleLabel: "Contacts",
    sizes: ["S", "M"],
    defaultSize: "S",
    defaultConfig: {},
    permissionModule: "tasks",
    openRoute: "/contacts",
  },
  // ── Utility + new widgets — bodies land in DB-6/DB-7; sizes declared now. ──
  clock: {
    type: "clock",
    label: "Clock",
    sizes: ["S", "M"],
    defaultSize: "S",
    defaultConfig: {},
  },
  weather: {
    type: "weather",
    label: "Weather",
    sizes: ["S", "M"],
    defaultSize: "S",
    defaultConfig: {},
  },
  pomodoro: {
    type: "pomodoro",
    label: "Pomodoro",
    sizes: ["S"],
    defaultSize: "S",
    defaultConfig: {},
  },
  countdown: {
    type: "countdown",
    label: "Countdown",
    sizes: ["S"],
    defaultSize: "S",
    defaultConfig: {},
  },
  "quick-capture": {
    type: "quick-capture",
    label: "Quick capture",
    moduleLabel: "Tasks",
    sizes: ["S", "M"],
    defaultSize: "S",
    defaultConfig: {},
    permissionModule: "tasks",
  },
  habits: {
    type: "habits",
    label: "Habits",
    sizes: ["S", "M", "L"],
    defaultSize: "M",
    defaultConfig: {},
  },
  pinned: {
    type: "pinned",
    label: "Pinned",
    sizes: ["S", "M"],
    defaultSize: "S",
    defaultConfig: {},
  },
};

/** The widget types whose bodies exist in DB-5 (the rest are placeholders). */
export const SHIPPED_WIDGET_TYPES: readonly WidgetType[] = [
  "tasks",
  "notes",
  "calendar",
  "timetracking",
  "email",
  "recently-linked",
  "activity",
  "needs-attention",
  "reconnect",
];

export function widgetMeta(type: WidgetType): WidgetMeta {
  return WIDGET_CATALOG[type];
}

export function widgetLabel(type: WidgetType): string {
  return WIDGET_CATALOG[type].label;
}

export function allowedSizesFor(type: WidgetType): readonly WidgetSize[] {
  return WIDGET_CATALOG[type].sizes;
}

export function defaultSizeFor(type: WidgetType): WidgetSize {
  return WIDGET_CATALOG[type].defaultSize;
}

export function defaultConfigFor(type: WidgetType): Record<string, unknown> {
  return { ...WIDGET_CATALOG[type].defaultConfig };
}

/** Platform gate — is this type usable on the current runtime? (email/time-tracking). */
export function isTypeAvailable(type: WidgetType, caps: RuntimeCapabilities): boolean {
  const meta = WIDGET_CATALOG[type];
  return meta.isAvailable ? meta.isAvailable(caps) : true;
}

/** Resolve the effective write permission for a widget type given the lane map. */
export function permissionFor(type: WidgetType, lanes: LanePermissions): ModulePermission {
  const meta = WIDGET_CATALOG[type];
  if (!meta.permissionModule) return "edit"; // utility/local widgets are always writable
  return lanes[meta.permissionModule];
}

/**
 * The types offered in the Add-widget gallery (DB-8): platform-available AND not
 * permission-"none" (a locked module hides its widgets from the gallery, though
 * an existing instance stays in the layout — edge case in the spec). AC8.
 */
export function galleryTypes(lanes: LanePermissions, caps: RuntimeCapabilities): WidgetType[] {
  return WIDGET_TYPES.filter((type) => {
    if (!isTypeAvailable(type, caps)) return false;
    if (permissionFor(type, lanes) === "none") return false;
    return true;
  });
}
