import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";

/**
 * Token-routed calendar (react-day-picker v10). Selected day = bg-primary;
 * today = a quiet ring (NOT a chromatic fill, so it doesn't compete with the
 * selection); hover = bg-accent; outside-month days are muted. Used inside
 * DateField's popover. No raw color — all surfaces/accents via tokens.
 */
function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  ...props
}: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-3", className)}
      classNames={{
        months: "flex flex-col gap-4",
        month: "flex flex-col gap-3",
        month_caption: "relative flex h-7 items-center justify-center",
        caption_label: "font-display text-sm font-medium text-foreground",
        nav: "flex items-center",
        button_previous:
          "absolute left-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40",
        button_next:
          "absolute right-1 inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-8 text-2xs font-normal text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "relative p-0 text-center",
        day_button:
          "inline-flex size-8 items-center justify-center rounded-md text-sm font-normal text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected:
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:hover:bg-primary",
        today: "[&>button]:ring-1 [&>button]:ring-ring",
        outside: "[&>button]:text-muted-foreground/50",
        disabled: "[&>button]:pointer-events-none [&>button]:opacity-40",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation, className: chevronClassName }) =>
          orientation === "left" ? (
            <ChevronLeft className={cn("size-icon-sm", chevronClassName)} aria-hidden />
          ) : (
            <ChevronRight className={cn("size-icon-sm", chevronClassName)} aria-hidden />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
