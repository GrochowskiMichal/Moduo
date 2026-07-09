import { Maximize2, X } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";

import { WIDGET_SIZES, type WidgetInstance, type WidgetSize } from "../engine/types";

/** Prettify a widget type into a human label ("quick-capture" → "Quick capture").
 * DB-5 replaces this with the registry's declared name + the real widget body. */
function prettyType(type: string): string {
  const words = type.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export interface WidgetFrameProps {
  widget: WidgetInstance;
  /** Edit mode reveals the remove + resize controls (AC4). */
  editing?: boolean;
  /** The sizes this widget may take (DB-5 passes the type's declared set; defaults to all four). */
  allowedSizes?: readonly WidgetSize[];
  onRemove?: (id: string) => void;
  onResize?: (id: string, size: WidgetSize) => void;
}

/**
 * The card chrome that wraps every widget on the grid. DB-2 rendered a titled
 * placeholder; DB-3 adds the edit-mode affordances (remove ✕ + a size popover).
 * DB-5 swaps the placeholder body for the registry component. The controls sit in
 * an absolutely-positioned cluster so revealing them never reflows the card, and
 * they carry `data-no-drag` so pressing one can't start a widget drag.
 */
export function WidgetFrame({
  widget,
  editing = false,
  allowedSizes = WIDGET_SIZES,
  onRemove,
  onResize,
}: WidgetFrameProps) {
  const [sizeOpen, setSizeOpen] = useState(false);

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="px-3 py-2">
        <span className="font-display text-sm font-medium text-foreground">
          {prettyType(widget.type)}
        </span>
      </div>
      <div className="flex-1" aria-hidden />

      {editing ? (
        <div
          data-no-drag
          className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md bg-card/90 p-0.5 shadow-sm backdrop-blur-sm"
          // The cluster owns its presses so they resolve as clicks, never a drag.
          onPointerDown={(e) => e.stopPropagation()}
        >
          {onResize && allowedSizes.length > 1 ? (
            <Popover open={sizeOpen} onOpenChange={setSizeOpen}>
              <PopoverTrigger asChild>
                <IconButton icon={Maximize2} label="Resize widget" />
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-auto p-1.5"
                onPointerDown={(e) => e.stopPropagation()}
              >
                <SegmentedControl
                  aria-label="Widget size"
                  size="sm"
                  value={widget.size}
                  items={allowedSizes.map((s) => ({ value: s, label: s }))}
                  onValueChange={(next) => {
                    onResize(widget.id, next as WidgetSize);
                    setSizeOpen(false);
                  }}
                />
              </PopoverContent>
            </Popover>
          ) : null}
          {onRemove ? (
            <IconButton icon={X} label="Remove widget" onClick={() => onRemove(widget.id)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
