import { Check } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

type CompleteToggleProps = {
  done: boolean;
  disabled?: boolean;
  onToggle: () => void;
  className?: string;
  "aria-label"?: string;
};

/**
 * The round check-off control used on task rows, cards, and subtasks. Done =
 * a filled primary circle with a check that springs in (`.check-pop` — the one
 * sanctioned delight moment; reduced-motion disables the pop, the check just
 * appears). The accent fill on the done state is intentional and quiet.
 */
function CompleteToggle({
  done,
  disabled = false,
  onToggle,
  className,
  ...props
}: CompleteToggleProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={done}
      aria-label={props["aria-label"] ?? (done ? "Mark as not done" : "Mark as done")}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        // hit-min pads the pointer target to 24 px; the 16 px circle stays (DS-6).
        "hit-min flex size-4 shrink-0 items-center justify-center rounded-full border",
        "transition-[color,background-color,border-color] duration-(--motion-fade) ease-(--ease-out)",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        done
          ? "border-primary bg-primary text-primary-foreground"
          : "border-muted-foreground/50 hover:border-foreground",
        disabled && "opacity-50",
        className,
      )}
    >
      {done ? <Check className="check-pop size-2.5" strokeWidth={3} aria-hidden /> : null}
    </button>
  );
}

export type { CompleteToggleProps };
export { CompleteToggle };
