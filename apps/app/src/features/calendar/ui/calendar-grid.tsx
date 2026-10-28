// The Week/Day time grid. All vertical geometry rides `--cal-hour-h` (density-
// scaled) multiplied by WALL-CLOCK minutes from grid-layout.ts: every day has
// 24 rows and every label sits on the hour it names, also in a week with a
// clock change (CALR-1); pointer → time goes through `instantAtWallMinute`.
// Inline styles here are runtime-computed geometry and stacking only
// (sanctioned); every color and radius is token-routed.
//
// Two chip kinds render here (DESIGN_BRIEF §2): task blocks (the lens,
// muted/outline, checkbox) and events (calendar-colored; external = mirrored).
// CAL-2 adds the planning gestures: draw-to-create (ghost + quick popover),
// drag to move, edge resize — on events you can write (native ones, and since
// CALR-8 your own Google ones, which save to Google first); read-only chips
// (view-only accounts, teammates') resist with a read-only tooltip.
//
// Render economy: the 30s now-tick flows into the columns as ONE primitive
// (`nowMinutes` on today's column, null elsewhere) and DayColumn is memoized,
// so a tick re-renders today's column only — not the whole week.

import { useDroppable } from "@dnd-kit/core";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { cn } from "@/lib/utils";

import { Button } from "../../../components/ui/button";
import { isElapsedBlock } from "../elapsed";
import { type EventChip, eventHue } from "../events";
import type { GridCursor } from "../grid-keys";
import {
  chipSpanInDay,
  DAY_COLUMNS,
  type DayGeometry,
  dayGeometry,
  GRID_LAYER,
  instantAtWallMinute,
  layoutDayChips,
  minutesIntoDay,
  openingScrollMinute,
  wallMinuteOf,
  WEEK_COLUMNS,
} from "../grid-layout";
import { type CalendarView, type DueChip, localDayKey, type TaskBlock } from "../lens";
import { type CalendarPrefs, offHoursWash } from "../prefs";
import { emptyWeekHint } from "../sync-status";
import { dayZoneNote, useSecondZone } from "../zones";
import { AllDayLane } from "./allday-lane";
import { AllDayLaneSkeleton } from "./calendar-skeleton";
import { ComposerGhost } from "./composer-ghost";
import { DayHeader, ZoneCorner } from "./day-header";
import { COMPACT_BELOW_MINUTES } from "./event-chip";
import {
  EventQuickCreate,
  type QuickCreateCalendar,
  type QuickCreateDraft,
} from "./event-quick-create";
import { FocusReadout } from "./focus-readout";
import { type GestureTarget, GridEventCard, OverflowList, shownMinutes } from "./grid-cards";
import { GridCursorMark } from "./grid-cursor";
import { gridY, useNowTick } from "./grid-units";
import { NowLine } from "./now-line";
import { TaskBlockChip } from "./task-block-chip";
import { formatHourLabel, formatTimeOfDay } from "./time-format";
import { SecondZoneHours, ZONE_GUTTER_W } from "./zone-gutter";

const GUTTER_W = "3.25rem";
/** An elapsed block needs at least this rendered height for the inline triage
 * row (Later · Longer · Remove); shorter ones defer to the popover. */
const TRIAGE_MIN_MINUTES = 55;
/** Stable identities for empty columns so memoized DayColumns can bail out. */
const EMPTY_BLOCKS: TaskBlock[] = [];
const EMPTY_EVENTS: EventChip[] = [];
const EMPTY_DUE: DueChip[] = [];
const NO_DUE = new Map<string, DueChip[]>();
/** Pointer travel below this is a click, not a drag (px). */
const CLICK_SLOP_PX = 4;
/** Chip edge band that means "resize" instead of "move" (px). */
const RESIZE_EDGE_PX = 6;

export type MoveEventDeltas = { startDeltaMs: number; endDeltaMs: number };
export type MoveTaskResult = { startMs: number; durationMinutes: number };

export type CalendarGridProps = {
  view: CalendarView;
  days: Date[];
  blocksByDay: Map<string, TaskBlock[]>;
  eventsByDay: Map<string, EventChip[]>;
  allDayByDay: Map<string, EventChip[]>;
  /** Due-only tasks per day, in the all-day lane (TV-F6, AC2.3/AC7.3). */
  dueByDay?: Map<string, DueChip[]>;
  /** A task in a day header's due list was picked: open it. */
  onDueClick?: (taskId: string) => void;
  /** Schedule (S) in a day header's due list: put the task on that day. */
  onScheduleDue?: (taskId: string, day: Date) => void;
  /** Task id → its finished files (AT-3's 📎 mark on blocks and due chips). */
  fileCounts?: ReadonlyMap<string, number>;
  prefs: CalendarPrefs;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  canEdit: boolean;
  onToggleDone: (taskId: string) => void;
  onCreateEvent: (draft: QuickCreateDraft) => void;
  /** Moduo plus each connected calendar the new event can land on. */
  createCalendars: QuickCreateCalendar[];
  /** Occurrence-level drag/resize result — the page maps it onto the series. */
  onMoveEvent: (
    eventId: string,
    deltas: MoveEventDeltas,
    /** The occurrence's span before the move (a repeat asks This event / All events). */
    occurrence?: { startMs: number; endMs: number },
  ) => void;
  /** Task-block drag/resize writes the task's schedule/duration (AC6); a
   *  block from a work session moves that session (`sessionId`). */
  onMoveTask: (taskId: string, result: MoveTaskResult, sessionId: string | null) => void;
  onEventClick: (chip: EventChip, rect: DOMRect) => void;
  onTaskClick: (block: TaskBlock, rect: DOMRect) => void;
  selectedOccurrenceKey: string | null;
  onSelectOccurrence: (key: string | null) => void;
  /** Account id → bounded hue name for external-event attribution (CAL-6). */
  accountHues: Record<string, string>;
  // ── the loop (CAL-4) + focus (CAL-5) ──
  /** Tasks whose elapsed block was "took longer"-acknowledged this session. */
  workedTaskIds: ReadonlySet<string>;
  /** A block of a work session acts on that session (`sessionId`). */
  onTriageLater: (taskId: string, sessionId?: string | null) => void;
  onTriageLonger: (taskId: string) => void;
  onTriageRemove: (taskId: string, sessionId?: string | null) => void;
  /** The block the focus session shows on (the one time engine; null when idle). */
  focusBlockId: string | null;
  // ── faults and loading (CALR-3) ──
  /** Accounts that didn't sync: their events carry the sync mark. */
  staleAccountIds?: ReadonlySet<string>;
  /** Events whose change waits to sync: the cloud-off mark. */
  waitingEventIds?: ReadonlySet<string>;
  /** Something failed (a sync, the read) or the first-week card speaks: no empty hint. */
  faulted?: boolean;
  /** While loading, the all-day rows the lane last drew (its skeleton). */
  loadingAllDayRows?: number;
  /** Laid low over the hours, not scrolling with them (the first-week card). */
  overlay?: ReactNode;
  /** Day view's prep beside each meeting (CALR-12); absent in Week. */
  prepFor?: (chip: EventChip) => ReactNode;
  /** The keyboard cursor (CALR-4); ⌘N and ↵ open a new event there. */
  cursor?: GridCursor | null;
  /** Laid over the hours, scrolling with them (placing a task, CALR-5). */
  gridLayer?: ReactNode;
};

const NO_IDS: ReadonlySet<string> = new Set();

const y = gridY;

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
  dueByDay = NO_DUE,
  onDueClick,
  onScheduleDue,
  fileCounts,
  prefs,
  loading,
  error,
  onRetry,
  canEdit,
  onToggleDone,
  onCreateEvent,
  createCalendars,
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
  focusBlockId,
  staleAccountIds = NO_IDS,
  waitingEventIds = NO_IDS,
  faulted = false,
  loadingAllDayRows = 0,
  overlay = null,
  prepFor,
  cursor = null,
  gridLayer = null,
}: CalendarGridProps) {
  const now = useNowTick(30_000);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const geoms = useMemo(() => days.map(dayGeometry), [days]);
  // Every column is the same 24 wall-clock hours, so one gutter fits them all.
  const maxMinutes = geoms[0]?.totalMinutes ?? 24 * 60;
  const hourMarks = geoms[0]?.hourMarks ?? [];
  const maxCols = view === "day" ? DAY_COLUMNS : WEEK_COLUMNS;

  const todayKey = localDayKey(now);
  const hasAnyChips = useMemo(
    () =>
      [...blocksByDay.values()].some((l) => l.length > 0) ||
      [...eventsByDay.values()].some((l) => l.length > 0),
    [blocksByDay, eventsByDay],
  );
  const hasAllDay = useMemo(
    () =>
      days.some((d) => {
        return (allDayByDay.get(localDayKey(d)) ?? []).length > 0;
      }),
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
    g.moved = g.moved || Math.hypot(e.clientX - g.downX, e.clientY - g.downY) > CLICK_SLOP_PX;
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
          const origStart = instantAtWallMinute(g.startMin, geomFrom);
          const origEnd = instantAtWallMinute(g.endMin, geomFrom);
          const nextStart = instantAtWallMinute(v.startMin, geomTo);
          const nextEnd = instantAtWallMinute(v.endMin, geomTo);
          const { chip } = g.target;
          p.onMoveEvent(
            chip.eventId,
            { startDeltaMs: nextStart - origStart, endDeltaMs: nextEnd - origEnd },
            { startMs: chip.startMs, endMs: chip.endMs },
          );
        } else {
          // A MOVE keeps the task's stored duration — the rendered span is
          // day-clipped (a 23:00+2h block draws as 1h), so deriving duration
          // from the visual would silently truncate it. Only a RESIZE takes
          // the visual span (that's what the user is stating).
          p.onMoveTask(
            g.target.block.taskId,
            {
              startMs: instantAtWallMinute(v.startMin, geomTo),
              durationMinutes:
                g.kind === "move"
                  ? g.target.block.durationMinutes
                  : Math.max(Math.round(v.endMin - v.startMin), 15),
            },
            g.target.block.sessionId,
          );
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
      let kind: "move" | "resize-start" | "resize-end" =
        offsetY <= RESIZE_EDGE_PX
          ? "resize-start"
          : offsetY >= rect.height - RESIZE_EDGE_PX
            ? "resize-end"
            : "move";
      // An overnight piece's cut edge at midnight isn't the event's edge:
      // grabbing it moves the event instead of resizing it.
      if (
        target.type === "event" &&
        ((kind === "resize-start" && target.chip.continuesFromMs != null) ||
          (kind === "resize-end" && target.chip.continuesToMs != null))
      ) {
        kind = "move";
      }
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

  /** Move/resize (writable events) or click-select (all events). */
  const onEventChipPointerDown = useCallback(
    (
      e: React.PointerEvent,
      chip: EventChip,
      dayIdx: number,
      span: { topMinutes: number; heightMinutes: number },
    ) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      const p = propsRef.current;
      if (!p.canEdit || chip.readOnly) {
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
    (
      e: React.PointerEvent,
      block: TaskBlock,
      dayIdx: number,
      span: { topMinutes: number; heightMinutes: number },
    ) => {
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

  /** A row in a "+N" list: open it as a click on its chip would. */
  const onOverflowPick = useCallback((target: GestureTarget, rect: DOMRect) => {
    const p = propsRef.current;
    if (target.type === "event") {
      p.onSelectOccurrence(target.chip.occurrenceKey);
      p.onEventClick(target.chip, rect);
    } else {
      p.onTaskClick(target.block, rect);
    }
  }, []);

  const commitCreate = useCallback((draft: QuickCreateDraft) => {
    setPending(null);
    propsRef.current.onCreateEvent(draft);
  }, []);
  const cancelCreate = useCallback(() => setPending(null), []);
  /** The popover's time edits move the ghost — the chip is the consent gesture. */
  const adjustPendingTimes = useCallback((startMs: number, endMs: number) => {
    setPending((p) => {
      if (!p) return p;
      const geom = geomsRef.current[p.dayIdx];
      if (!geom) return p;
      const startMin = wallMinuteOf(startMs, geom);
      const endMin = wallMinuteOf(endMs, geom);
      if (endMin <= startMin) return p;
      if (startMin === p.startMin && endMin === p.endMin) return p;
      return { ...p, startMin, endMin };
    });
  }, []);

  useEffect(() => () => endGesture(), [endGesture]);

  // ⌘N, N, the + button and ↵ on an empty slot open the composer (CALR-9,
  // `calendar-composer.tsx`); its draft draws in each column (`ComposerGhost`).

  // On open: the working day at the top, with now in view when today is
  // visible (AC5). Not re-run on prev/next navigation — only on mount and
  // Day↔Week switches.
  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || scroller.scrollHeight === 0) return;
    const current = new Date();
    const todayVisible = days.some((d) => localDayKey(d) === todayKey);
    const pxPerMinute = scroller.scrollHeight / maxMinutes;
    const top = openingScrollMinute({
      workStartMinute: prefs.workStartMinute,
      workEndMinute: prefs.workEndMinute,
      nowMinute: todayVisible ? minutesIntoDay(current.getTime(), dayGeometry(current)) : null,
      viewportMinutes: scroller.clientHeight / pxPerMinute,
    });
    scroller.scrollTop = top * pxPerMinute;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  // CALR-13: Z widens the gutter for the second zone's hours.
  const zone = useSecondZone();
  const second = zone.shown ? zone.zone : null;
  const refDay = days.find((d) => localDayKey(d) === todayKey) ?? days[0];
  const columns = `${second ? ZONE_GUTTER_W : GUTTER_W} repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {error ? (
        <div className="mb-2 flex shrink-0 items-center gap-2 text-sm text-muted-foreground">
          <span>Couldn't load your tasks — the grid may be incomplete.</span>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : null}

      {/* day headers: the zone in the corner above the hours, then each day */}
      <div
        className="grid shrink-0 border-b border-border"
        style={{ gridTemplateColumns: columns }}
      >
        {/* The zone now when today is on show, else at noon of the first day
            (midnight of a clock-change Sunday still reads summer time). */}
        <ZoneCorner
          at={
            days.some((d) => localDayKey(d) === todayKey) || !days[0]
              ? now
              : new Date(days[0].getFullYear(), days[0].getMonth(), days[0].getDate(), 12)
          }
        />
        {days.map((day, i) => {
          const key = localDayKey(day);
          return (
            <DayHeader
              key={key}
              day={day}
              today={key === todayKey}
              past={geoms[i].dayEndMs <= now.getTime()}
              due={dueByDay.get(key) ?? EMPTY_DUE}
              onOpenTask={(id) => onDueClick?.(id)}
              onSchedule={(id) => onScheduleDue?.(id, day)}
              canSchedule={Boolean(onScheduleDue)}
              note={dayZoneNote(day, second)}
            />
          );
        })}
      </div>

      {/* all-day lane: at most two rows, pinned above the hours */}
      {hasAllDay ? (
        <AllDayLane
          days={days}
          columns={columns}
          allDayByDay={allDayByDay}
          accountHues={accountHues}
          selectedOccurrenceKey={selectedOccurrenceKey}
          nowMs={now.getTime()}
          onPick={(chip, rect) => {
            onSelectOccurrence(chip.occurrenceKey);
            onEventClick(chip, rect);
          }}
          staleAccountIds={staleAccountIds}
          waitingEventIds={waitingEventIds}
        />
      ) : loading ? (
        // The last known lane, so the hours don't move when the events land (AC4).
        <AllDayLaneSkeleton days={days.length} columns={columns} rows={loadingAllDayRows} />
      ) : null}

      {/* the hours grid */}
      <div
        ref={scrollRef}
        tabIndex={0}
        role="group"
        aria-label="Calendar grid: arrows move the cursor, ? lists the keys"
        data-calendar-grid=""
        className="group/grid scrollbar-thin min-h-0 flex-1 overflow-y-auto outline-none"
      >
        <div
          ref={gridRef}
          className="relative grid"
          style={{ gridTemplateColumns: columns, height: y(maxMinutes) }}
        >
          {/* hour gutter */}
          <div className="relative" aria-hidden>
            {second && refDay ? <SecondZoneHours zone={second} day={refDay} /> : null}
            {hourMarks.slice(1).map((mark, i) => (
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
                maxCols={maxCols}
                onOverflowPick={onOverflowPick}
                prefs={prefs}
                nowMinutes={isToday ? minutesIntoDay(now.getTime(), geoms[i]) : null}
                // Elapsed detection needs an absolute `now`: the live tick on
                // today (re-renders that column per tick), a stable day-past
                // flag elsewhere (past columns are all-elapsed, future none).
                tickNowMs={isToday ? now.getTime() : null}
                dayEndPast={geoms[i].dayEndMs <= now.getTime()}
                workedTaskIds={workedTaskIds}
                onTriageLater={onTriageLater}
                onTriageLonger={onTriageLonger}
                onTriageRemove={onTriageRemove}
                focusBlockId={focusBlockId}
                fileCounts={fileCounts}
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
                createCalendars={createCalendars}
                onCommitCreate={commitCreate}
                onCancelCreate={cancelCreate}
                onAdjustPendingTimes={adjustPendingTimes}
                dragVisual={dragVisual?.dayIdx === i ? dragVisual : null}
                staleAccountIds={staleAccountIds}
                waitingEventIds={waitingEventIds}
                showLoadingChips={loading && !hasAnyChips && i < 2}
                prepFor={prepFor}
                emptyHint={
                  isToday
                    ? emptyWeekHint({
                        loading,
                        failed: Boolean(error) || faulted,
                        hasAnyChips,
                        drafting: pending !== null,
                      })
                    : null
                }
              />
            );
          })}
          {cursor ? <GridCursorMark cursor={cursor} days={days} /> : null}
          {gridLayer}
        </div>
      </div>
      {overlay}
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
  maxCols,
  onOverflowPick,
  prefs,
  nowMinutes,
  tickNowMs,
  dayEndPast,
  workedTaskIds,
  onTriageLater,
  onTriageLonger,
  onTriageRemove,
  focusBlockId,
  fileCounts,
  canEdit,
  onToggleDone,
  onBackgroundPointerDown,
  onEventChipPointerDown,
  onTaskChipPointerDown,
  selectedKey,
  pending,
  createCalendars,
  onCommitCreate,
  onCancelCreate,
  onAdjustPendingTimes,
  dragVisual,
  staleAccountIds,
  waitingEventIds,
  showLoadingChips,
  emptyHint,
  prepFor,
}: {
  dayIdx: number;
  dayKey: string;
  geom: DayGeometry;
  blocks: TaskBlock[];
  events: EventChip[];
  accountHues: Record<string, string>;
  /** Side by side before "+N": two in Week, four in Day. */
  maxCols: number;
  onOverflowPick: (target: GestureTarget, rect: DOMRect) => void;
  prefs: CalendarPrefs;
  /** Wall-clock minutes into this day for the now line; null off-today. */
  nowMinutes: number | null;
  /** Absolute tick `now` for today's column; null elsewhere. */
  tickNowMs: number | null;
  /** True when this whole day is behind now (past columns are all-elapsed). */
  dayEndPast: boolean;
  workedTaskIds: ReadonlySet<string>;
  /** A block of a work session acts on that session (`sessionId`). */
  onTriageLater: (taskId: string, sessionId?: string | null) => void;
  onTriageLonger: (taskId: string) => void;
  onTriageRemove: (taskId: string, sessionId?: string | null) => void;
  focusBlockId: string | null;
  /** Task id → its finished files (AT-3's 📎 mark). */
  fileCounts?: ReadonlyMap<string, number>;
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
  createCalendars: QuickCreateCalendar[];
  onCommitCreate: (draft: QuickCreateDraft) => void;
  onCancelCreate: () => void;
  onAdjustPendingTimes: (startMs: number, endMs: number) => void;
  dragVisual: DragVisual | null;
  staleAccountIds: ReadonlySet<string>;
  waitingEventIds: ReadonlySet<string>;
  showLoadingChips: boolean;
  emptyHint: string | null;
  prepFor?: (chip: EventChip) => ReactNode;
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
      layoutDayChips(
        [
          ...blocks.map((b) => ({ id: b.blockId, startMs: b.startMs, endMs: b.endMs })),
          ...events.map((c) => ({ id: c.occurrenceKey, startMs: c.startMs, endMs: c.endMs })),
        ],
        maxCols,
      ),
    [blocks, events, maxCols],
  );
  const blockById = useMemo(() => new Map(blocks.map((b) => [b.blockId, b])), [blocks]);
  const eventByKey = useMemo(() => new Map(events.map((c) => [c.occurrenceKey, c])), [events]);
  // Working hours are wall-clock minutes, like the grid.
  // A weekend day is all wash (CALR-13).
  const { top: washTop, bottomFrom: washBottom } = offHoursWash(prefs, new Date(geom.dayStartMs));
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
      className={cn("relative border-l border-border", isDropOver && "bg-accent/20")}
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
          const focusing = focusBlockId === block.blockId;
          const awaitingTriage = elapsed && !block.done && !worked;
          return (
            <div
              key={p.id}
              data-chip="task"
              className={cn("absolute pl-px pr-0.5", canEdit && !block.done && "cursor-grab")}
              style={{
                top: y(span.topMinutes),
                height: `max(${y(span.heightMinutes)}, 1.375rem)`,
                left: `${p.left * 100}%`,
                width: `${p.width * 100}%`,
                zIndex: p.layer,
              }}
              onPointerDown={(e) => onTaskChipPointerDown(e, block, dayIdx, span)}
            >
              <TaskBlockChip
                title={block.title}
                startMs={block.startMs}
                endMs={block.endMs}
                done={block.done}
                compact={shownMinutes(p.coveredFromMs, span, geom) < COMPACT_BELOW_MINUTES}
                canEdit={canEdit}
                onToggleDone={() => onToggleDone(block.taskId)}
                elapsed={elapsed}
                worked={worked}
                showTriage={awaitingTriage && span.heightMinutes >= TRIAGE_MIN_MINUTES}
                onLater={() => onTriageLater(block.taskId, block.sessionId)}
                onLonger={() => onTriageLonger(block.taskId)}
                onRemove={() => onTriageRemove(block.taskId, block.sessionId)}
                focusing={focusing}
                focusReadout={focusing ? <FocusReadout /> : null}
                files={fileCounts?.get(block.taskId) ?? 0}
              />
            </div>
          );
        }
        const chip = eventByKey.get(p.id);
        if (!chip) return null;
        const span = chipSpanInDay(chip.startMs, chip.endMs, geom);
        if (!span) return null;
        return (
          <GridEventCard
            key={p.id}
            chip={chip}
            span={span}
            placed={p}
            geom={geom}
            hue={eventHue(chip, accountHues)}
            draggable={canEdit && !chip.readOnly}
            selected={selectedKey === chip.occurrenceKey}
            nowMs={nowMs}
            nowMinutes={nowMinutes}
            onPointerDown={(e) => onEventChipPointerDown(e, chip, dayIdx, span)}
            stale={chip.sourceAccountId !== null && staleAccountIds.has(chip.sourceAccountId)}
            waiting={waitingEventIds.has(chip.eventId)}
            // The prep needs the free width: a card sharing its slot goes without.
            aside={prepFor && p.width > 0.5 ? prepFor(chip) : null}
          />
        );
      })}

      {/* "+N": the events past the side-by-side cap, as a list that opens them */}
      {layout.overflow.map((o) => {
        const span = chipSpanInDay(o.startMs, o.endMs, geom);
        if (!span) return null;
        const rows = o.ids.flatMap((id): GestureTarget[] => {
          const block = blockById.get(id);
          if (block) return [{ type: "task", block }];
          const chip = eventByKey.get(id);
          return chip ? [{ type: "event", chip }] : [];
        });
        return (
          <OverflowList
            key={`overflow-${o.ids[0]}`}
            top={y(span.topMinutes)}
            rows={rows}
            onPick={onOverflowPick}
          />
        );
      })}

      {/* the draw ghost (before release) / drag-move preview */}
      {dragVisual ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0.5 rounded-md border border-primary/50 bg-primary/15 px-1.5 py-0.5"
          style={{
            top: y(dragVisual.startMin),
            height: `max(${y(dragVisual.endMin - dragVisual.startMin)}, 1.125rem)`,
            zIndex: GRID_LAYER.ghost,
          }}
        >
          <span className="text-2xs text-muted-foreground">
            {dragVisual.title ? `${dragVisual.title} · ` : ""}
            {formatTimeOfDay(instantAtWallMinute(dragVisual.startMin, geom))} –{" "}
            {formatTimeOfDay(instantAtWallMinute(dragVisual.endMin, geom))}
          </span>
        </div>
      ) : null}

      <ComposerGhost geom={geom} />

      {/* the materialized ghost: inline title + quick-create popover */}
      {pending ? (
        <div
          className="absolute inset-x-0.5"
          style={{
            top: y(pending.startMin),
            height: `max(${y(pending.endMin - pending.startMin)}, 1.375rem)`,
            zIndex: GRID_LAYER.pending,
          }}
        >
          <EventQuickCreate
            startMs={instantAtWallMinute(pending.startMin, geom)}
            endMs={instantAtWallMinute(pending.endMin, geom)}
            calendars={createCalendars}
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

      {/* now line — today's column only, over every card but the live one */}
      {nowMinutes != null ? <NowLine minutes={nowMinutes} /> : null}

      {/* quiet empty hint (spec §9) */}
      {/* The empty hint sits by now (today's column), where the week opens:
          under the now line, or over it late in the evening. */}
      {emptyHint ? (
        <EmptyHint text={emptyHint} minute={nowMinutes ?? prefs.workStartMinute} />
      ) : null}
    </div>
  );
});

/** The empty-week hint, clear of the now line: under it, or above it late in
 *  the evening (bottom-anchored there, so a wrapped hint never crosses it). */
function EmptyHint({ text, minute }: { text: string; minute: number }) {
  const above = minute > 21 * 60;
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-2 z-[1] text-center text-xs text-muted-foreground",
        above && "-translate-y-full",
      )}
      style={{ top: y(above ? minute - 15 : minute + 15) }}
    >
      {text}
    </div>
  );
}
