// DB-8 — the Add-widget gallery (AC9). A dialog of the workspace's available
// widget types (permission + platform filtered via `galleryTypes`), each with a
// size picker; tap-to-place adds at the first free slot. When the current page
// can't fit it, the card says so and offers a new page.

import { Plus } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Eyebrow } from "@/components/ui/eyebrow";
import { SegmentedControl } from "@/components/ui/segmented-control";

import type { WidgetSize, WidgetType } from "../engine/types";
import { widgetMeta } from "../registry/catalog";
import { WIDGET_GALLERY_META } from "../registry/gallery-meta";

export interface GalleryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Types offered (already permission + platform filtered by the caller). */
  available: WidgetType[];
  /** Add to the active page; returns false when it can't fit (→ offer a new page). */
  onAdd: (type: WidgetType, size: WidgetSize) => boolean;
  onAddToNewPage: (type: WidgetType, size: WidgetSize) => void;
}

export function GalleryDialog({
  open,
  onOpenChange,
  available,
  onAdd,
  onAddToNewPage,
}: GalleryDialogProps) {
  const [sizes, setSizes] = useState<Partial<Record<WidgetType, WidgetSize>>>({});
  const [fullType, setFullType] = useState<WidgetType | null>(null);

  const sizeOf = (type: WidgetType): WidgetSize => sizes[type] ?? widgetMeta(type).defaultSize;

  const handleAdd = (type: WidgetType) => {
    const ok = onAdd(type, sizeOf(type));
    if (ok) {
      setFullType(null);
      onOpenChange(false); // close so the placed widget is visible
    } else {
      setFullType(type); // AC9: say the page is full, offer a new page
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a widget</DialogTitle>
          <DialogDescription>
            Pick a widget and size — it drops into the first free slot.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60vh] grid-cols-1 gap-2 overflow-y-auto scrollbar-thin sm:grid-cols-2">
          {available.map((type) => {
            const meta = widgetMeta(type);
            const g = WIDGET_GALLERY_META[type];
            const Icon = g.icon;
            const size = sizeOf(type);
            const isFull = fullType === type;
            return (
              <div
                key={type}
                className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted">
                    <Icon className="size-icon text-muted-foreground" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-sm font-medium text-foreground">{meta.label}</p>
                    <p className="text-xs text-muted-foreground">{g.description}</p>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2">
                  {meta.sizes.length > 1 ? (
                    <SegmentedControl
                      aria-label={`${meta.label} size`}
                      size="sm"
                      value={size}
                      items={meta.sizes.map((s) => ({ value: s, label: s }))}
                      onValueChange={(next) =>
                        setSizes((prev) => ({ ...prev, [type]: next as WidgetSize }))
                      }
                    />
                  ) : (
                    <Eyebrow tone="tag">{meta.sizes[0]}</Eyebrow>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => handleAdd(type)}>
                    <Plus className="size-icon-sm" aria-hidden />
                    Add
                  </Button>
                </div>

                {isFull ? (
                  <div className="flex items-center justify-between gap-2 rounded-md bg-muted px-2 py-1.5">
                    <span className="text-xs text-muted-foreground">This page is full.</span>
                    <button
                      type="button"
                      onClick={() => {
                        onAddToNewPage(type, size);
                        setFullType(null);
                        onOpenChange(false);
                      }}
                      className="shrink-0 rounded-sm text-xs font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Add to a new page
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
