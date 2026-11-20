import { Slider as SliderPrimitive } from "radix-ui";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A single-value slider (shadcn's wrapper of Radix Slider). The track is the
 * state layer, the filled part and the thumb are the foreground, so it reads
 * the same on every accent. `thumbLabel` names the thumb, which is the element
 * screen readers announce (role="slider"). Arrow keys step, Page keys jump.
 */
function Slider({
  className,
  size = "default",
  thumbLabel,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & {
  size?: "sm" | "default";
  /** Accessible name of the value, e.g. "Rainfall volume". */
  thumbLabel: string;
}) {
  return (
    <SliderPrimitive.Root
      data-slot="slider"
      data-size={size}
      className={cn(
        "group/slider relative flex w-full touch-none items-center select-none",
        "data-[size=default]:h-5 data-[size=sm]:h-4",
        "data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <SliderPrimitive.Track
        data-slot="slider-track"
        className={cn(
          "relative grow overflow-hidden rounded-full bg-state-active",
          "group-data-[size=default]/slider:h-1.5 group-data-[size=sm]/slider:h-1",
        )}
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          className="absolute h-full bg-foreground/85"
        />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb
        data-slot="slider-thumb"
        aria-label={thumbLabel}
        className={cn(
          "block rounded-full bg-foreground shadow-sm outline-none",
          "transition-transform duration-(--motion-fast) ease-(--ease-out) hover:scale-110 active:scale-95",
          "focus-visible:ring-2 focus-visible:ring-ring/50",
          "group-data-[size=default]/slider:size-3.5 group-data-[size=sm]/slider:size-3",
        )}
      />
    </SliderPrimitive.Root>
  );
}

export { Slider };
