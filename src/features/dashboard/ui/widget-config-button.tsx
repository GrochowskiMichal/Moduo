// DB-8 (AC10) — the `⋯` config affordance: a popover anchored to the widget that
// hosts the type's ConfigForm. Renders nothing for types without one. Used both in
// the edit-mode control cluster and as a hover-revealed button in normal mode.

import { MoreHorizontal } from "lucide-react";
import { useState } from "react";

import { IconButton } from "@/components/ui/icon-button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

import type { WidgetInstance } from "../engine/types";
import { getConfigForm } from "../registry/config-forms";

export function WidgetConfigButton({
  widget,
  updateConfig,
  className,
}: {
  widget: WidgetInstance;
  updateConfig: (patch: Record<string, unknown>) => void;
  className?: string;
}) {
  const ConfigForm = getConfigForm(widget.type);
  const [open, setOpen] = useState(false);
  if (!ConfigForm) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton icon={MoreHorizontal} label="Widget settings" className={className} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-3" onPointerDown={(e) => e.stopPropagation()}>
        <ConfigForm widget={widget} updateConfig={updateConfig} onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}
