// The Week/Day time grid. All vertical geometry rides `--cal-hour-h` (density-
// scaled) multiplied by REAL elapsed minutes from grid-layout.ts — DST days
// (23h/25h) render their own height and chip positions never drift; wall-clock
// inputs (working-hours prefs, "center on now") convert through
// wallClockToRealMinutes/minutesIntoDay first. Inline styles here are
// runtime-computed geometry only (sanctioned); every color and radius is
// token-routed.
//
// Two chip kinds render here (DESIGN_BRIEF §2): task blocks (the lens,
// muted/outline, checkbox) and events (calendar-colored; external = mirrored,
// read-only). CAL-2 adds the planning gestures: draw-to-create (ghost + quick
// popover), drag to move, edge resize — native events only; external chips
// resist with a read-only tooltip (no write path exists, structurally).
//
// Render economy: the 30s now-tick flows into the columns as ONE primitive
// (`nowMinutes` on today's column, null elsewhere) and DayColumn is memoized,
// so a tick re-renders today's column only — not the whole week.

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useDroppable } from "@dnd-kit/core";

import { Button } from "../../../components/ui/button";
import { cn } from "@/lib/utils";
import {
  chipSpanInDay,
  dayGeometry,
  layoutDayChips,
  minutesIntoDay,
  wallClockToRealMinutes,
  type DayGeometry,
} from "../grid-layout";
import { localDayKey, type CalendarView, type TaskBlock } from "../lens";
import type { EventChip } from "../events";
import type { CalendarPrefs } from "../prefs";
import { isElapsedBlock } from "../elapsed";
import { EventChipView } from "./event-chip";
import { EventQuickCreate, type QuickCreateDraft } from "./event-quick-create";
import { FocusReadout } from "./focus-readout";
import { TaskBlockChip } from "./task-block-chip";
import { formatHourLabel, formatTimeOfDay } from "./time-format";

const GUTTER_W = "3.25rem";
/** Chips shorter than this render the single-line compact layout. */
const COMPACT_BELOW_MINUTES = 40;
/** An elapsed block needs at least this rendered height for the inline triage
 * row (Later · Longer · Remove); shorter ones defer to the popover. */
const TRIAGE_MIN_MINUTES = 55;
/** Stable identities for empty columns so memoized DayColumns can bail out. */
const EMPTY_BLOCKS: TaskBlock[] = [];
const EMPTY_EVENTS: EventChip[] = [];
/** Pointer travel below this is a click, not a drag (px). */
const CLICK_SLOP_PX = 4;
/** Chip edge band that means "resize" instead of "move" (px). */
const RESIZE_EDGE_PX = 6;

export type MoveEventDeltas = { startDeltaMs: number; endDeltaMs: number };
export type MoveTaskResult = { startMs: number; durationMinutes: number };

/** A grid chip under a gesture — either kind shares the engine. */
type GestureTarget =
  | { type: "event"; chip: EventChip }
  | { type: "task"; block: TaskBlock };

type Props = {
  view: CalendarView;
  days: Date[];
  blocksByDay: Map<string, TaskBlock[]>;
  eventsByDay: Map<string, EventChip[]>;
  allDayByDay: Map<string, EventChip[]>;
  prefs: CalendarPrefs;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  canEdit: boolean;
  onToggleDone: (taskId: string) => void;
  onCreateEvent: (draft: QuickCreateDraft) => void;
  /** Occurrence-level drag/resize result — the page maps it onto the series. */
  onMoveEvent: (eventId: string, deltas: MoveEventDeltas) => void;
  /** Task-block drag/resize writes the task's schedule/duration (AC6). */
  onMoveTask: (taskId: string, result: MoveTaskResult) => void;
  onEventClick: (chip: EventChip, rect: DOMRect) => void;
  onTaskClick: (block: TaskBlock, rect: DOMRect) => void;
  selectedOccurrenceKey: string | null;
  onSelectOccurrence: (key: string | null) => void;
  /** Account id → bounded hue name for external-event attribution (CAL-6). */
  accountHues: Record<string, string>;
  // ── the loop (CAL-4) + focus (CAL-5) ──
  /** Tasks whose elapsed block was "took longer"-acknowledged this session. */
  workedTaskIds: ReadonlySet<string>;
  onTriageLater: (taskId: string) => void;
  onTriageLonger: (taskId: string) => void;
  onTriageRemove: (taskId: string) => void;
  /** The single focus session's task + readout clock (null when idle). */
  focusTaskId: string | null;
  focusRunningSinceMs: number | null;
  focusBaseSeconds: number;
};

/** Re-render tick for the now-line; catches up on tab wake. */
function useNowTick(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    const onWake = () => setNow(new Date());
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, [intervalMs]);
  return now;
}

/** CSS length for a minute offset: hour height × real hours. */
function y(minutes: number): string {
  return `calc(var(--cal-hour-h) * ${minutes / 60})`;
}

function snapMin(minutes: number, fine: boolean): number {
  const step = fine ? 5 : 15;
  return Math.round(minutes / step) * step;
}

type PendingCreate = { dayIdx: number; startMin: number; endMin: number };

type DragVisual = {
  dayIdx: number;
  startMin: number;
  endMin: number;
  title: string;
};

type Gesture =
  | {
      kind: "draw";
      dayIdx: number;
      anchorMin: number;
      moved: boolean;
    }
  | {
      kind: "move" | "resize-start" | "resize-end";
      target: GestureTarget;
      dayIdx: number;
      startMin: number;
      endMin: number;
      grabOffsetMin: number;
      moved: boolean;
      rect: DOMRect;
      /** Pointer-down position in px — the click-vs-drag slop reference. */
      downX: number;
      downY: number;
    };

type ColumnRect = { left: number; right: number; top: number; height: number };

export function CalendarGrid({
  view,
  days,
  blocksByDay,
  eventsByDay,
  allDayByDay,
  prefs,
  loading,
  error,
  onRetry,
  canEdit,
  onToggleDone,
  onCreateEvent,
  onMoveEvent,
  onMoveTask,
  onEventClick,
  onTaskClick,
  selectedOccurrenceKey,
  onSelectOccurrence,
  accountHues,
  workedTaskIds,
  onTriageLater,
  onTriageLonger,
  onTriageRemove,
  focusTaskId,
  focusRunningSinceMs,
  focusBaseSeconds,
}: Props) {
  const now = useNowTick(30_000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const geoms = useMemo(() => days.map(dayGeometry), [days]);
  const maxMinutes = useMemo(
    () => Math.max(...geoms.map((g) => g.totalMinutes)),
    [geoms],
  );
  // Gutter labels come from a full-height column so they align with its lines.
  // (Known cosmetic gap: on a DST week the 23h/25h column's own lines sit at
  // its real offsets, so the shared gutter reads an hour off for that one
  // column after the transition — the chips' own time labels stay truthful.)
  const refGeom = useMemo(
    () => geoms.find((g) => g.totalMinutes === maxMinutes) ?? geoms[0],
    [geoms, maxMinutes],
  );

  const todayKey = localDayKey(now);
  const hasAnyChips = useMemo(
    () =>
      [...blocksByDay.values()].some((l) => l.length > 0) ||
      [...eventsByDay.values()].some((l) => l.length > 0),
    [blocksByDay, eventsByDay],
  );
  const hasAllDay = useMemo(
    () => days.some((d) => (allDayByDay.get(localDayKey(d)) ?? []).length > 0),
    [days, allDayByDay],
  );

  const [pending, setPending] = useState<PendingCreate | null>(null);
  const [dragVisual, setDragVisual] = useState<DragVisual | null>(null);

  // ── the pointer gesture engine (draw / move / resize) ─────────────────────
  const gestureRef = useRef<Gesture | null>(null);
  const columnRectsRef = useRef<ColumnRect[]>([]);
  const geomsRef = useRef(geoms);
  geomsRef.current = geoms;
  const propsRef = useRef({
    canEdit,
    onCreateEvent,
    onMoveEvent,
    onMoveTask,
    onEventClick,
    onTaskClick,
    onSelectOccurrence,
  });
  propsRef.current = {
    canEdit,
    onCreateEvent,
    onMoveEvent,
    onMoveTask,
    onEventClick,
    onTaskClick,
    onSelectOccurrence,
  };

  const measureColumns = useCallback(() => {
    const root = gridRef.current;
    if (!root) return [];
    return [...root.querySelectorAll<HTMLElement>("[data-day-col]")].map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, height: r.height };
    });
  }, []);

  const pointToColumn = useCallback((clientX: number): number => {
    const rects = columnRectsRef.current;
    for (let i = 0; i < rects.length; i++) {
      if (clientX >= rects[i].left && clientX <= rects[i].right) return i;
    }
    // Off the edge → clamp to nearest.
    if (rects.length === 0) return 0;
    return clientX < rects[0].left ? 0 : rects.length - 1;
  }, []);

  const pointToMinutes = useCallback((clientY: number, dayIdx: number): number => {
    const rect = columnRectsRef.current[dayIdx];
    const geom = geomsRef.current[dayIdx];
    if (!rect || !geom) return 0;
    const frac = (clientY - rect.top) / rect.height;
    return Math.min(Math.max(frac * geom.totalMinutes, 0), geom.totalMinutes);
  }, []);

  const endGesture = useCallback(() => {
    gestureRef.current = null;
    setDragVisual(null);
    window.removeEventListener("pointermove", onWindowPointerMove);
    window.removeEventListener("pointerup", onWindowPointerUp);
    window.removeEventListener("pointercancel", onWindowPointerCancel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Touch/pen cancellation or OS interception: drop the gesture, commit nothing. */
  const onWindowPointerCancel = useCallback(() => {
    endGesture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWindowPointerMove = useCallback((e: PointerEvent) => {
    const g = gestureRef.current;
    if (!g) return;
    // Self-heal a lost pointerup (released outside the window/over an iframe).
    if (e.buttons === 0) {
      endGesture();
      return;
    }
    // Rects go stale if the user wheel-scrolls mid-drag — re-measure live
    // (7 getBoundingClientRect calls per move; cheap).
    columnRectsRef.current = measureColumns();
    const fine = e.altKey;
    if (g.kind === "draw") {
      const cur = snapMin(pointToMinutes(e.clientY, g.dayIdx), fine);
      const start = Math.min(g.anchorMin, cur);
      const end = Math.max(g.anchorMin, cur);
      if (Math.abs(cur - g.anchorMin) >= 5) g.moved = true;
      setDragVisual({
        dayIdx: g.dayIdx,
        startMin: start,
        endMin: Math.max(end, start + (g.moved ? 15 : 30)),
        title: "",
      });
      return;
    }
    // move / resize on an event chip — slop measured in px from pointer-down.
    g.moved =
      g.moved ||
      Math.hypot(e.clientX - g.downX, e.clientY - g.downY) > CLICK_SLOP_PX;
    const duration = g.endMin - g.startMin;
    const title = g.target.type === "event" ? g.target.chip.title : g.target.block.title;
    if (g.kind === "move") {
      const dayIdx = pointToColumn(e.clientX);
      const raw = pointToMinutes(e.clientY, dayIdx) - g.grabOffsetMin;
      const start = snapMin(
        Math.min(Math.max(raw, 0), geomsRef.current[dayIdx].totalMinutes - duration),
        fine,
      );
      setDragVisual({ dayIdx, startMin: start, endMin: start + duration, title });
    } else if (g.kind === "resize-end") {
      const cur = snapMin(pointToMinutes(e.clientY, g.dayIdx), fine);
      setDragVisual({
        dayIdx: g.dayIdx,
        startMin: g.startMin,
        endMin: Math.max(cur, g.startMin + 15),
        title,
      });
    } else {
      const cur = snapMin(pointToMinutes(e.clientY, g.dayIdx), fine);
      setDragVisual({
        dayIdx: g.dayIdx,
        startMin: Math.min(cur, g.endMin - 15),
        endMin: g.endMin,
        title,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onWindowPointerUp = useCallback((e: PointerEvent) => {
    const g = gestureRef.current;
    if (!g) {
      endGesture();
      return;
    }
    const p = propsRef.current;
    if (g.kind === "draw") {
      const fine = e.altKey;
      const cur = snapMin(pointToMinutes(e.clientY, g.dayIdx), fine);
      let startMin: number;
      let endMin: number;
      if (g.moved) {
        startMin = Math.min(g.anchorMin, cur);
        endMin = Math.max(Math.max(g.anchorMin, cur), startMin + 15);
      } else {
        // Plain click on empty grid = a 30-minute ghost (DESIGN_BRIEF §4).
        startMin = g.anchorMin;
        endMin = g.anchorMin + 30;
      }
      const total = geomsRef.current[g.dayIdx].totalMinutes;
      endMin = Math.min(endMin, total);
      startMin = Math.min(startMin, endMin - 15);
      setPending({ dayIdx: g.dayIdx, startMin, endMin });
    } else if (g.moved) {
      const v = dragVisualRef.current;
      if (v) {
        const geomFrom = geomsRef.current[g.dayIdx];
        const geomTo = geomsRef.current[v.dayIdx];
        if (g.target.type === "event") {
          const origStart = geomFrom.dayStartMs + g.startMin * 60_000;
          const origEnd = geomFrom.dayStartMs + g.endMin * 60_000;
          const nextStart = geomTo.dayStartMs + v.startMin * 60_000;
          const nextEnd = geomTo.dayStartMs + v.endMin * 60_000;
          p.onMoveEvent(g.target.chip.eventId, {
            startDeltaMs: nextStart - origStart,
            endDeltaMs: nextEnd - origEnd,
          });
        } else {
          // A MOVE keeps the task's stored duration — the rendered span is
          // day-clipped (a 23:00+2h block draws as 1h), so deriving duration
          // from the visual would silently truncate it. Only a RESIZE takes
          // the visual span (that's what the user is stating).
          p.onMoveTask(g.target.block.taskId, {
            startMs: geomTo.dayStartMs + v.startMin * 60_000,
            durationMinutes:
              g.kind === "move"
                ? g.target.block.durationMinutes
                : Math.max(Math.round(v.endMin - v.startMin), 15),
          });
        }
      }
    } else if (g.target.type === "event") {
      // No travel → a click: select + open the chip popover.
      p.onSelectOccurrence(g.target.chip.occurrenceKey);
      p.onEventClick(g.target.chip, g.rect);
    } else {
      p.onTaskClick(g.target.block, g.rect);
    }
    endGesture();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // dragVisual is set via state for rendering; the up-handler needs the
  // latest value without re-binding listeners.
  const dragVisualRef = useRef<DragVisual | null>(null);
  dragVisualRef.current = dragVisual;

  const beginGesture = useCallback(
    (g: Gesture) => {
      gestureRef.current = g;
      columnRectsRef.current = measureColumns();
      window.addEventListener("pointermove", onWindowPointerMove);
      window.addEventListener("pointerup", onWindowPointerUp);
      window.addEventListener("pointercancel", onWindowPointerCancel);
    },
    [measureColumns, onWindowPointerMove, onWindowPointerUp, onWindowPointerCancel],
  );

  /** Draw-to-create: pointer down on empty column space. */
  const onBackgroundPointerDown = useCallback(
    (e: React.PointerEvent, dayIdx: number) => {
      const p = propsRef.current;
      p.onSelectOccurrence(null);
      if (!p.canEdit || e.button !== 0) return;
      if ((e.target as HTMLElement).closest("[data-chip]")) return;
      e.preventDefault();
      columnRectsRef.current = measureColumns();
      const anchor = snapMin(pointToMinutes(e.clientY, dayIdx), e.altKey);
      beginGesture({ kind: "draw", dayIdx, anchorMin: anchor, moved: false });
      setPending(null);
    },
    [beginGesture, measureColumns, pointToMinutes],
  );

  /** Shared chip gesture start (events + task blocks). */
  const startChipGesture = useCallback(
    (
      e: React.PointerEvent,
      target: GestureTarget,
      dayIdx: number,
      span: { topMinutes: number; heightMinutes: number },
    ) => {
      e.preventDefault();
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      columnRectsRef.current = measureColumns();
      const offsetY = e.clientY - rect.top;
      const kind =
        offsetY <= RESIZE_EDGE_PX
          ? "resize-start"
          : offsetY >= rect.height - RESIZE_EDGE_PX
            ? "resize-end"
            : "move";
      const geom = geomsRef.current[dayIdx];
      const grabOffsetMin = (offsetY / rect.height) * span.heightMinutes;
      beginGesture({
        kind,
        target,
        dayIdx,
        startMin: span.topMinutes,
        endMin: Math.min(span.topMinutes + span.heightMinutes, geom.totalMinutes),
        grabOffsetMin,
        moved: false,
        rect,
        downX: e.clientX,
        downY: e.clientY,
      });
    },
    [beginGesture, measureColumns],
  );

  /** Move/resize (native events) or click-select (all events). */
  const onEventChipPointerDown = useCallback(
    (e: React.PointerEvent, chip: EventChip, dayIdx: number, span: { topMinutes: number; heightMinutes: number }) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const p = propsRef.current;
      if (!p.canEdit || chip.external) {
        // External chips resist edits (read-only tooltip on the chip); a
        // click still opens the popover/detail.
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        p.onSelectOccurrence(chip.occurrenceKey);
        p.onEventClick(chip, rect);
        return;
      }
      startChipGesture(e, { type: "event", chip }, dayIdx, span);
    },
    [startChipGesture],
  );

  /** Task blocks: drag writes schedule/duration; a checkbox press never drags. */
  const onTaskChipPointerDown = useCallback(
    (e: React.PointerEvent, block: TaskBlock, dayIdx: number, span: { topMinutes: number; heightMinutes: number }) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest("button")) return; // the checkbox
      e.stopPropagation();
      const p = propsRef.current;
      if (!p.canEdit || block.done) {
        // Done blocks sit serenely; a click still opens the popover.
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        p.onTaskClick(block, rect);
        return;
      }
      startChipGesture(e, { type: "task", block }, dayIdx, span);
    },
    [startChipGesture],
  );

  const commitCreate = useCallback(
    (draft: QuickCreateDraft) => {
      setPending(null);
      propsRef.current.onCreateEvent(draft);
    },
    [],
  );
  const cancelCreate = useCallback(() => setPending(null), []);
  /** The popover's time edits move the ghost — the chip is the consent gesture. */
  const adjustPendingTimes = useCallback((startMs: number, endMs: number) => {
    setPending((p) => {
      if (!p) return p;
      const geom = geomsRef.current[p.dayIdx];
      if (!geom) return p;
      const startMin = Math.max((startMs - geom.dayStartMs) / 60_000, 0);
      const endMin = Math.min((endMs - geom.dayStartMs) / 60_000, geom.totalMinutes);
      if (endMin <= startMin) return p;
      if (startMin === p.startMin && endMin === p.endMin) return p;
      return { ...p, startMin, endMin };
    });
  }, []);

  useEffect(() => () => endGesture(), [endGesture]);

  // On open: center around now (or 9:00 when today isn't visible), in REAL
  // minutes so DST days center correctly. Not re-run on prev/next navigation —
  // only on mount and Day↔Week switches.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const current = new Date();
    const todayVisible = days.some((d) => localDayKey(d) === todayKey);
    const targetMinutes = todayVisible
      ? (minutesIntoDay(current.getTime(), dayGeometry(current)) ?? 9 * 60)
      : 9 * 60;
    const pxPerMinute = scroller.scrollHeight / maxMinutes;
    scroller.scrollTop = Math.max(
      0,
      targetMinutes * pxPerMinute - scroller.clientHeight / 2,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const columns = `${GUTTER_W} repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {error ? (
        <div className="mb-2 flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span>Couldn't load your tasks — the grid may be incomplete.</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* day headers */}
      <div
        className="grid shrink-0 border-b border-border pb-1.5"
        style={{ gridTemplateColumns: columns }}
      >
        <div aria-hidden />
        {days.map((day) => {
          const isToday = localDayKey(day) === todayKey;
          return (
            <div
              key={localDayKey(day)}
              className={cn(
                "flex items-baseline gap-1.5 px-2 text-sm",
                isToday
                  ? "font-medium text-foreground"
                  : "text-muted-foreground",
              )}
            >
              <span>
                {day.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span className={cn(!isToday && "text-muted-foreground/70")}>
                {day.getDate()}
              </span>
            </div>
          );
        })}
      </div>

      {/* all-day lane — pinned above the hours, only when it has content */}
      {hasAllDay ? (
        <div
          className="grid shrink-0 border-b border-border py-1"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="pr-2 text-right text-2xs text-muted-foreground">all-day</div>
          {days.map((day) => {
            const key = localDayKey(day);
            const chips = allDayByDay.get(key) ?? EMPTY_EVENTS;
            return (
              <div key={key} className="flex min-w-0 flex-col gap-0.5 border-l border-border px-0.5">
                {chips.map((chip) => (
                  <button
                    key={chip.occurrenceKey}
                    type="button"
                    data-chip="event"
                    className="block w-full text-left"
                    style={{ height: "var(--ctrl-h-sm)" }}
                    onClick={(e) => {
                      onSelectOccurrence(chip.occurrenceKey);
                      onEventClick(chip, (e.currentTarget as HTMLElement).getBoundingClientRect());
                    }}
                  >
                    <EventChipView
                      title={chip.title}
                      startMs={chip.startMs}
                      endMs={chip.endMs}
                      compact
                      allDay
                      external={chip.external}
                      colorLabel={chip.sourceAccountId ? accountHues[chip.sourceAccountId] : undefined}
                      recurring={chip.recurring}
                      selected={selectedOccurrenceKey === chip.occurrenceKey}
                      past={false}
                    />
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* the hours grid */}
      <div ref={scrollRef} className="scrollbar-thin min-h-0 flex-1 overflow-y-auto">
        <div
          ref={gridRef}
          className="grid"
          style={{ gridTemplateColumns: columns, height: y(maxMinutes) }}
        >
          {/* hour gutter */}
          <div className="relative" aria-hidden>
            {refGeom.hourMarks.slice(1).map((mark, i) => (
              <span
                key={`${mark.minuteOfDay}-${i}`}
                className="absolute right-2 -translate-y-1/2 text-2xs text-muted-foreground"
                style={{ top: y(mark.minuteOfDay) }}
              >
                {formatHourLabel(mark.hour)}
              </span>
            ))}
          </div>

          {days.map((day, i) => {
            const key = localDayKey(day);
            const isToday = key === todayKey;
            const colSelected = selectedOccurrenceKey;
            const events = eventsByDay.get(key) ?? EMPTY_EVENTS;
            return (
              <DayColumn
                key={key}
                dayIdx={i}
                dayKey={key}
                geom={geoms[i]}
                blocks={blocksByDay.get(key) ?? EMPTY_BLOCKS}
                events={events}
                accountHues={accountHues}
                prefs={prefs}
                nowMinutes={
                  isToday ? minutesIntoDay(now.getTime(), geoms[i]) : null
                }
                // Elapsed detection needs an absolute `now`: the live tick on
                // today (re-renders that column per tick), a stable day-past
                // flag elsewhere (past columns are all-elapsed, future none).
                tickNowMs={isToday ? now.getTime() : null}
                dayEndPast={geoms[i].dayEndMs <= now.getTime()}
                workedTaskIds={workedTaskIds}
                onTriageLater={onTriageLater}
                onTriageLonger={onTriageLonger}
                onTriageRemove={onTriageRemove}
                focusTaskId={focusTaskId}
                focusRunningSinceMs={focusRunningSinceMs}
                focusBaseSeconds={focusBaseSeconds}
                canEdit={canEdit}
                onToggleDone={onToggleDone}
                onBackgroundPointerDown={onBackgroundPointerDown}
                onEventChipPointerDown={onEventChipPointerDown}
                onTaskChipPointerDown={onTaskChipPointerDown}
                selectedKey={
                  colSelected && events.some((c) => c.occurrenceKey === colSelected)
                    ? colSelected
                    : null
                }
                pending={pending?.dayIdx === i ? pending : null}
                onCommitCreate={commitCreate}
                onCancelCreate={cancelCreate}
                onAdjustPendingTimes={adjustPendingTimes}
                dragVisual={dragVisual?.dayIdx === i ? dragVisual : null}
                showLoadingChips={loading && !hasAnyChips && i < 2}
                emptyHint={
                  isToday && !loading && !error && !hasAnyChips && !pending
                    ? "Nothing scheduled — draw a block or schedule a task."
                    : null
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const DayColumn = memo(function DayColumn({
  dayIdx,
  dayKey,
  geom,
  blocks,
  events,
  accountHues,
  prefs,
  nowMinutes,
  tickNowMs,
  dayEndPast,
  workedTaskIds,
  onTriageLater,
  onTriageLonger,
  onTriageRemove,
  focusTaskId,
  focusRunningSinceMs,
  focusBaseSeconds,
  canEdit,
  onToggleDone,
  onBackgroundPointerDown,
  onEventChipPointerDown,
  onTaskChipPointerDown,
  selectedKey,
  pending,
  onCommitCreate,
  onCancelCreate,
  onAdjustPendingTimes,
  dragVisual,
  showLoadingChips,
  emptyHint,
}: {
  dayIdx: number;
  dayKey: string;
  geom: DayGeometry;
  blocks: TaskBlock[];
  events: EventChip[];
  accountHues: Record<string, string>;
  prefs: CalendarPrefs;
  /** Real minutes into this day for the now-line; null off-today. */
  nowMinutes: number | null;
  /** Absolute tick `now` for today's column; null elsewhere. */
  tickNowMs: number | null;
  /** True when this whole day is behind now (past columns are all-elapsed). */
  dayEndPast: boolean;
  workedTaskIds: ReadonlySet<string>;
  onTriageLater: (taskId: string) => void;
  onTriageLonger: (taskId: string) => void;
  onTriageRemove: (taskId: string) => void;
  focusTaskId: string | null;
  focusRunningSinceMs: number | null;
  focusBaseSeconds: number;
  canEdit: boolean;
  onToggleDone: (taskId: string) => void;
  onBackgroundPointerDown: (e: React.PointerEvent, dayIdx: number) => void;
  onEventChipPointerDown: (
    e: React.PointerEvent,
    chip: EventChip,
    dayIdx: number,
    span: { topMinutes: number; heightMinutes: number },
  ) => void;
  onTaskChipPointerDown: (
    e: React.PointerEvent,
    block: TaskBlock,
    dayIdx: number,
    span: { topMinutes: number; heightMinutes: number },
  ) => void;
  selectedKey: string | null;
  pending: PendingCreate | null;
  onCommitCreate: (draft: QuickCreateDraft) => void;
  onCancelCreate: () => void;
  onAdjustPendingTimes: (startMs: number, endMs: number) => void;
  dragVisual: DragVisual | null;
  showLoadingChips: boolean;
  emptyHint: string | null;
}) {
  // Drop target for the panel's task rows (the universal drag contract):
  // the page's DndContext resolves which column the pointer is over; the
  // drop handler converts the pointer's y into the slot.
  const { setNodeRef: setDropRef, isOver: isDropOver } = useDroppable({
    id: `cal-day:${dayKey}`,
    data: { dayKey, dayIdx },
    disabled: !canEdit,
  });
  // Task blocks and events overlap freely and share the cluster layout.
  const layout = useMemo(
    () =>
      layoutDayChips([
        ...blocks.map((b) => ({ id: b.taskId, startMs: b.startMs, endMs: b.endMs })),
        ...events.map((c) => ({ id: c.occurrenceKey, startMs: c.startMs, endMs: c.endMs })),
      ]),
    [blocks, events],
  );
  const blockById = useMemo(
    () => new Map(blocks.map((b) => [b.taskId, b])),
    [blocks],
  );
  const eventByKey = useMemo(
    () => new Map(events.map((c) => [c.occurrenceKey, c])),
    [events],
  );
  // Wall-clock prefs → real minutes (DST-correct wash bounds).
  const washTop = wallClockToRealMinutes(prefs.workStartMinute, geom);
  const washBottom = wallClockToRealMinutes(prefs.workEndMinute, geom);
  // Absolute "now" for elapsed detection + event past-styling: the live tick on
  // today, else the day-past flag collapses to +∞ (a fully-past day → EVERY open
  // block/event on it is elapsed/past, incl. midnight-spanners whose end sits in
  // the next day) or the day start (a future day → none), so those columns skip
  // the 30s tick.
  const nowMs = tickNowMs ?? (dayEndPast ? Number.POSITIVE_INFINITY : geom.dayStartMs);

  return (
    <div
      ref={setDropRef}
      data-day-col
      data-day-key={dayKey}
      className={cn(
        "relative border-l border-border",
        isDropOver && "bg-accent/20",
      )}
      style={{ height: y(geom.totalMinutes) }}
      onPointerDown={(e) => onBackgroundPointerDown(e, dayIdx)}
    >
      {/* off-hours wash (the invisible working-hours bound, §10) */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 bg-muted/40"
        style={{ height: y(Math.min(washTop, geom.totalMinutes)) }}
      />
      {washBottom < geom.totalMinutes ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 bg-muted/40"
          style={{ height: y(geom.totalMinutes - washBottom) }}
        />
      ) : null}

      {/* hour lines */}
      {geom.hourMarks.slice(1).map((mark, i) => (
        <div
          key={`${mark.minuteOfDay}-${i}`}
          aria-hidden
          className="absolute inset-x-0 border-t border-border"
          style={{ top: y(mark.minuteOfDay) }}
        />
      ))}

      {/* chips (both kinds, one cluster space) */}
      {layout.placed.map((p) => {
        const block = blockById.get(p.id);
        if (block) {
          const span = chipSpanInDay(block.startMs, block.endMs, geom);
          if (!span) return null;
          const elapsed = isElapsedBlock(block, nowMs);
          const worked = workedTaskIds.has(block.taskId);
          const focusing = focusTaskId === block.taskId;
          const awaitingTriage = elapsed && !block.done && !worked;
          return (
            <div
              key={p.id}
              data-chip="task"
              className={cn(
                "absolute z-[1] pl-px pr-0.5",
                canEdit && !block.done && "cursor-grab",
              )}
              style={{
                top: y(span.topMinutes),
                height: `max(${y(span.heightMinutes)}, 1.375rem)`,
                left: `${(p.col / p.cols) * 100}%`,
                width: `${100 / p.cols}%`,
              }}
              onPointerDown={(e) => onTaskChipPointerDown(e, block, dayIdx, span)}
            >
              <TaskBlockChip
                title={block.title}
                startMs={block.startMs}
                endMs={block.endMs}
                done={block.done}
                compact={span.heightMinutes < COMPACT_BELOW_MINUTES}
                canEdit={canEdit}
                onToggleDone={() => onToggleDone(block.taskId)}
                elapsed={elapsed}
                worked={worked}
                showTriage={awaitingTriage && span.heightMinutes >= TRIAGE_MIN_MINUTES}
                onLater={() => onTriageLater(block.taskId)}
                onLonger={() => onTriageLonger(block.taskId)}
                onRemove={() => onTriageRemove(block.taskId)}
                focusing={focusing}
                focusReadout={
                  focusing ? (
                    <FocusReadout
                      runningSinceMs={focusRunningSinceMs}
                      baseSeconds={focusBaseSeconds}
                    />
                  ) : null
                }
              />
            </div>
          );
        }
        const chip = eventByKey.get(p.id);
        if (!chip) return null;
        const span = chipSpanInDay(chip.startMs, chip.endMs, geom);
        if (!span) return null;
        return (
          <div
            key={p.id}
            data-chip="event"
            className={cn(
              "absolute z-[1] pl-px pr-0.5",
              canEdit && !chip.external && "cursor-grab",
            )}
            style={{
              top: y(span.topMinutes),
              height: `max(${y(span.heightMinutes)}, 1.375rem)`,
              left: `${(p.col / p.cols) * 100}%`,
              width: `${100 / p.cols}%`,
            }}
            onPointerDown={(e) => onEventChipPointerDown(e, chip, dayIdx, span)}
          >
            <EventChipView
              title={chip.title}
              startMs={chip.startMs}
              endMs={chip.endMs}
              compact={span.heightMinutes < COMPACT_BELOW_MINUTES}
              external={chip.external}
              colorLabel={chip.sourceAccountId ? accountHues[chip.sourceAccountId] : undefined}
              recurring={chip.recurring}
              selected={selectedKey === chip.occurrenceKey}
              past={chip.endMs < nowMs}
            />
          </div>
        );
      })}

      {/* "+N" overflow (popover list arrives with the chip popover, CAL-2) */}
      {layout.overflow.map((o, i) => {
        const span = chipSpanInDay(o.startMs, o.endMs, geom);
        if (!span) return null;
        const titles = o.ids
          .map((id) => blockById.get(id)?.title ?? eventByKey.get(id)?.title)
          .filter(Boolean)
          .join(", ");
        return (
          <div
            key={`overflow-${i}`}
            title={titles}
            className="absolute right-0.5 z-[2] rounded-md border border-border bg-popover px-1 text-2xs text-muted-foreground"
            style={{ top: y(span.topMinutes) }}
          >
            +{o.ids.length}
          </div>
        );
      })}

      {/* the draw ghost (before release) / drag-move preview */}
      {dragVisual ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0.5 z-[4] rounded-md border border-primary/50 bg-primary/15 px-1.5 py-0.5"
          style={{
            top: y(dragVisual.startMin),
            height: `max(${y(dragVisual.endMin - dragVisual.startMin)}, 1.125rem)`,
          }}
        >
          <span className="text-2xs text-muted-foreground">
            {dragVisual.title ? `${dragVisual.title} · ` : ""}
            {formatTimeOfDay(geom.dayStartMs + dragVisual.startMin * 60_000)} –{" "}
            {formatTimeOfDay(geom.dayStartMs + dragVisual.endMin * 60_000)}
          </span>
        </div>
      ) : null}

      {/* the materialized ghost: inline title + quick-create popover */}
      {pending ? (
        <div
          className="absolute inset-x-0.5 z-[5]"
          style={{
            top: y(pending.startMin),
            height: `max(${y(pending.endMin - pending.startMin)}, 1.375rem)`,
          }}
        >
          <EventQuickCreate
            startMs={geom.dayStartMs + pending.startMin * 60_000}
            endMs={geom.dayStartMs + pending.endMin * 60_000}
            onCommit={onCommitCreate}
            onCancel={onCancelCreate}
            onTimesChange={onAdjustPendingTimes}
          />
        </div>
      ) : null}

      {/* loading shimmer */}
      {showLoadingChips ? (
        <>
          <div
            aria-hidden
            className="absolute inset-x-1 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
            style={{ top: y(9 * 60), height: y(60) }}
          />
          <div
            aria-hidden
            className="absolute inset-x-1 animate-pulse rounded-md bg-muted motion-reduce:animate-none"
            style={{ top: y(13 * 60), height: y(90) }}
          />
        </>
      ) : null}

      {/* now line — today's column only */}
      {nowMinutes != null ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-[3]"
          style={{ top: y(nowMinutes) }}
        >
          <div className="relative h-px bg-primary">
            <div className="absolute -left-1 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-primary" />
          </div>
        </div>
      ) : null}

      {/* quiet empty hint (spec §9) */}
      {emptyHint ? (
        <div className="pointer-events-none absolute inset-x-2 top-1/3 z-[1] text-center text-xs text-muted-foreground">
          {emptyHint}
        </div>
      ) : null}
    </div>
  );
});
