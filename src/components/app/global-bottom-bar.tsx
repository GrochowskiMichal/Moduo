import { Plus, Search } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

import { dispatchOpenPalette } from "./global-command-palette";
import { dispatchCreateNew } from "./create-events";

function BarButton({
  onClick,
  label,
  children,
}: {
  onClick?: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={onClick}
        aria-label={label}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export function GlobalBottomBar() {
  return (
    <div
      data-slot="global-bottom-bar"
      className="flex flex-row items-center justify-center gap-2"
      style={{ height: "var(--bar-h)" }}
      role="toolbar"
      aria-label="Global actions"
    >
      <BarButton onClick={() => dispatchOpenPalette()} label="Search">
        <Search className="size-4" aria-hidden />
      </BarButton>
      <BarButton onClick={() => dispatchCreateNew()} label="Create new">
        <Plus className="size-4" aria-hidden />
      </BarButton>
    </div>
  );
}
