import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "./dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

/*
 * Chip — the one chip (DS-6, tasks-v3 call 45; visual audit §C). Picker pills,
 * capture pills, references and filter chips are all this; before DS-6 Tasks
 * alone had seven chip languages.
 *
 * - At rest: a hairline ring, no fill. Set / active: the neutral active fill
 *   (`state-active`), never a stronger border (one set/unset rule: fill).
 * - Density-bound height: `sm` sits on the small control rung (`--ctrl-h-sm`,
 *   14 px); `xs` is the inline rung (`--ctrl-h-xs`, 13 px) for chips inside a
 *   line of text or a row.
 * - `shape="full"` for a pill, `md` (default) for a chip.
 * - Optional leading icon on the icon rung; optional trailing × (`onRemove`)
 *   with its own label and a 24 px hit area.
 * - People's words go in as typed (call 40); the chip never truncates a date,
 *   time or count, only a long name (call 41).
 */

type ChipSize = "sm" | "xs";

type ChipOwnProps = {
  size?: ChipSize;
  shape?: "md" | "full";
  /** Set / on / filtering: the neutral active fill. */
  active?: boolean;
  /** A leading icon (lucide component) or node. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }> | React.ReactNode;
  /** Adds a trailing ×; the chip becomes a group of two controls. */
  onRemove?: () => void;
  /** The ×'s accessible name (default "Remove"). */
  removeLabel?: string;
};

function chipClasses({
  size = "sm",
  shape = "md",
  active = false,
  interactive = false,
}: {
  size?: ChipSize;
  shape?: "md" | "full";
  active?: boolean;
  interactive?: boolean;
}) {
  return cn(
    "inline-flex max-w-full min-w-0 shrink-0 items-center whitespace-nowrap font-display text-foreground",
    "ring-1 ring-hairline ring-inset outline-none",
    "transition-colors duration-(--motion-fade) ease-(--ease-out)",
    size === "sm"
      ? "h-(--ctrl-h-sm) gap-1.5 px-2 text-base"
      : "h-(--ctrl-h-xs) gap-1 px-1.5 text-sm",
    shape === "full" ? "rounded-full" : "rounded-md",
    active && "bg-state-active",
    interactive &&
      cn(
        "cursor-default focus-visible:ring-2 focus-visible:ring-ring/50",
        active ? "hover:bg-state-active-hover" : "hover:bg-state-hover",
        "disabled:pointer-events-none disabled:opacity-50",
      ),
  );
}

function ChipIcon({ icon }: { icon: ChipOwnProps["icon"] }) {
  if (!icon) return null;
  // A lucide icon is a component (a forwardRef object); anything else is a node.
  if (!React.isValidElement(icon) && (typeof icon === "function" || typeof icon === "object")) {
    const Icon = icon as React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
    return <Icon aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />;
  }
  return (
    <span className="flex shrink-0 items-center text-muted-foreground [&_svg]:size-icon-sm">
      {icon as React.ReactNode}
    </span>
  );
}

function ChipRemove({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      className={cn(
        "hit-min -me-0.5 flex shrink-0 items-center rounded-sm text-muted-foreground outline-none",
        "transition-colors duration-(--motion-fade) ease-(--ease-out)",
        "hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
      )}
    >
      <X aria-hidden className="size-icon-sm" />
    </button>
  );
}

type ChipProps = ChipOwnProps & React.ComponentProps<"span">;

/** A static chip (a reference, a tag, a read-only fact). */
function Chip({
  size,
  shape,
  active,
  icon,
  onRemove,
  removeLabel = "Remove",
  className,
  children,
  ...props
}: ChipProps) {
  return (
    <span
      data-slot="chip"
      data-active={active ? "" : undefined}
      className={cn(chipClasses({ size, shape, active }), className)}
      {...props}
    >
      <ChipIcon icon={icon} />
      <span className="min-w-0 truncate">{children}</span>
      {onRemove ? <ChipRemove label={removeLabel} onRemove={onRemove} /> : null}
    </span>
  );
}

type ChipButtonProps = Omit<ChipOwnProps, "onRemove" | "removeLabel"> &
  React.ComponentProps<"button">;

/**
 * A chip that is one button (a filter toggle, a picker trigger). A chip that
 * also needs a × is `Chip` with `onRemove`, two controls side by side, never a
 * button inside a button.
 */
function ChipButton({
  size,
  shape,
  active,
  icon,
  className,
  children,
  type = "button",
  ...props
}: ChipButtonProps) {
  return (
    <button
      type={type}
      data-slot="chip"
      data-active={active ? "" : undefined}
      className={cn(chipClasses({ size, shape, active, interactive: true }), className)}
      {...props}
    >
      <ChipIcon icon={icon} />
      <span className="min-w-0 truncate">{children}</span>
    </button>
  );
}

type PickerPillProps = Omit<ChipButtonProps, "children" | "active" | "content" | "value"> & {
  /** What the pill picks ("Due", "Assignee"); shown, muted, while unset. */
  label: string;
  /** The chosen value as text ("Oct 16", "Anna"); `null` when unset. */
  value: React.ReactNode | null;
  /** The picker: menu items (`kind="menu"`) or any popover body. */
  content: React.ReactNode;
  kind?: "menu" | "popover";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  align?: "start" | "center" | "end";
  /** Class for the menu / popover content (its width). */
  contentClassName?: string;
};

/**
 * Picker pill — a ChipButton that opens a picker (DS-6, visual audit §C). The
 * one set/unset rule: unset shows the field's name, muted, on the hairline;
 * set shows the value on the active fill. The accessible name always carries
 * both ("Due: Oct 16").
 */
function PickerPill({
  label,
  value,
  content,
  kind = "menu",
  open,
  onOpenChange,
  align = "start",
  contentClassName,
  className,
  "aria-label": ariaLabel,
  ...props
}: PickerPillProps) {
  const set = value !== null && value !== undefined && value !== "";
  const name = ariaLabel ?? (set && typeof value === "string" ? `${label}: ${value}` : label);
  const trigger = (
    <ChipButton
      active={set}
      aria-label={name}
      className={cn(!set && "text-muted-foreground", className)}
      {...props}
    >
      {set ? value : label}
    </ChipButton>
  );
  if (kind === "popover") {
    return (
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>{trigger}</PopoverTrigger>
        <PopoverContent align={align} className={cn("w-auto p-1", contentClassName)}>
          {content}
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        {content}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export type { ChipButtonProps, ChipProps, PickerPillProps };
export { Chip, ChipButton, chipClasses, PickerPill };
