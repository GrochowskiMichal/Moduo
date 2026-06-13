import * as React from "react";

import { cn } from "@/src/lib/utils";
import { Button, type ButtonProps } from "./button";
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip";

type IconButtonProps = Omit<ButtonProps, "size" | "children" | "aria-label"> & {
  /** The lucide (or any) icon component to render. */
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Accessible name — used as aria-label AND the tooltip text. Required. */
  label: string;
  /** Square control rung. `sm` = --ctrl-h-sm (default), `md` = --ctrl-h. */
  size?: "sm" | "md";
  /** Override tooltip content (defaults to `label`). Pass null to suppress. */
  tooltip?: React.ReactNode;
  tooltipSide?: "top" | "right" | "bottom" | "left";
};

/**
 * The single icon-only button for the app. Wraps Button size="icon", enforces
 * an accessible `label` (aria-label + tooltip, per CLAUDE.md a11y rule), and
 * sizes to the control rung so it stacks with text controls. Defaults to the
 * `ghost` variant + `sm` rung (the common toolbar/row affordance).
 */
function IconButton({
  icon: Icon,
  label,
  size = "sm",
  variant = "ghost",
  tooltip,
  tooltipSide = "top",
  style,
  ...props
}: IconButtonProps) {
  const sizeVar = size === "sm" ? "var(--ctrl-h-sm)" : "var(--ctrl-h)";
  const button = (
    <Button
      variant={variant}
      size="icon"
      aria-label={label}
      style={{ height: sizeVar, width: sizeVar, ...style }}
      {...props}
    >
      <Icon aria-hidden className={cn(size === "md" && "size-icon")} />
    </Button>
  );

  if (tooltip === null) return button;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side={tooltipSide}>{tooltip ?? label}</TooltipContent>
    </Tooltip>
  );
}

export { IconButton };
export type { IconButtonProps };
