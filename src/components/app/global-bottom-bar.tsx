import { Plus, Search, SlidersHorizontal } from "lucide-react";

import { formatShortcut, SHORTCUTS } from "../../lib/shortcuts";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

import { dispatchOpenPalette } from "./global-command-palette";
import { dispatchCreateNew } from "./create-events";

function BarButton({
  onClick,
  label,
  hint,
  children,
}: {
  onClick?: () => void;
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onClick}
        aria-label={hint ? `${label} (${hint})` : label}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        <span>{label}</span>
        {hint ? <kbd className="ml-2 font-mono text-xs text-muted-foreground">{hint}</kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

const newItemShortcut = SHORTCUTS.find((s) => s.id === "new-item");
const paletteShortcut = SHORTCUTS.find((s) => s.id === "palette");

export function GlobalBottomBar() {
  const createHint = newItemShortcut ? formatShortcut(newItemShortcut) : undefined;
  const searchHint = paletteShortcut ? formatShortcut(paletteShortcut) : undefined;
  return (
    <div
      data-slot="global-bottom-bar"
      className="flex flex-row items-center justify-center gap-2"
      style={{ height: "var(--bar-h)" }}
      role="toolbar"
      aria-label="Global actions"
    >
      <BarButton
        onClick={() => {
          /* placeholder for per-feature settings; wired by per-feature polish */
        }}
        label="Feature settings"
      >
        <SlidersHorizontal className="size-4" aria-hidden />
      </BarButton>
      <BarButton onClick={() => dispatchOpenPalette()} label="Search" hint={searchHint}>
        <Search className="size-4" aria-hidden />
      </BarButton>
      <BarButton onClick={() => dispatchCreateNew()} label="Create new" hint={createHint}>
        <Plus className="size-4" aria-hidden />
      </BarButton>
    </div>
  );
}
