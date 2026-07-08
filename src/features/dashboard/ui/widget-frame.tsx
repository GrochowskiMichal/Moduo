import type { WidgetInstance } from "../engine/types";

/** Prettify a widget type into a human label ("quick-capture" → "Quick capture").
 * DB-5 replaces this with the registry's declared name + the real widget body. */
function prettyType(type: string): string {
  const words = type.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The card chrome that wraps every widget on the grid. DB-2 renders a titled
 * placeholder body; DB-5 swaps the body for the registry component and DB-3 adds
 * the edit-mode affordances (remove / resize / drag). Kept deliberately thin so
 * those layers slot in without reshaping the frame.
 */
export function WidgetFrame({ widget }: { widget: WidgetInstance }) {
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="px-3 py-2">
        <span className="font-display text-sm font-medium text-foreground">
          {prettyType(widget.type)}
        </span>
      </div>
      <div className="flex-1" aria-hidden />
    </div>
  );
}
