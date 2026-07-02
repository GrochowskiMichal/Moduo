// The center hub as a drop target for drag-to-link (block FX-9, AC12). Wraps the
// selected contact/company hub in a spine `useDropLinkTarget` (CT-3); when an
// accepted entity drag hovers, a quiet accent ring invites the drop. Presentational
// only — acceptance + the created relation kind are the drag-payload contract's
// job; the page's onDragEnd persists via createLinkWithToast. Must render inside
// the page's <DndContext>. Tokens only.

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";
import type { EntityRef } from "@/lib/entity-links";
import { linkTarget } from "@/lib/drag-payload";
import { useDropLinkTarget } from "../../spine/hooks/use-drag-payload";

export function HubDropZone({
  target,
  disabled = false,
  children,
}: {
  target: EntityRef;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDropLinkTarget(linkTarget({ type: target.type, id: target.id }), { disabled });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "h-full min-h-0 rounded-lg transition-shadow",
        // A quiet accent ring while a valid drop hovers (a transient interaction
        // state, like a focus ring — R5-permitted accent moment).
        isOver && "ring-2 ring-inset ring-primary/60",
      )}
    >
      {children}
    </div>
  );
}
