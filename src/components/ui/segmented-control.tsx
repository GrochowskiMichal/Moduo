import * as React from "react";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { cn } from "@/src/lib/utils";

export type SegmentedItem = {
  value: string;
  label?: string;
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Accessible label — required when the item is icon-only. */
  ariaLabel?: string;
};

export type SegmentedControlProps = {
  value: string;
  onValueChange: (value: string) => void;
  items: SegmentedItem[];
  size?: "sm" | "default";
  /** Render icons only (no text labels). Each item then needs `ariaLabel`. */
  iconOnly?: boolean;
  /** Stretch to fill the container with equal-width segments (rail toggles). */
  fullWidth?: boolean;
  "aria-label": string;
  className?: string;
};

/**
 * One segmented toggle for the whole app — replaces the hand-rolled View
 * switcher, the rail Plan/Queue toggle, and the Execute Pomodoro/Duration
 * toggle. Single-select, always one active. Active segment is a NEUTRAL raised
 * plate (bg-card) on a bg-muted track — no accent (accent budget is spent on
 * primary actions + selection, not chrome toggles). Height tracks the control
 * rung; font/icon match the Button on the same rung so they stack.
 */
function SegmentedControl({
  value,
  onValueChange,
  items,
  size = "default",
  iconOnly = false,
  fullWidth = false,
  className,
  ...props
}: SegmentedControlProps) {
  const heightVar = size === "sm" ? "var(--ctrl-h-sm)" : "var(--ctrl-h)";
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        // Guard against deselect — a segmented control always keeps one active.
        if (next) onValueChange(next);
      }}
      aria-label={props["aria-label"]}
      data-slot="segmented-control"
      data-size={size}
      className={cn(
        "items-center gap-0.5 rounded-md bg-muted",
        fullWidth ? "flex w-full" : "inline-flex shrink-0",
        size === "sm" ? "p-0.5" : "p-1",
        className,
      )}
      style={{ height: heightVar }}
    >
      {items.map(({ value: itemValue, label, icon: Icon, ariaLabel }) => (
        <ToggleGroupPrimitive.Item
          key={itemValue}
          value={itemValue}
          aria-label={ariaLabel ?? label ?? itemValue}
          className={cn(
            "inline-flex h-full items-center justify-center gap-1.5 rounded-sm font-display text-base font-medium text-muted-foreground",
            "transition-[color,background-color,box-shadow] duration-(--motion-fade) ease-(--ease-out)",
            "hover:text-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            "data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm",
            fullWidth && "flex-1",
            iconOnly ? "aspect-square" : "px-2.5",
            "[&_svg]:size-icon-sm [&_svg]:shrink-0",
          )}
        >
          {Icon ? <Icon aria-hidden /> : null}
          {!iconOnly && label ? <span>{label}</span> : null}
        </ToggleGroupPrimitive.Item>
      ))}
    </ToggleGroupPrimitive.Root>
  );
}

export { SegmentedControl };
