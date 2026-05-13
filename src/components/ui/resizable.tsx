import * as React from "react";
import { GripVertical } from "lucide-react";
import {
  Group as ResizableGroupPrimitive,
  Panel as ResizablePanelPrimitive,
  Separator as ResizableSeparatorPrimitive,
  type GroupProps,
  type PanelProps,
  type SeparatorProps,
} from "react-resizable-panels";

import { cn } from "@/src/lib/utils";

type Direction = "horizontal" | "vertical";

type ResizablePanelGroupProps = Omit<GroupProps, "orientation"> & {
  direction?: Direction;
};

function ResizablePanelGroup({
  className,
  direction = "horizontal",
  ...props
}: ResizablePanelGroupProps) {
  return (
    <ResizableGroupPrimitive
      data-slot="resizable-panel-group"
      data-direction={direction}
      orientation={direction}
      className={cn(
        "flex h-full w-full data-[direction=vertical]:flex-col",
        className,
      )}
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
        "relative flex w-2 items-center justify-center bg-transparent transition-colors",
        "hover:bg-accent/40 data-[dragging=true]:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
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
