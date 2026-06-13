import * as React from "react";

import { cn } from "@/src/lib/utils";

/**
 * Layout primitive for an aligned control row — NOT new controls. Enforces one
 * height baseline, one gap, and a consistent left→right rhythm so a row of
 * mixed controls (Button, SegmentedControl, Select, IconButton) reads as one
 * toolbar instead of "stitched from different systems". Put view-shaping
 * controls in `Toolbar.Group` (left), then `Toolbar.Spacer`, then the primary
 * action via `Toolbar.Primary` (right). Keep every child on ONE control rung
 * (e.g. all `size="sm"`).
 */
function Toolbar({
  className,
  children,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      role="toolbar"
      data-slot="toolbar"
      className={cn("flex items-center gap-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}

function ToolbarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar-group"
      className={cn("flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

function ToolbarSpacer() {
  return <div className="flex-1" aria-hidden />;
}

function ToolbarPrimary({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar-primary"
      className={cn("flex items-center gap-1.5", className)}
      {...props}
    />
  );
}

Toolbar.Group = ToolbarGroup;
Toolbar.Spacer = ToolbarSpacer;
Toolbar.Primary = ToolbarPrimary;

export { Toolbar };
