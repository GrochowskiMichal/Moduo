// DB-5 — widget registry types. The registry is split into two halves:
//   • catalog.ts — pure metadata + predicates (sizes, default config, permission
//     lane, platform gate). No React, so it's unit-testable without pulling the
//     component graph into vitest (dodges the `@/lib` value-import trap).
//   • widget-registry.tsx — the type → component map (app-only).
// This file holds the shared types both halves + the widget bodies consume.

import type { ComponentType } from "react";

import type { RuntimeCapabilities } from "@/lib/runtime.types";

import type { WidgetInstance, WidgetSize, WidgetType } from "../engine/types";

/**
 * The client-visible permission lanes the workspace context exposes
 * (`modulePermissions`). Contacts, Calendar and the spine all ride the Tasks
 * lane at alpha; Notes has its own. Email/Time-tracking are capability-gated,
 * not permission-gated, so they omit this.
 */
export type WidgetPermissionModule = "tasks" | "notes";

/** Pure catalog entry for one widget type — no component, safe to unit-test. */
export interface WidgetMeta {
  type: WidgetType;
  /** Frame-header label (sentence case, R8). */
  label: string;
  /** User-facing module name for the "no access" placeholder ("Contacts", "Tasks"…). */
  moduleLabel?: string;
  /** Supported sizes; `defaultSize` must be one of these. */
  sizes: readonly WidgetSize[];
  defaultSize: WidgetSize;
  /** Seed config for a freshly-added instance (opaque to the engine). */
  defaultConfig: Record<string, unknown>;
  /** Write-permission lane; "view" → read-only, "none" → placeholder + hidden from gallery. */
  permissionModule?: WidgetPermissionModule;
  /** Platform gate (email/time-tracking on desktop). Omitted = always available. */
  isAvailable?: (caps: RuntimeCapabilities) => boolean;
  /** Route the header "open" affordance deep-links to (e.g. "/tasks"). Omit = no header link. */
  openRoute?: string;
}

/** Props every widget body receives. Data comes from the shared data context. */
export interface WidgetComponentProps {
  widget: WidgetInstance;
  size: WidgetSize;
  /** false when the module permission is only "view" — writes must be disabled. */
  canWrite: boolean;
  /** Merge a patch into this widget's persisted config (position-preserving, DB-6). */
  updateConfig: (patch: Record<string, unknown>) => void;
}

export type WidgetComponent = ComponentType<WidgetComponentProps>;

/** Full registry entry = catalog metadata + its rendered component. */
export interface WidgetDefinition extends WidgetMeta {
  Component: WidgetComponent;
}

export type { WidgetType, WidgetSize };
