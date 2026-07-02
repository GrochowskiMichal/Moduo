// The chip popover (single click, DESIGN_BRIEF §7b) — quick glance + the two
// escalations: Open (right-panel Detail) and Delete (native only; repeats get
// series language via the page's confirm dialog). External events show their
// source attribution instead of edit affordances; read-only fields are
// visibly static, never disabled-looking form controls.

import { ExternalLink, Trash2 } from "lucide-react";

import { Button } from "../../../components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../../../components/ui/popover";
import type { CalendarEventModel } from "../events";
import { rruleSummary } from "./repeat-picker";
import { formatTimeOfDay } from "./time-format";

type Props = {
  event: CalendarEventModel;
  /** The clicked occurrence's real span (recurring chips differ per day). */
  occStartMs: number;
  occEndMs: number;
  anchorRect: DOMRect;
  canEdit: boolean;
  /** "Personal — Google" attribution for mirrored events. */
  sourceLabel: string | null;
  onOpenDetail: () => void;
  onDelete: () => void;
  onClose: () => void;
};

export function EventPopover({
  event,
  occStartMs,
  occEndMs,
  anchorRect,
  canEdit,
  sourceLabel,
  onOpenDetail,
  onDelete,
  onClose,
}: Props) {
  const external = event.sourceAccountId !== null;
  const dayLabel = new Date(occStartMs).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const timeLabel = event.allDay
    ? `${dayLabel} · All day`
    : `${dayLabel} · ${formatTimeOfDay(occStartMs)} – ${formatTimeOfDay(occEndMs)}`;

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
        <div className="flex flex-col gap-2">
          <span className="font-display text-sm font-medium text-foreground">
            {event.title}
          </span>
          <span className="text-xs text-muted-foreground">{timeLabel}</span>
          {event.rrule ? (
            <span className="text-xs text-muted-foreground">{rruleSummary(event.rrule)}</span>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {external ? (sourceLabel ?? "External calendar") : "Moduo"}
            {external ? " · read-only" : ""}
          </span>
          <div className="mt-1 flex items-center gap-1.5">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={onOpenDetail}>
              <ExternalLink aria-hidden />
              Open
            </Button>
            {!external && canEdit ? (
              <Button
                size="sm"
                variant="ghost"
                className="gap-1.5 text-destructive hover:bg-destructive/10"
                onClick={onDelete}
              >
                <Trash2 aria-hidden />
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
