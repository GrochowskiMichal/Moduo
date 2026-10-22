import { GripVertical } from "lucide-react";
import * as React from "react";
import {
  Group as ResizableGroupPrimitive,
  type GroupProps,
  Panel as ResizablePanelPrimitive,
  type PanelProps,
  Separator as ResizableSeparatorPrimitive,
  type SeparatorProps,
} from "react-resizable-panels";

import { cn } from "@/lib/utils";

type Direction = "horizontal" | "vertical";

type ResizablePanelGroupProps = Omit<GroupProps, "orientation"> & {
  direction?: Direction;
};

// The handle is only as wide as the gap between two panels (--panel-gap, 8 px,
// MOD-162), but it stays a 16 px drag target: the library hit-tests by
// geometry, growing each separator's box to this minimum (half over each
// panel's edge, its border and padding), so a pseudo-element would not widen it.
const RESIZE_TARGET = { fine: 16, coarse: 20 } as const;

function ResizablePanelGroup({
  className,
  direction = "horizontal",
  style,
  ...props
}: ResizablePanelGroupProps) {
  return (
    <ResizableGroupPrimitive
      data-slot="resizable-panel-group"
      data-direction={direction}
      orientation={direction}
      resizeTargetMinimumSize={RESIZE_TARGET}
      className={cn("flex h-full w-full data-[direction=vertical]:flex-col", className)}
      // The library's one overridable style (MOD-161): it clips like its own
      // `hidden` but is no scroll container, so focusing or scrolling to
      // something inside a panel can never shift the panels sideways.
      style={{ overflow: "clip", ...style }}
      {...props}
    />
  );
}

function ResizablePanel({ className, ...props }: PanelProps) {
  // The library writes flexGrow / overflow / max-size styles on the inner
  // content div this className lands on; keep it as the default block-level
  // container so children can simply fill width and height. Don't add `flex`
  // here — that would make the inner div a flex container and shrink-wrap
  // its children to content width.
  return (
    <ResizablePanelPrimitive
      data-slot="resizable-panel"
      className={cn("min-h-0 min-w-0", className)}
      {...props}
    />
  );
}

function ResizableHandle({
  withHandle = false,
  className,
  ...props
}: SeparatorProps & { withHandle?: boolean }) {
  return (
    <ResizableSeparatorPrimitive
      data-slot="resizable-handle"
      className={cn(
        // The gap between two panels; the line is centred in it.
        "relative flex w-(--panel-gap) items-center justify-center bg-transparent transition-colors",
        "before:absolute before:inset-y-2 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-transparent before:transition-colors",
        // The library's state, which covers the whole 16 px target, not only
        // the 8 px box (`:hover` would): hover draws the line, a drag the accent.
        "data-[separator=hover]:before:bg-border data-[separator=active]:before:bg-primary",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    >
      {withHandle ? (
        <div className="z-10 grid h-6 w-3 place-items-center rounded-sm border border-border bg-muted text-muted-foreground">
          <GripVertical className="size-3" aria-hidden />
        </div>
      ) : null}
    </ResizableSeparatorPrimitive>
  );
}

export { ResizableHandle, ResizablePanel, ResizablePanelGroup };
