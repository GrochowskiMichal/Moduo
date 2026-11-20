// The calendar's offline line (CALR-3): in the toolbar's free room, where the
// now-and-next line sits online. "Offline" alone, or "Offline · 2 to sync",
// which opens the list of waiting changes; each of those carries the cloud-off
// mark on the grid. The device queue that fills the list is the calendar
// outbox (a later block); until it lands the line says "Offline".

import { CloudOff } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";

export type WaitingChange = { id: string; title: string };

export function offlineLabel(waiting: number): string {
  return waiting > 0 ? `Offline · ${waiting} to sync` : "Offline";
}

export function OfflineLine({ waiting }: { waiting: readonly WaitingChange[] }) {
  const label = offlineLabel(waiting.length);
  if (waiting.length === 0) {
    return (
      <span
        data-offline-line
        className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
      >
        <CloudOff aria-hidden className="size-icon-xs shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-offline-line
          className="inline-flex min-w-0 items-center gap-1.5 rounded-sm px-1 text-xs text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-expanded:bg-state-active aria-expanded:text-foreground"
        >
          <CloudOff aria-hidden className="size-icon-xs shrink-0" />
          <span className="truncate">{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <div className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground">
          Saved on this device · syncs when you're back
        </div>
        <ul className="flex flex-col">
          {waiting.map((change) => (
            <li
              key={change.id}
              className="flex items-center gap-2 rounded-sm px-2 text-sm text-foreground"
              style={{ minHeight: "var(--row-h-sm)" }}
            >
              <CloudOff aria-hidden className="size-icon-xs shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">{change.title || "Untitled"}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
