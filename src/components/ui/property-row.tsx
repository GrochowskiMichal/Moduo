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
  /** The value: a control, text, chips, a small list. */
  children: React.ReactNode;
  className?: string;
};

/**
 * One label-left / value-right property row. Stack several and their fixed
 * label column lines them up into a scannable grid — the Linear right-rail
 * pattern. Scalar properties keep the default center align; multi-line values
 * pass `align="start"`. Generic and module-agnostic — the Tasks detail panel is
 * the first consumer; Notes / Mail inherit it next.
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
      className={cn(
        "flex gap-3",
        align === "start" ? "items-start" : "min-h-8 items-center",
        className,
      )}
    >
      <Label
        {...(htmlFor ? { htmlFor } : {})}
        className={cn(
          "flex w-24 shrink-0 items-center gap-1.5 font-sans text-xs text-muted-foreground",
          align === "start" && "pt-1.5",
        )}
      >
        {Icon ? <Icon className="size-3.5 shrink-0 opacity-70" aria-hidden /> : null}
        <span className="truncate">{label}</span>
      </Label>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export type { PropertyRowProps };
export { PropertyRow };
