import type * as React from "react";

import { cn } from "@/lib/utils";

type PropertyRowProps = {
  /** Left-column label. A fixed width so stacked rows align into a grid. */
  label: React.ReactNode;
  /** Optional lucide icon shown before the label. */
  icon?: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  /** Associate the label with its control (renders a `<label htmlFor>`). */
  htmlFor?: string;
  /**
   * Center the value against the label (default — for a single-line control),
   * or top-align it for multi-line / wrapping values (tag lists, sub-items).
   */
  align?: "center" | "start";
  /** The value: usually a `PropertyValue`; also text, chips, a small list. */
  children: React.ReactNode;
  className?: string;
};

/**
 * One label-left / value-right property row. Stack several and their fixed
 * label column lines them up into a scannable grid — the Linear right-rail
 * pattern. Each row is one small control rung tall (`--ctrl-h-sm`); a
 * wrapping value passes `align="start"` and the label stays on its first line.
 * Generic and module-agnostic — the Tasks detail panel is the first consumer.
 */
function PropertyRow({
  label,
  icon: Icon,
  htmlFor,
  align = "center",
  children,
  className,
}: PropertyRowProps) {
  const Label = htmlFor ? "label" : "span";
  return (
    <div
      data-slot="property-row"
      className={cn(
        "flex min-h-(--ctrl-h-sm) gap-2",
        align === "start" ? "items-start" : "items-center",
        className,
      )}
    >
      <Label
        {...(htmlFor ? { htmlFor } : {})}
        className="flex h-(--ctrl-h-sm) w-24 shrink-0 items-center gap-1.5 font-sans text-sm text-muted-foreground"
      >
        {Icon ? <Icon className="size-icon-sm shrink-0 opacity-70" aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </Label>
      <div className="flex min-w-0 flex-1 items-center">{children}</div>
    </div>
  );
}

type PropertyValueProps = React.ComponentProps<"button"> & {
  /** The 14px slot every value starts behind (an icon, a glyph, an avatar), so values line up. */
  icon?: React.ReactNode;
  /** No value yet: the text is a muted placeholder ("Set priority"). */
  empty?: boolean;
  /** Extra content after the value that may not truncate (a bar, a share). */
  trailing?: React.ReactNode;
};

/**
 * A property's value as its own quiet control: icon slot + value, no chevron
 * and no box; hover shows the field (tasks-v2 §9). Use it as the trigger of the
 * picker that edits the value (`asChild` on a Popover/DropdownMenu trigger).
 * Disabled (view-only) keeps the value at full strength, just inert.
 */
function PropertyValue({
  icon,
  empty = false,
  trailing,
  className,
  children,
  type = "button",
  ...props
}: PropertyValueProps) {
  return (
    <button
      type={type}
      data-slot="property-value"
      data-empty={empty || undefined}
      className={cn(
        "-ml-1.5 inline-flex h-(--ctrl-h-sm) max-w-full min-w-0 items-center gap-2 rounded-md px-1.5",
        "text-left font-sans text-base text-foreground outline-none",
        "transition-colors duration-(--motion-fade) ease-(--ease-out)",
        "hover:bg-state-hover aria-expanded:bg-state-active",
        "focus-visible:ring-2 focus-visible:ring-ring/50",
        "disabled:cursor-default disabled:hover:bg-transparent",
        empty && "text-muted-foreground",
        className,
      )}
      {...props}
    >
      {icon !== undefined ? (
        <span
          aria-hidden
          className="flex size-icon-sm shrink-0 items-center justify-center text-muted-foreground [&_svg]:size-icon-sm"
        >
          {icon}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
      {trailing}
    </button>
  );
}

export type { PropertyRowProps, PropertyValueProps };
export { PropertyRow, PropertyValue };
