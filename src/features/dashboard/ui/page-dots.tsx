import { Plus, Trash2 } from "lucide-react";

import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";

export interface PageDotsProps {
  count: number;
  activeIndex: number;
  onSelect: (index: number) => void;
  /** Edit mode reveals add / remove-page affordances (AC5). */
  editing?: boolean;
  onAddPage?: () => void;
  onRemovePage?: () => void;
}

/**
 * The iOS-style page indicator (AC5) — one dot per page, centered at the bottom.
 * Dots are buttons (keyboard-reachable with a focus ring, AC12); the active one
 * widens. Hidden entirely for a single page in normal mode (no chrome to show);
 * in edit mode it always renders so pages can be added/removed.
 */
export function PageDots({
  count,
  activeIndex,
  onSelect,
  editing = false,
  onAddPage,
  onRemovePage,
}: PageDotsProps) {
  if (count <= 1 && !editing) return null;

  return (
    <div className="flex items-center justify-center gap-2">
      <div className="flex items-center gap-1.5" role="tablist" aria-label="Dashboard pages">
        {Array.from({ length: count }, (_, i) => {
          const active = i === activeIndex;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`Go to page ${i + 1} of ${count}`}
              onClick={() => onSelect(i)}
              className={cn(
                "h-1.5 rounded-full transition-all duration-(--motion-fade) ease-(--ease-out)",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active ? "w-4 bg-foreground" : "w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground/70",
              )}
            />
          );
        })}
      </div>

      {editing ? (
        <div className="flex items-center gap-0.5">
          {onAddPage ? <IconButton icon={Plus} label="Add page" onClick={onAddPage} /> : null}
          {onRemovePage ? (
            <IconButton
              icon={Trash2}
              label="Remove this page"
              onClick={onRemovePage}
              disabled={count <= 1}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
