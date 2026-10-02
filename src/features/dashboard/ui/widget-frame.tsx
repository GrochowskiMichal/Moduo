import { Maximize2, X } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SegmentedControl } from "@/components/ui/segmented-control";

import { useWidgetActions } from "../context/widget-actions-context";
import type { WidgetInstance, WidgetSize } from "../engine/types";
import { allowedSizesFor, widgetMeta } from "../registry/catalog";
import { getConfigForm } from "../registry/config-forms";
import { openModuleRoute } from "../widget-nav";
import { WidgetBody } from "./widget-body";
import { WidgetConfigButton } from "./widget-config-button";

export interface WidgetFrameProps {
  widget: WidgetInstance;
  /** Edit mode reveals the remove + resize controls (AC4). */
  editing?: boolean;
  /** The sizes this widget may take (defaults to the type's declared set). */
  allowedSizes?: readonly WidgetSize[];
  onRemove?: (id: string) => void;
  onResize?: (id: string, size: WidgetSize) => void;
}

/**
 * The card chrome that wraps every widget on the grid. The header shows the
 * registry label (a deep-link into the module when the type declares one) and
 * the body is the registry-driven widget (DB-5); DB-3's edit-mode affordances
 * (remove ✕ + a size popover) sit in an absolutely-positioned cluster so
 * revealing them never reflows the card, and carry `data-no-drag` so pressing
 * one can't start a widget drag.
 */
export function WidgetFrame({
  widget,
  editing = false,
  allowedSizes,
  onRemove,
  onResize,
}: WidgetFrameProps) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const meta = widgetMeta(widget.type);
  const sizes = allowedSizes ?? allowedSizesFor(widget.type);
  const { updateConfig } = useWidgetActions();
  const boundUpdateConfig = (patch: Record<string, unknown>) => updateConfig(widget.id, patch);
  const hasConfig = Boolean(getConfigForm(widget.type));

  return (
    <div className="group relative flex h-full w-full flex-col overflow-hidden rounded-lg border border-border bg-card">
      <div className="shrink-0 px-3 py-2">
        {meta.openRoute && !editing ? (
          <button
            type="button"
            onClick={() => openModuleRoute(meta.openRoute!)}
            className="max-w-full truncate rounded-sm font-display text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {meta.label}
          </button>
        ) : (
          <span className="block truncate font-display text-sm font-medium text-foreground">
            {meta.label}
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <WidgetBody widget={widget} />
      </div>

      {/* Config (AC10): a `⋯` popover — hover-revealed in normal mode. */}
      {!editing && hasConfig ? (
        <div
          data-no-drag
          className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-[var(--motion-fade)] focus-within:opacity-100 group-hover:opacity-100"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <WidgetConfigButton widget={widget} updateConfig={boundUpdateConfig} />
        </div>
      ) : null}

      {editing ? (
        <div
          data-no-drag
          className="absolute right-1.5 top-1.5 flex items-center gap-1 rounded-md bg-card/90 p-0.5 shadow-sm backdrop-blur-sm"
          // The cluster owns its presses so they resolve as clicks, never a drag.
          onPointerDown={(e) => e.stopPropagation()}
        >
          <WidgetConfigButton widget={widget} updateConfig={boundUpdateConfig} />
          {onResize && sizes.length > 1 ? (
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
                  items={sizes.map((s) => ({ value: s, label: s }))}
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
