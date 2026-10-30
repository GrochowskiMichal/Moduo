import { ChevronRight } from "lucide-react";
import { type ComponentType, type ReactNode, useId } from "react";

import { ChipButton, type ChipButtonProps } from "@/components/ui/chip";
import { SELECTED_OPTION } from "@/components/ui/selection";
import { cn } from "@/lib/utils";

// Small shared pieces of the booking link editor: the option chip (a length,
// a notice, a day) and the "More options" row that opens in place.

type OptionChipProps = Omit<ChipButtonProps, "active" | "aria-pressed"> & {
  on: boolean;
};

/** A chip that is one choice of a few: pressed reads as the selected option. */
export function OptionChip({ on, className, ...props }: OptionChipProps) {
  return (
    <ChipButton
      aria-pressed={on}
      className={cn(
        on ? cn(SELECTED_OPTION, "hover:bg-state-selected-hover") : "text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/** A labelled line of option chips ("Up to · 1 week 2 weeks …"). */
export function ChipLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="flex h-(--ctrl-h-sm) w-24 shrink-0 items-center text-sm text-muted-foreground">
        {label}
      </span>
      <fieldset aria-label={label} className="flex min-w-0 flex-wrap gap-1">
        {children}
      </fieldset>
    </div>
  );
}

type MoreRowProps = {
  icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  title: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
};

/** One line of "More options": icon, title, a muted summary, a chevron; opens in place. */
export function MoreRow({ icon: Icon, title, summary, open, onToggle, children }: MoreRowProps) {
  const panelId = useId();
  return (
    <div className="border-t border-hairline">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={onToggle}
        className={cn(
          "flex min-h-(--ctrl-h-lg) w-full items-center gap-3 rounded-md px-1 text-left outline-none",
          "transition-colors duration-(--motion-fade) ease-(--ease-out)",
          "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
        )}
      >
        <Icon aria-hidden className="size-icon-sm shrink-0 text-muted-foreground" />
        <span className="w-36 shrink-0 font-display text-base text-foreground">{title}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          <span className="sr-only">, </span>
          {summary}
        </span>
        <ChevronRight
          aria-hidden
          className={cn(
            "size-icon-sm shrink-0 text-subtle-foreground transition-transform duration-(--motion-fast) ease-(--ease-out)",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <div id={panelId} className="flex flex-col gap-3 pt-1 pr-1 pb-4 pl-8">
          {children}
        </div>
      ) : null}
    </div>
  );
}
