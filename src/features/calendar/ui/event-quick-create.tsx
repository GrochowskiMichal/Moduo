// Draw-to-create's second half (DESIGN_BRIEF §7a): the released ghost
// materializes into this chip — inline title input inside the chip + a quick
// popover beneath (time range · all-day · calendar · repeat). Enter saves,
// Esc discards, empty title + click-away discards (no untitled litter).

import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Popover, PopoverAnchor, PopoverContent } from "../../../components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select";
import { Switch } from "../../../components/ui/switch";
import { RepeatPicker } from "./repeat-picker";
import { formatTimeOfDay } from "./time-format";

export type QuickCreateDraft = {
  title: string;
  startsAt: string;
  endsAt: string;
  allDay: boolean;
  rrule: string | null;
};

type Props = {
  /** The drawn span as real instants (already snapped by the grid). */
  startMs: number;
  endMs: number;
  onCommit: (draft: QuickCreateDraft) => void;
  onCancel: () => void;
  /** Time edits in the popover move the ghost chip (the consent gesture). */
  onTimesChange?: (startMs: number, endMs: number) => void;
};

function toTimeInput(ms: number): string {
  const d = new Date(ms);
  return `${`${d.getHours()}`.padStart(2, "0")}:${`${d.getMinutes()}`.padStart(2, "0")}`;
}

/** Same local calendar day as `anchorMs`, at the wall-clock time "HH:mm". */
function atWallClock(anchorMs: number, time: string): Date {
  const d = new Date(anchorMs);
  const [h, m] = time.split(":").map(Number);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0);
}

export function EventQuickCreate({ startMs, endMs, onCommit, onCancel, onTimesChange }: Props) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState(() => toTimeInput(startMs));
  const [endTime, setEndTime] = useState(() => toTimeInput(endMs));
  const [allDay, setAllDay] = useState(false);
  const [rrule, setRrule] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Guards double-firing when several dismiss paths run for one gesture. */
  const settledRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const times = useMemo(() => {
    if (allDay) {
      const day = new Date(startMs);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
      return { start, end };
    }
    const start = atWallClock(startMs, startTime);
    let end = atWallClock(startMs, endTime);
    if (end.getTime() <= start.getTime()) end = new Date(start.getTime() + 15 * 60_000);
    return { start, end };
  }, [allDay, startMs, startTime, endTime]);

  // The moved ghost chip is what the user consents to — keep it in sync with
  // time-input / NL-"at 9" edits. Reported only when actually different.
  const lastReportedRef = useRef<{ s: number; e: number } | null>(null);
  useEffect(() => {
    if (allDay) return; // the ghost stays at the drawn slot; the lane takes over on save
    const s = times.start.getTime();
    const e = times.end.getTime();
    const last = lastReportedRef.current;
    if (last && last.s === s && last.e === e) return;
    lastReportedRef.current = { s, e };
    if (s !== startMs || e !== endMs) onTimesChange?.(s, e);
  }, [times, allDay, startMs, endMs, onTimesChange]);

  const cancel = () => {
    if (settledRef.current) return;
    settledRef.current = true;
    onCancel();
  };

  const commit = () => {
    if (settledRef.current) return;
    const trimmed = title.trim();
    if (!trimmed) {
      cancel(); // empty title discards — no untitled events (AC3)
      return;
    }
    settledRef.current = true;
    onCommit({
      title: trimmed,
      startsAt: times.start.toISOString(),
      endsAt: times.end.toISOString(),
      allDay,
      rrule,
    });
  };

  return (
    <Popover
      open
      onOpenChange={(open) => {
        // Fallback dismiss path — Esc and outside-click are handled explicitly
        // on the content below; anything else discards (never a silent save).
        if (!open) cancel();
      }}
    >
      <PopoverAnchor asChild>
        <div
          data-chip="ghost"
          className="flex h-full w-full items-start overflow-hidden rounded-md border border-primary/50 bg-primary/15 px-1.5 py-0.5"
        >
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title"
            aria-label="Event title"
            className="w-full min-w-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                cancel();
              }
            }}
          />
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        side="bottom"
        sideOffset={6}
        className="w-72 p-3"
        onOpenAutoFocus={(e) => e.preventDefault()}
        // Esc DISCARDS. preventDefault stops Radix's dismiss (whose
        // onOpenChange path would otherwise race this handler).
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          cancel();
        }}
        // Click-away with a typed title is a deliberate save (§7a: only
        // "typing nothing and clicking away" discards).
        onPointerDownOutside={() => {
          if (title.trim()) commit();
          else cancel();
        }}
      >
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            {allDay ? (
              <span className="flex-1 text-sm text-muted-foreground">
                All day ·{" "}
                {new Date(startMs).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}
              </span>
            ) : (
              <>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => e.target.value && setStartTime(e.target.value)}
                  aria-label="Start time"
                  className="flex-1"
                  style={{ height: "var(--ctrl-h-sm)" }}
                />
                <span className="text-xs text-muted-foreground">–</span>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => e.target.value && setEndTime(e.target.value)}
                  aria-label="End time"
                  className="flex-1"
                  style={{ height: "var(--ctrl-h-sm)" }}
                />
              </>
            )}
          </div>

          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="qc-all-day" className="text-sm text-muted-foreground">
              All day
            </Label>
            <Switch id="qc-all-day" checked={allDay} onCheckedChange={setAllDay} />
          </div>

          {/* Moduo-only in v1 — the picker seeds the v2 default-target seat. */}
          <Select value="moduo" disabled>
            <SelectTrigger className="w-full" aria-label="Calendar">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="moduo">Moduo</SelectItem>
            </SelectContent>
          </Select>

          <RepeatPicker
            value={rrule}
            onChange={(next, timeOfDay) => {
              setRrule(next);
              if (timeOfDay && !allDay) {
                // "…at 9" re-anchors the start; the drawn duration is kept.
                const durMin = Math.max(
                  Math.round((times.end.getTime() - times.start.getTime()) / 60_000),
                  15,
                );
                const h = `${timeOfDay.hour}`.padStart(2, "0");
                const m = `${timeOfDay.minute}`.padStart(2, "0");
                setStartTime(`${h}:${m}`);
                const endTotal = timeOfDay.hour * 60 + timeOfDay.minute + durMin;
                setEndTime(
                  `${`${Math.floor((endTotal % 1440) / 60)}`.padStart(2, "0")}:${`${endTotal % 60}`.padStart(2, "0")}`,
                );
              }
            }}
          />

          <span className="text-2xs text-muted-foreground">
            {allDay
              ? "Enter saves · Esc discards"
              : `${formatTimeOfDay(times.start.getTime())} – ${formatTimeOfDay(times.end.getTime())} · Enter saves · Esc discards`}
          </span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
