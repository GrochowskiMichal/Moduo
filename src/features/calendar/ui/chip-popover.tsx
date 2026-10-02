// The shared shell for chip popovers (task blocks + events): a virtual
// fixed-position anchor at the clicked chip's rect + the standard content
// frame. CAL-4's triage row and CAL-5's Start focus extend the two popovers —
// the shell keeps their positioning/frame from drifting apart.

import type { ReactNode } from "react";

import { Popover, PopoverAnchor, PopoverContent } from "../../../components/ui/popover";

type Props = {
  anchorRect: DOMRect;
  onClose: () => void;
  children: ReactNode;
};

export function ChipPopover({ anchorRect, onClose, children }: Props) {
  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          style={{
            position: "fixed",
            top: anchorRect.top,
            left: anchorRect.left,
            width: anchorRect.width,
            height: anchorRect.height,
            pointerEvents: "none",
          }}
        />
      </PopoverAnchor>
      <PopoverContent align="start" side="right" sideOffset={6} className="w-64 p-3">
        <div className="flex flex-col gap-2">{children}</div>
      </PopoverContent>
    </Popover>
  );
}
