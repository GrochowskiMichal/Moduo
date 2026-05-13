import { Plus, Search, Sparkles } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";

import { dispatchOpenPalette } from "./global-command-palette";

type Props = {
  onCreate?: () => void;
};

export function GlobalBottomBar({ onCreate }: Props) {
  const platform =
    typeof navigator !== "undefined" && navigator.platform?.toLowerCase().includes("mac")
      ? "mac"
      : "other";
  const shortcutLabel = platform === "mac" ? "⌘K" : "Ctrl K";

  return (
    <div
      data-slot="global-bottom-bar"
      className="pointer-events-none fixed inset-x-0 bottom-3 z-40 flex justify-center"
    >
      <div
        className="pointer-events-auto flex h-12 items-center gap-1.5 rounded-full border border-border bg-popover p-1.5 text-popover-foreground shadow-overlay"
        role="toolbar"
        aria-label="Global actions"
      >
        <Tooltip>
          <TooltipTrigger
            className="grid h-9 w-9 place-items-center rounded-full bg-primary text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
            aria-label="Ask AI"
            data-accent="pink"
          >
            <Sparkles className="size-4" aria-hidden />
          </TooltipTrigger>
          <TooltipContent>Ask AI</TooltipContent>
        </Tooltip>

        <button
          type="button"
          onClick={() => dispatchOpenPalette()}
          className="group flex h-9 min-w-[14rem] items-center gap-2 rounded-full bg-muted/40 px-3 font-sans text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
          aria-label="Open command palette"
        >
          <Search className="size-4" aria-hidden />
          <span className="flex-1 text-left">Search or jump…</span>
          <kbd
            aria-hidden
            className="rounded-md border border-border bg-card px-1.5 py-0.5 font-mono text-xs text-muted-foreground"
          >
            {shortcutLabel}
          </kbd>
        </button>

        <Tooltip>
          <TooltipTrigger
            onClick={onCreate}
            className="grid h-9 w-9 place-items-center rounded-full border border-border bg-card text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-popover"
            aria-label="Create new"
          >
            <Plus className="size-4" aria-hidden />
          </TooltipTrigger>
          <TooltipContent>Create new</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
}
