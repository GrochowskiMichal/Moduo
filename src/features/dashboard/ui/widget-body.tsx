// DB-5 — the registry-driven widget body: platform gate → permission gate →
// error boundary → the type's component. Injected by WidgetFrame in place of the
// DB-2 placeholder. Reads workspace permission + runtime capability defensively
// (defaults when there's no provider, so a bare WidgetFrame story still renders).

import { type ReactNode, useContext } from "react";

import { WorkspaceContext } from "@/features/workspaces/workspace-context";
import { getRuntime } from "@/lib/runtime";
import type { RuntimeCapabilities } from "@/lib/runtime.types";

import { useWidgetActions } from "../context/widget-actions-context";
import type { WidgetInstance } from "../engine/types";
import {
  isTypeAvailable,
  type LanePermissions,
  permissionFor,
  widgetMeta,
} from "../registry/catalog";
import { getWidgetComponent } from "../registry/widget-registry";
import { WidgetErrorBoundary } from "./widget-error-boundary";

const FALLBACK_CAPS: RuntimeCapabilities = {
  isDesktop: false,
  isWeb: true,
  hasEmail: false,
  hasTimeTracking: false,
  hasCalendarOAuth: false,
  hasLocalMnemonic: false,
  hasOfflineMode: false,
};

function WidgetPlaceholder({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center px-3 text-center">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

export function WidgetBody({ widget }: { widget: WidgetInstance }) {
  const ws = useContext(WorkspaceContext);
  const { updateConfig } = useWidgetActions();
  const lanes: LanePermissions = {
    tasks: ws?.modulePermissions.tasks ?? "edit",
    notes: ws?.modulePermissions.notes ?? "edit",
  };
  const caps = getRuntime()?.capabilities ?? FALLBACK_CAPS;
  const meta = widgetMeta(widget.type);

  // Platform gate — email / time-tracking on a runtime without the capability
  // (the instance stays in the layout; only the body is a placeholder). AC8.
  if (!isTypeAvailable(widget.type, caps)) {
    return <WidgetPlaceholder>Available on the desktop app.</WidgetPlaceholder>;
  }

  // Permission gate — "none" placeholders (hidden from gallery elsewhere), "view"
  // renders read-only (canWrite=false), "edit"/"admin" is writable. AC8.
  const permission = permissionFor(widget.type, lanes);
  if (permission === "none") {
    return <WidgetPlaceholder>No access to {meta.moduleLabel ?? meta.label}.</WidgetPlaceholder>;
  }
  const canWrite = permission === "edit" || permission === "admin";

  const Component = getWidgetComponent(widget.type);
  return (
    <WidgetErrorBoundary resetKey={`${widget.id}:${widget.size}`}>
      <Component
        widget={widget}
        size={widget.size}
        canWrite={canWrite}
        updateConfig={(patch) => updateConfig(widget.id, patch)}
      />
    </WidgetErrorBoundary>
  );
}
