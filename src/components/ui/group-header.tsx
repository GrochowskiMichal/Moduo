import { ChevronDown } from "lucide-react";
import type * as React from "react";

import { cn } from "@/lib/utils";

/*
 * GroupHeader — one header for every grouping (DS-6, tasks-v3 §19, call 40):
 * list groups, board columns, timeline lanes, rail sections and Upcoming's day
 * headers all use it.
 *
 * - Sentence case, as typed: a group is usually named by a person (a project,
 *   a status, a team), and people's words are never capitalised (call 40).
 *   Small caps (`Eyebrow`) stay for fixed chrome labels only; the
 *   small-caps-on-user-words guard in `lint:tw` fails a header built on them.
 * - 13 px medium label · an optional sub-line ("· Mon, Oct 12") · the count in
 *   the tertiary level (call 38) · hover actions in a slot that is always
 *   reserved and fades in (R6: never `hidden → flex`).
 * - The density's small row height (`--row-h-sm`: 28 / 26 / 24).
 * - Collapsible when given `onToggle`: the whole label is one button with a
 *   chevron (rotated, a glyph, never text) and `aria-expanded`.
 * - Sticky in a scroller when `sticky` is set; give it the scroller's surface
 *   through `className` (default `bg-background`).
 */

type GroupHeaderProps = Omit<React.ComponentProps<"div">, "children"> & {
  /** The group's name, exactly as the person typed it. */
  label: React.ReactNode;
  /** A plain count ("5") or progress ("2/5"). Hidden when undefined. */
  count?: React.ReactNode;
  /** A quiet second fact after the label ("· Mon, Oct 12"). */
  sub?: React.ReactNode;
  /** A dot, team mark or icon before the label. */
  leading?: React.ReactNode;
  /** Shown on hover / focus-within, in a reserved slot ("+", "⋯"). */
  actions?: React.ReactNode;
  /** Makes the label a toggle; `collapsed` turns the chevron. */
  onToggle?: () => void;
  collapsed?: boolean;
  sticky?: boolean;
  /** Heading level for the label when it is not a toggle. */
  as?: "div" | "h2" | "h3" | "h4";
};

function GroupHeader({
  label,
  count,
  sub,
  leading,
  actions,
  onToggle,
  collapsed = false,
  sticky = false,
  as: LabelTag = "div",
  className,
  ...props
}: GroupHeaderProps) {
  const body = (
    <>
      {onToggle ? (
        <ChevronDown
          aria-hidden
          className={cn(
            "size-icon-xs shrink-0 text-subtle-foreground transition-transform duration-(--motion-fast) ease-(--ease-out)",
            collapsed && "-rotate-90",
          )}
        />
      ) : null}
      {leading ? <span className="flex shrink-0 items-center">{leading}</span> : null}
      <span data-slot="group-header-label" className="min-w-0 truncate">
        {label}
      </span>
      {sub ? (
        <span className="shrink-0 font-sans text-xs font-normal whitespace-nowrap text-subtle-foreground">
          {sub}
        </span>
      ) : null}
      {count !== undefined && count !== null ? (
        <span className="shrink-0 font-sans text-xs font-normal whitespace-nowrap text-subtle-foreground tabular-nums">
          {count}
        </span>
      ) : null}
    </>
  );
  const labelClass =
    "flex min-w-0 items-center gap-2 font-display text-sm font-medium text-foreground";
  return (
    <div
      data-slot="group-header"
      className={cn(
        "group/gh flex h-(--row-h-sm) min-w-0 items-center gap-2 rounded-md ps-2 pe-1.5",
        sticky && "sticky top-0 z-(--z-sticky) bg-background",
        className,
      )}
      {...props}
    >
      {onToggle ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className={cn(
            labelClass,
            "-ms-1 h-full flex-1 rounded-sm ps-1 text-start outline-none",
            "transition-colors duration-(--motion-fade) ease-(--ease-out)",
            "hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring/50",
          )}
        >
          {body}
        </button>
      ) : (
        <LabelTag className={cn(labelClass, "flex-1")}>{body}</LabelTag>
      )}
      {actions ? (
        <span
          data-slot="group-header-actions"
          className={cn(
            "flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out)",
            "group-hover/gh:opacity-100 group-focus-within/gh:opacity-100",
          )}
        >
          {actions}
        </span>
      ) : null}
    </div>
  );
}

export type { GroupHeaderProps };
export { GroupHeader };
