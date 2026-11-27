// A module sidebar's quiet footer (MOD-140): a few destinations side by side
// at its bottom, under the scrolling rows (Tasks: Archived · Recently deleted;
// Notes: Published · Archived · Deleted; other modules repeat it). Each item is
// its icon and label while every label fits whole, and the icon alone, named
// and with its tooltip, the moment one wouldn't: never a truncated word. The
// fit is measured, not a breakpoint, so it holds for any number of items and
// any labels, and follows the sidebar's own width as it's dragged.
//
// The item you're on is a destination, not a selection (R5): the neutral
// `bg-state-active` and `aria-current="page"`, like a NavRow.

import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export type SidebarFooterItem = {
  icon: LucideIcon;
  /** Shown beside the icon when every label fits; always its name and tooltip. */
  label: string;
  onSelect: () => void;
  /** The destination you're on. */
  active?: boolean;
  /** Always the icon alone (named, with its tooltip): a secondary item that
   * must not push the main ones' words into truncation. */
  iconOnly?: boolean;
};

// One item's box, shared by the real row and its measuring twin so the two
// are the same width.
const ITEM_BOX =
  "flex h-(--ctrl-h-sm) min-w-(--ctrl-h-sm) items-center justify-center gap-1.5 px-1.5 font-display text-sm";
const ROW = "flex items-center gap-1";

export function SidebarFooter({
  items,
  label,
  className,
}: {
  items: readonly SidebarFooterItem[];
  /** What the group is called for a screen reader ("Archive and trash"). */
  label: string;
  className?: string;
}) {
  const rowRef = useRef<HTMLUListElement>(null);
  const measureRef = useRef<HTMLUListElement>(null);
  const [wordsFit, setWordsFit] = useState(true);
  const shown = items.length > 0;
  // The words show while the measuring twin (every label whole) fits the real
  // row, kept current as either resizes: the sidebar dragged, a label or the
  // density changed. A drag fires this every frame; React drops a set to the
  // value it already holds.
  useLayoutEffect(() => {
    const row = rowRef.current;
    const measure = measureRef.current;
    if (!row || !measure) return;
    const check = () =>
      setWordsFit(measure.getBoundingClientRect().width <= row.getBoundingClientRect().width);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(row);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [shown]);
  if (!shown) return null;
  return (
    // Its own navigation landmark: the items are destinations, like the rows.
    <nav
      aria-label={label}
      data-slot="sidebar-footer"
      className={cn("relative shrink-0", className)}
    >
      <ul ref={rowRef} data-slot="sidebar-footer-row" className={cn(ROW, "min-w-0")}>
        {items.map((item) => (
          <li key={item.label} className="flex min-w-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={item.label}
                  aria-current={item.active ? "page" : undefined}
                  onClick={item.onSelect}
                  className={cn(
                    ITEM_BOX,
                    // hit-min: 24 px to point at even on the dense rung (22 px, R13).
                    "hit-min max-w-full rounded-md text-muted-foreground outline-none",
                    "transition-colors duration-(--motion-fade) ease-(--ease-out)",
                    "hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                    "aria-[current=page]:bg-state-active aria-[current=page]:text-foreground",
                  )}
                >
                  <item.icon className="size-icon-sm shrink-0" aria-hidden />
                  <span
                    data-slot="sidebar-footer-label"
                    className={cn("truncate", (!wordsFit || item.iconOnly) && "sr-only")}
                  >
                    {item.label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{item.label}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
      {/* The measuring twin: the same items with every label shown, at their
          natural width, unseen and out of the flow. */}
      <div
        aria-hidden
        className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden"
      >
        <ul ref={measureRef} data-slot="sidebar-footer-measure" className={cn(ROW, "w-max")}>
          {items.map((item) => (
            <li key={item.label} className={ITEM_BOX}>
              <item.icon className="size-icon-sm shrink-0" />
              {item.iconOnly ? null : <span className="whitespace-nowrap">{item.label}</span>}
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
