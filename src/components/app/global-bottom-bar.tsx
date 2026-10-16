import { ChevronDown, Plus, Search, SquarePen } from "lucide-react";
import { Fragment } from "react";

import { formatShortcut, SHORTCUTS } from "../../lib/shortcuts";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Kbd } from "../ui/kbd";
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip";
import {
  BOTTOM_BAR_MODE_CAP,
  type BottomBarAction,
  type BottomBarMode,
  useBottomBarMode,
} from "./bottom-bar-mode";
import { dispatchOpenCapture } from "./capture-shell";
import { dispatchCreateNew } from "./create-events";
import { dispatchOpenPalette } from "./global-command-palette";
import { requestModuleSearch } from "./search-events";

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
        className="flex h-8 w-8 items-center justify-center rounded-md bg-transparent text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
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
const captureShortcut = SHORTCUTS.find((s) => s.id === "capture");

/** One action of a mode's row: its label, then its key. */
function ModeButton({ action }: { action: BottomBarAction }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      disabled={action.disabled}
      onClick={action.run}
      className="text-muted-foreground hover:text-foreground"
    >
      {action.label}
      {action.keyHint ? <Kbd>{action.keyHint}</Kbd> : null}
    </Button>
  );
}

/**
 * A mode's row (82b): its first six actions with their keys, separated by a
 * quiet dot, then More ▾ for the rest, then its note.
 */
function ModeRow({ mode }: { mode: BottomBarMode }) {
  const shown = mode.actions.slice(0, BOTTOM_BAR_MODE_CAP);
  const more = mode.actions.slice(BOTTOM_BAR_MODE_CAP);
  return (
    <div
      data-slot="global-bottom-bar"
      data-mode={mode.id}
      className="flex flex-row items-center justify-center gap-1"
      style={{ height: "var(--bar-h)" }}
      role="toolbar"
      aria-label={mode.label}
    >
      {shown.map((action, i) => (
        <Fragment key={action.id}>
          {i > 0 ? (
            <span aria-hidden className="text-subtle-foreground">
              ·
            </span>
          ) : null}
          <ModeButton action={action} />
        </Fragment>
      ))}
      {more.length > 0 ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-foreground"
            >
              More
              <ChevronDown aria-hidden className="size-icon-xs" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="center" className="min-w-40">
            {more.map((action) => (
              <DropdownMenuItem key={action.id} disabled={action.disabled} onSelect={action.run}>
                {action.label}
                {action.keyHint ? (
                  <DropdownMenuShortcut>{action.keyHint}</DropdownMenuShortcut>
                ) : null}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
      {mode.note ? (
        <span className="ms-2 font-sans text-xs whitespace-nowrap text-muted-foreground">
          {mode.note}
        </span>
      ) : null}
    </div>
  );
}

export function GlobalBottomBar() {
  // A page's mode (the Inbox's triage, a multi-select) takes the centre.
  const mode = useBottomBarMode();
  if (mode) return <ModeRow mode={mode} />;
  return <GlobalTools />;
}

function GlobalTools() {
  const createHint = newItemShortcut ? formatShortcut(newItemShortcut) : undefined;
  const searchHint = paletteShortcut ? formatShortcut(paletteShortcut) : undefined;
  const captureHint = captureShortcut ? formatShortcut(captureShortcut) : undefined;
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
          if (!requestModuleSearch()) dispatchOpenPalette();
        }}
        label="Search"
        hint={searchHint}
      >
        <Search className="size-4" aria-hidden />
      </BarButton>
      <BarButton onClick={() => dispatchOpenCapture()} label="Quick capture" hint={captureHint}>
        <SquarePen className="size-4" aria-hidden />
      </BarButton>
      <BarButton onClick={() => dispatchCreateNew()} label="Create new" hint={createHint}>
        <Plus className="size-4" aria-hidden />
      </BarButton>
    </div>
  );
}
