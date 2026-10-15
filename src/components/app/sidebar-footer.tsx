// A module sidebar's quiet footer (MOD-140): a few destinations side by side
// at its bottom, under the scrolling rows (Tasks: Archived · Recently
// deleted; other modules repeat it). Each item is its icon and label while the
// sidebar is wide enough, and the icon alone, named and with its tooltip, when
// it isn't. The root is an `@container`, so the swap follows the sidebar's own
// width as it's dragged, never the window's.
//
// The item you're on is a destination, not a selection (R5): the neutral
// `bg-state-active` and `aria-current="page"`, like a NavRow.

import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

export type SidebarFooterItem = {
  icon: LucideIcon;
  /** Shown beside the icon when there's room; always its name and tooltip. */
  label: string;
  onSelect: () => void;
  /** The destination you're on. */
  active?: boolean;
};

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
  if (items.length === 0) return null;
  return (
    <div data-slot="sidebar-footer" className={cn("@container shrink-0", className)}>
      <ul aria-label={label} className="flex min-w-0 items-center gap-1">
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
                    "flex h-(--ctrl-h-sm) min-w-(--ctrl-h-sm) max-w-full items-center justify-center gap-1.5 rounded-md px-1.5",
                    "font-display text-sm text-muted-foreground outline-none",
                    "transition-colors duration-(--motion-fade) ease-(--ease-out)",
                    "hover:bg-state-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                    "aria-[current=page]:bg-state-active aria-[current=page]:text-foreground",
                  )}
                >
                  <item.icon className="size-icon-sm shrink-0" aria-hidden />
                  {/* Under 14rem (224 px, what Tasks' "Archived" and
                      "Recently deleted" take at the roomiest density) the
                      words step aside for the icon alone. */}
                  <span data-slot="sidebar-footer-label" className="truncate @max-[14rem]:sr-only">
                    {item.label}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{item.label}</TooltipContent>
            </Tooltip>
          </li>
        ))}
      </ul>
    </div>
  );
}
