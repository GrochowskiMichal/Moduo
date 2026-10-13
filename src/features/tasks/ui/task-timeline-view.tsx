// The Timeline (Tasks v3 TV-TL1, spec §6, REPLAN 67–71, 46a, 48b): rows
// follow the scope (projects across the workspace, tasks inside a project),
// each date drawn as what it is (tasks are points; projects and sections are
// spans), a sticky resizable name column, a two-tier sticky time header with
// the Today pill, a quiet grid, Week · Month · Quarter · Year (⌘-scroll and
// bare −/= too), and a canvas that scrolls endlessly both ways, drawing only
// the rows on screen (VirtualStack) over a grid painted as one background.
//
// Working on the canvas (TV-TL2, REPLAN 70, 68b): drag a point (its due
// date; a selection moves together), a diamond, a band or a bar and their
// ends; click a day on a row with no date; the view scrolls near its edges;
// every change has one Undo; ⌥←/→ (⇧ a week), d, ⇧D, ⇧T, ⇧↑↓, ⌘A; the
// selected or hovered task's "waits on" lines, a contradicting date shown
// with its one fix; "No date · n" opens the right panel's No date view, whose
// tasks drop onto a day. The pieces: `use-timeline-canvas.ts` (the pointer),
// `use-timeline-writes.tsx` (what's saved), `use-timeline-drop.tsx` (the
// panel's drop), `timeline-deps-layer.tsx` (the lines), and the marks reading
// a drag from `timeline-drag-store.ts`. A person who can't edit gets none of
// the handles: nothing offers a drag that would be refused.

import { CalendarOff } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "../../../components/ui/button";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { useTimeRegion } from "../../../lib/time-region";
import { cn } from "../../../lib/utils";
import { useAssignees } from "../assignees";
import { type CompletedMode, isCompletedHidden } from "../completed";
import { type TasksDisplay, type TimelineShow, timelineScopeOf } from "../display";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Bucket, Task, TaskRelation } from "../model";
import { PRIVATE_PROJECT_LABEL } from "../model";
import { contradictions } from "../timeline-deps";
import { fitZoom } from "../timeline-drag";
import {
  isTypingTarget,
  shiftDaysOf,
  type TimelineKeyAction,
  timelineKeyAction,
} from "../timeline-keys";
import {
  buildTimelineRows,
  type DaySpan,
  type TimelineGroup,
  type TimelineRow,
  taskRowKey,
  timelineGroupsFor,
} from "../timeline-rows";
import {
  DAY_WIDTH,
  dayCenterX,
  dayNumOfKey,
  drawWindow,
  extendRange,
  initialRange,
  scrollLeftFor,
  stepZoom,
  TIMELINE_ZOOMS,
  type TimelineRange,
  type TimelineZoom,
  topTier,
  visibleDays,
  weekCounts,
  weekdayOf,
  weekStartOf,
  xOfDay,
  ZOOM_LABELS,
} from "../timeline-scale";
import { useToday } from "../use-today";
import type { PlanHeaderControls, PlanView } from "./plan-view-header";
import { PlanViewHeader } from "./plan-view-header";
import { ProjectChoicesProvider, StatusChoicesProvider } from "./project-choices";
import { useRowActions } from "./row-facts";
import { activateTask, type TaskCommand } from "./task-context-menu";
import { TimelineDepsLayer } from "./timeline-deps-layer";
import { createCanvasStore, TimelineCanvasContext } from "./timeline-drag-store";
import { TimelineHeader } from "./timeline-header";
import {
  createViewportStore,
  type TimelineGeometry,
  TimelineGeometryContext,
  TimelineViewportContext,
  TimelineWindowContext,
} from "./timeline-marks";
import {
  type RowStubs,
  type TimelineRowHandlers,
  TimelineRowItem,
  timelineRowDomId,
} from "./timeline-row";
import type { MultiSelect } from "./use-task-selection";
import { type CanvasLive, useTimelineCanvas } from "./use-timeline-canvas";
import { useTimelineDrop } from "./use-timeline-drop";
import { useTimelineWrites } from "./use-timeline-writes";
import { VirtualStack } from "./virtual-stack";

type Props = {
  tasks: Task[];
  scopeTitle: string;
  /** The sidebar's place: "all", a project's id, "mine", "upcoming", the Inbox… */
  selection: string;
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  /** Projects in the sidebar's order (All: area by area). */
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onRequestCapture: () => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** The toolbar's search, Filter, Display and count (built by the page). */
  header?: PlanHeaderControls;
  /** Filter or search narrows the scope. */
  filterActive?: boolean;
  api: TasksModuleApi;
  workspaceId: string;
  /** The scope's Display (the zoom, Group by, Colour by, Show, Subtasks). */
  display: TasksDisplay;
  onDisplayChange: (next: TasksDisplay) => void;
  /** Display → Show done, and the tasks that stay listed anyway. */
  completed: CompletedMode;
  stayingIds: ReadonlySet<string>;
  /** The workspace's task key ("MOD"): the menu's Copy link names the handle. */
  taskKey?: string | null;
  /** ⏎ opens a task's full page. */
  onOpenTask?: (id: string) => void;
  /** ⏎ (or a double-click) on a project at All opens its own Timeline. */
  onOpenProject?: (id: string) => void;
  /** The page's selection of several tasks (TV-U12): ⇧/⌘-click, ⇧↑↓, ⌘A; they move together. */
  multiSelect?: MultiSelect;
  /** Where the view writes the task rows' order (a range, ⌘A, the bulk bar). */
  orderRef?: { current: readonly string[] };
  /** The page's keys on a selection (the bulk bar's), asked before the view's own. */
  onViewKey?: (event: ReactKeyboardEvent<HTMLDivElement>, selected: Task | null) => boolean;
  /** "No date · n": open the right panel's No date view (absent: it shows the undated rows). */
  onOpenNoDate?: () => void;
  /**
   * May this person move dates here (TV-TL2): Edit in the workspace, and on
   * the project when the place is one. False: no drag handles at all.
   */
  canDrag?: boolean;
};

const NO_IDS: ReadonlySet<string> = new Set();
const NO_RELATIONS: readonly TaskRelation[] = [];

/** The keys the view keeps while several tasks are selected (the rest are the bulk bar's). */
const VIEW_KEYS_ON_A_SELECTION: ReadonlySet<TimelineKeyAction> = new Set<TimelineKeyAction>([
  "shift-earlier",
  "shift-later",
  "shift-earlier-week",
  "shift-later-week",
  "extend-next",
  "extend-prev",
  "select-all",
  "clear",
  "fit",
  "next",
  "prev",
  "today",
  "zoom-in",
  "zoom-out",
  "name-column",
  "fold",
  "unfold",
]);

/** The name column (69): 280 px, 200–480, ⇧[ hides it. Per device. */
const NAME_W_DEFAULT = 280;
const NAME_W_MIN = 200;
const NAME_W_MAX = 480;
const NAME_COLUMN_KEY = "moduo:tasks:timeline:name-column";

/** A first guess at a row's height (VirtualStack measures each once drawn). */
const ROW_GUESS = 36;
const HEADER_ROW_GUESS = 28;

type NameColumn = { width: number; hidden: boolean };

function readNameColumn(): NameColumn {
  try {
    const raw = JSON.parse(window.localStorage.getItem(NAME_COLUMN_KEY) ?? "null") as unknown;
    if (raw && typeof raw === "object") {
      const { width, hidden } = raw as Partial<NameColumn>;
      return {
        width:
          typeof width === "number" && Number.isFinite(width)
            ? Math.min(NAME_W_MAX, Math.max(NAME_W_MIN, Math.round(width)))
            : NAME_W_DEFAULT,
        hidden: hidden === true,
      };
    }
  } catch {
    // Storage off or a stray value: the default.
  }
  return { width: NAME_W_DEFAULT, hidden: false };
}

function writeNameColumn(value: NameColumn): void {
  try {
    window.localStorage.setItem(NAME_COLUMN_KEY, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function readToggled(key: string): ReadonlySet<string> {
  try {
    const raw = JSON.parse(window.localStorage.getItem(key) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((k): k is string => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

const NO_SHOW: readonly TimelineShow[] = [];

export function TaskTimelineView({
  tasks,
  scopeTitle,
  selection,
  view,
  onViewChange,
  buckets,
  inbox,
  canEdit,
  onRequestCapture,
  selectedTaskId,
  onSelectTask,
  header,
  filterActive = false,
  api,
  workspaceId,
  display,
  onDisplayChange,
  completed,
  stayingIds,
  taskKey = null,
  onOpenTask,
  onOpenProject,
  multiSelect,
  orderRef,
  onViewKey,
  onOpenNoDate,
  canDrag: canDragProp,
}: Props) {
  const scopeKey = inbox && selection === inbox.id ? "inbox" : selection;
  const scopeKind = useMemo(() => timelineScopeOf(scopeKey), [scopeKey]);
  // Drags need Edit (TV-TL2): the page works it out (`canDrag`); without one,
  // the workspace's Edit decides. The server still checks every write.
  const canDrag = canEdit && (canDragProp ?? true);
  const [canvas] = useState(createCanvasStore);
  const selectedIds = multiSelect?.ids ?? NO_IDS;
  const zoom = display.timelineZoom;
  const dw = DAY_WIDTH[zoom];
  const show = new Set(display.timelineShow ?? NO_SHOW);
  const groups = timelineGroupsFor(scopeKind.kind);
  const group: TimelineGroup = groups.includes(display.timelineGroup)
    ? display.timelineGroup
    : (groups[0] ?? "none");
  const todayKey = useToday();
  const today = dayNumOfKey(todayKey) ?? 0;
  const { weekStartsOn } = useTimeRegion();
  const { byId: personById } = useAssignees();

  // ── Folds: projects expanded at All, sections folded (per device) ─────────
  const foldKey = `moduo:tasks:folds:${api.currentUserId ?? "anon"}:${scopeKey}:timeline:${workspaceId}`;
  const [folds, setFolds] = useState(() => ({ key: foldKey, set: readToggled(foldKey) }));
  const toggled = folds.key === foldKey ? folds.set : readToggled(foldKey);
  if (folds.key !== foldKey) setFolds({ key: foldKey, set: toggled });
  const toggleRow = useCallback((rowKey: string) => {
    setFolds((prev) => {
      const next = new Set(prev.set);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      try {
        window.localStorage.setItem(prev.key, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return { key: prev.key, set: next };
    });
  }, []);
  const expanded = useMemo(() => {
    const ids = new Set<string>();
    for (const k of toggled) if (k.startsWith("project:")) ids.add(k.slice("project:".length));
    return ids;
  }, [toggled]);

  // ── Rows ────────────────────────────────────────────────────────────────
  const projects = useMemo(
    () => (scopeKind.kind === "project" ? [...buckets, ...api.archivedBuckets] : buckets),
    [scopeKind.kind, buckets, api.archivedBuckets],
  );
  // A project's bar and progress count all its work, an archived one's too.
  const allTasks = useMemo(
    () => (scopeKind.kind === "project" ? [...api.tasks, ...api.archivedTasks] : api.tasks),
    [scopeKind.kind, api.tasks, api.archivedTasks],
  );
  const hueById = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const p of projects) map.set(p.id, p.color ?? null);
    return map;
  }, [projects]);
  const isHidden = useCallback(
    (task: Task) =>
      isCompletedHidden(task, {
        mode: completed,
        now: new Date(),
        keep: (t) => stayingIds.has(t.id),
      }),
    [completed, stayingIds],
  );
  const personName = useCallback(
    (id: string) => personById(id)?.fullName || "Someone",
    [personById],
  );
  const showUndated = show.has("undated");
  const showSessions = show.has("sessions");
  const built = useMemo(
    () =>
      buildTimelineRows({
        scope: scopeKind,
        tasks,
        allTasks,
        projects,
        areas: api.areas,
        sections: api.sections,
        sessions: api.sessions,
        group,
        subtasks: display.timelineSubtasks,
        showUndated,
        showSessions,
        isHidden,
        expanded,
        folded: toggled,
        today,
        now: Date.now(),
        filtering: filterActive,
        inboxId: inbox?.id ?? null,
        personName,
      }),
    [
      scopeKind,
      tasks,
      allTasks,
      projects,
      api.areas,
      api.sections,
      api.sessions,
      group,
      display.timelineSubtasks,
      showUndated,
      showSessions,
      isHidden,
      expanded,
      toggled,
      today,
      filterActive,
      inbox?.id,
      personName,
    ],
  );
  const { rows } = built;
  // The task rows in the order drawn: a ⇧-click range, ⇧↑↓, ⌘A (TV-U12).
  const taskOrder = useMemo(
    () => rows.flatMap((r) => (r.kind === "task" ? [r.task.id] : [])),
    [rows],
  );
  useLayoutEffect(() => {
    if (orderRef) orderRef.current = taskOrder;
  });
  const stickyIndexes = useMemo(
    () =>
      rows.flatMap((r, i) =>
        r.kind === "area" || r.kind === "group" || r.kind === "section" ? [i] : [],
      ),
    [rows],
  );
  const duePerWeek = show.has("duePerWeek");
  const dueCounts = useMemo(
    () => (duePerWeek ? weekCounts(built.dueDays, weekStartsOn) : null),
    [duePerWeek, built.dueDays, weekStartsOn],
  );

  // ── The name column ────────────────────────────────────────────────────
  const [nameColumn, setNameColumn] = useState<NameColumn>(readNameColumn);
  const nameW = nameColumn.hidden ? 0 : nameColumn.width;
  const toggleNameColumn = useCallback(() => {
    setNameColumn((prev) => {
      const next = { ...prev, hidden: !prev.hidden };
      writeNameColumn(next);
      return next;
    });
  }, []);
  const startResize = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startW = nameColumn.width;
      let width = startW;
      const onMove = (ev: PointerEvent) => {
        width = Math.min(NAME_W_MAX, Math.max(NAME_W_MIN, startW + ev.clientX - startX));
        setNameColumn((prev) => ({ ...prev, width }));
      };
      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        document.removeEventListener("pointercancel", onUp);
        writeNameColumn({ width, hidden: false });
      };
      document.addEventListener("pointermove", onMove);
      document.addEventListener("pointerup", onUp);
      document.addEventListener("pointercancel", onUp);
    },
    [nameColumn.width],
  );

  // ── The scroller, its size, the range and the drawn window ─────────────
  const scrollerRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0, header: 0 });
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const measure = () =>
      setSize((prev) => {
        const next = {
          width: el.clientWidth,
          height: el.clientHeight,
          header: headerRef.current?.offsetHeight ?? 0,
        };
        return prev.width === next.width &&
          prev.height === next.height &&
          prev.header === next.header
          ? prev
          : next;
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    if (headerRef.current) observer.observe(headerRef.current);
    return () => observer.disconnect();
  }, []);
  const trackWidth = Math.max(0, size.width - nameW);

  const [range, setRange] = useState<TimelineRange>(() => initialRange(today, built.extent));
  const [drawn, setDrawn] = useState(() => drawWindow({ from: today - 60, to: today + 60 }));
  // The days on screen now (whole days), for the off-screen hints only: a
  // store they subscribe to, so scrolling never redraws the view.
  const [viewport] = useState(() => createViewportStore({ from: today - 30, to: today + 30 }));
  const canvasW = range.days * dw;

  // The live values the scroll and wheel handlers read.
  const live = useRef({ range, dw, trackWidth, zoom, nameW });
  useLayoutEffect(() => {
    live.current = { range, dw, trackWidth, zoom, nameW };
  });
  /**
   * Where the next render puts the scroll: today, a kept day, or an added
   * start. An ask made with a new range waits for that range to be drawn (a
   * scope switch can change the zoom in the same render as it asks).
   */
  const pending = useRef<
    | { kind: "today"; range: TimelineRange }
    | { kind: "day"; day: number; at: number }
    | { kind: "shift"; days: number; range: TimelineRange }
    | null
  >(null);

  const syncWindow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const { range: r, dw: w, trackWidth: tw } = live.current;
    if (tw <= 0) return;
    // A new range is on its way: read nothing against the old one.
    const ask = pending.current;
    if (ask && ask.kind !== "day" && ask.range !== r) return;
    const shown = visibleDays(r, w, el.scrollLeft, tw);
    const grown = extendRange(r, shown, Math.ceil(tw / w) + 30);
    if (grown) {
      if (grown.shift > 0) {
        pending.current = { kind: "shift", days: grown.shift, range: grown.range };
      }
      setRange(grown.range);
    }
    const next = drawWindow(shown);
    setDrawn((prev) => (prev.from === next.from && prev.to === next.to ? prev : next));
    viewport.set(shown);
  }, [viewport]);

  // Open (a new scope, or once the tasks are in) with today a quarter across.
  const loaded = !api.loading;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new scope or the first load is the cue
  useLayoutEffect(() => {
    const next = initialRange(today, built.extent);
    pending.current = { kind: "today", range: next };
    setRange(next);
  }, [scopeKey, loaded]);

  // Apply what was asked once the range, zoom and size are drawn.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs after each geometry change
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    const ask = pending.current;
    if (!el || !ask || trackWidth <= 0) return;
    // Asked with a range that isn't drawn yet: wait for it.
    if (ask.kind !== "day" && ask.range !== range) return;
    pending.current = null;
    if (ask.kind === "today") el.scrollLeft = scrollLeftFor(range, dw, today, trackWidth);
    else if (ask.kind === "day") el.scrollLeft = Math.max(0, (ask.day - range.start) * dw - ask.at);
    else el.scrollLeft += ask.days * dw;
    syncWindow();
  }, [range, dw, trackWidth]);

  const onScroll = useRef(0);
  const handleScroll = useCallback(() => {
    if (onScroll.current) return;
    onScroll.current = requestAnimationFrame(() => {
      onScroll.current = 0;
      syncWindow();
    });
  }, [syncWindow]);
  useEffect(() => () => cancelAnimationFrame(onScroll.current), []);

  const scrollToToday = useCallback(
    (smooth: boolean) => {
      const el = scrollerRef.current;
      if (!el) return;
      el.scrollTo({
        left: scrollLeftFor(range, dw, today, trackWidth),
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [range, dw, today, trackWidth],
  );

  // Zoom keeps the day under the pointer (or the middle) where it was.
  const changeZoom = useCallback(
    (next: TimelineZoom, clientX?: number) => {
      const el = scrollerRef.current;
      const { range: r, dw: w, trackWidth: tw, nameW: nw, zoom: z } = live.current;
      if (next === z) return;
      if (el) {
        const left = el.getBoundingClientRect().left + nw;
        const at = clientX === undefined ? tw / 2 : Math.max(0, Math.min(tw, clientX - left));
        pending.current = { kind: "day", day: r.start + (el.scrollLeft + at) / w, at };
      }
      onDisplayChange({ ...display, timelineZoom: next });
    },
    [display, onDisplayChange],
  );
  const changeZoomRef = useRef(changeZoom);
  useLayoutEffect(() => {
    changeZoomRef.current = changeZoom;
  });

  // ⌘-scroll (or a pinch) zooms (69). React's wheel listener is passive, so
  // the page's own zoom is stopped here.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    let travel = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.metaKey && !e.ctrlKey) return;
      e.preventDefault();
      travel += e.deltaY;
      if (Math.abs(travel) < 40) return;
      const out = travel > 0;
      travel = 0;
      changeZoomRef.current(stepZoom(live.current.zoom, out ? 1 : -1), e.clientX);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ── The cursor (↑↓) and the selection ──────────────────────────────────
  const [cursorKey, setCursorKey] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<{ key: string; seq: number } | null>(null);
  const stops = useMemo(
    () => rows.filter((r) => r.kind === "project" || r.kind === "section" || r.kind === "task"),
    [rows],
  );
  const rowByKey = useMemo(() => new Map(rows.map((r) => [r.key, r])), [rows]);

  /**
   * Bring a row into view, up or down only: the canvas never jumps sideways
   * under the cursor (a mark off to the side shows as a hint at the row's
   * edge, `OffscreenHint`). A deep link's point is centred by the page's
   * reveal, which finds the first `[data-task-id]`: the point, not the row.
   */
  const reveal = useCallback((row: TimelineRow) => {
    setScrollTo((prev) => ({ key: row.key, seq: (prev?.seq ?? 0) + 1 }));
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      const node = document.getElementById(timelineRowDomId(row.key));
      if (!el || !node) return;
      const box = el.getBoundingClientRect();
      const rect = node.getBoundingClientRect();
      const top = box.top + (headerRef.current?.offsetHeight ?? 0);
      if (rect.top < top) el.scrollTop -= top - rect.top;
      else if (rect.bottom > box.bottom) el.scrollTop += rect.bottom - box.bottom;
    });
  }, []);

  /** Scroll sideways to a day (a hint's click), a quarter of the way across. */
  const scrollToDay = useCallback((day: number) => {
    const el = scrollerRef.current;
    if (!el) return;
    const { range: r, dw: w, trackWidth: tw } = live.current;
    el.scrollTo({ left: scrollLeftFor(r, w, day, tw), behavior: "smooth" });
  }, []);

  // The page's selection (a click, a deep link, the panel) moves the cursor
  // and brings its row into view.
  const selectedRow = selectedTaskId ? rowByKey.get(taskRowKey(selectedTaskId)) : undefined;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection is the cue
  useEffect(() => {
    if (!selectedRow) return;
    setCursorKey(selectedRow.key);
    reveal(selectedRow);
  }, [selectedTaskId, selectedRow !== undefined]);

  const moveCursor = (delta: 1 | -1) => {
    if (stops.length === 0) return;
    const at = cursorKey ? stops.findIndex((r) => r.key === cursorKey) : -1;
    const index =
      at < 0
        ? delta > 0
          ? 0
          : stops.length - 1
        : Math.max(0, Math.min(stops.length - 1, at + delta));
    const row = stops[index];
    if (!row) return;
    multiSelect?.clear();
    setCursorKey(row.key);
    onSelectTask(row.kind === "task" ? row.task.id : null);
    reveal(row);
  };

  // ── Who may move what (TV-TL2) ──────────────────────────────────────────
  const canDragRow = useCallback(
    (row: TimelineRow) =>
      canDrag && (row.kind === "task" || row.kind === "section" || row.kind === "project"),
    [canDrag],
  );

  // ── Dependencies (70, 68b) ──────────────────────────────────────────────
  // Only the reader's own copy: a relation to a task they can't see draws nothing.
  const taskById = useMemo(() => new Map(api.tasks.map((t) => [t.id, t])), [api.tasks]);
  const relations = api.taskRelations ?? NO_RELATIONS;
  const depMode = display.timelineDeps ?? "selected";
  const lateMarks = useMemo(
    () => (depMode === "off" ? new Map() : contradictions(relations, taskById)),
    [depMode, relations, taskById],
  );
  /** Where a task's point is on the canvas (null: it has none, or no row). */
  const pointDay = useCallback(
    (id: string) => {
      const row = rowByKey.get(taskRowKey(id));
      return row?.kind === "task" && row.point ? row.point.day : null;
    },
    [rowByKey],
  );
  const lineSelection = useMemo(
    () =>
      selectedIds.size >= 2 ? selectedIds : selectedTaskId ? new Set([selectedTaskId]) : NO_IDS,
    [selectedIds, selectedTaskId],
  );
  // The selected task's lines whose other end isn't drawn: stubs on its row.
  const stubs = useMemo<RowStubs | null>(() => {
    if (depMode === "off" || !selectedTaskId || selectedIds.size >= 2) return null;
    const self = taskById.get(selectedTaskId);
    if (!self || pointDay(self.id) === null) return null;
    const projectName = (id: string) =>
      id === inbox?.id
        ? "Inbox"
        : (buckets.find((b) => b.id === id)?.name ?? PRIVATE_PROJECT_LABEL);
    const words = (other: Task) => {
      const title = other.title || "Untitled";
      if (!other.dueOn && !other.dueDate && !other.scheduledAt) return `${title} · no date`;
      if (other.bucketId !== self.bucketId) return `↗ ${projectName(other.bucketId)} · ${title}`;
      return `↗ ${title}`;
    };
    const before: string[] = [];
    const after: string[] = [];
    for (const rel of relations) {
      const waitsOn = rel.blockedTaskId === self.id;
      const blocks = rel.blockerTaskId === self.id;
      if (!waitsOn && !blocks) continue;
      const other = taskById.get(waitsOn ? rel.blockerTaskId : rel.blockedTaskId);
      if (!other || other.deletedAt || isHidden(other) || pointDay(other.id) !== null) continue;
      (waitsOn ? before : after).push(words(other));
    }
    return before.length + after.length > 0 ? { before, after } : null;
  }, [
    depMode,
    selectedTaskId,
    selectedIds,
    taskById,
    relations,
    pointDay,
    isHidden,
    buckets,
    inbox?.id,
  ]);

  // ── The canvas: drags, clicks on undated rows, the No date drop ─────────
  const writes = useTimelineWrites(api, zoom);
  const canvasLive = useRef<CanvasLive>({
    range,
    dw,
    nameW,
    rowOf: (key) => rowByKey.get(key),
    canDrag: canDragRow,
    canEditTask: () => canDrag,
    selection: selectedIds,
  });
  useLayoutEffect(() => {
    canvasLive.current = {
      range,
      dw,
      nameW,
      rowOf: (key) => rowByKey.get(key),
      canDrag: canDragRow,
      canEditTask: () => canDrag,
      selection: selectedIds,
    };
  });
  const [dragRowKey, setDragRowKey] = useState<string | null>(null);
  const pointer = useTimelineCanvas({
    scrollerRef,
    store: canvas,
    live: canvasLive,
    onCommit: writes.commit,
    onDragRow: setDragRowKey,
  });
  const drop = useTimelineDrop({
    scrollerRef,
    store: canvas,
    geometry: canvasLive,
    canEdit: canDrag,
    taskOf: (id) => taskById.get(id) ?? null,
    onDrop: writes.placeTask,
  });
  const { setDropRef } = drop;
  const setScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el;
      setDropRef(el);
    },
    [setDropRef],
  );
  /** The task under the pointer: its lines show too (70). */
  const onCanvasPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    pointer.onPointerMove(e);
    const key =
      e.target instanceof Element
        ? e.target.closest<HTMLElement>("[data-row-key]")?.dataset.rowKey
        : undefined;
    const row = key ? rowByKey.get(key) : undefined;
    canvas.setHoverTask(row?.kind === "task" ? row.task.id : null);
  };
  const onCanvasPointerLeave = () => {
    pointer.onPointerLeave();
    canvas.setHoverTask(null);
  };

  // ── What rows ask for ─────────────────────────────────────────────────
  const [command, setCommand] = useState<{ id: string; command: TaskCommand } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const refocus = useCallback(() => scrollerRef.current?.focus({ preventScroll: true }), []);
  const latest = useRef({
    onSelectTask,
    onOpenProject,
    toggleRow,
    api,
    canEdit,
    multiSelect,
    taskOrder,
    placeTask: writes.placeTask,
  });
  useLayoutEffect(() => {
    latest.current = {
      onSelectTask,
      onOpenProject,
      toggleRow,
      api,
      canEdit,
      multiSelect,
      taskOrder,
      placeTask: writes.placeTask,
    };
  });
  const handlers = useMemo<TimelineRowHandlers>(
    () => ({
      activate: (row, mods) => {
        const { multiSelect: multi, taskOrder: order } = latest.current;
        if (row.kind === "task" && multi) {
          // ⇧ a range, ⌘ one more (TV-U12); a plain click is this one alone.
          multi.select(row.task.id, mods, order);
          if (!mods.range && !mods.toggle) setCursorKey(row.key);
        } else {
          multi?.clear();
          setCursorKey(row.key);
          latest.current.onSelectTask(row.kind === "task" ? row.task.id : null);
        }
        scrollerRef.current?.focus({ preventScroll: true });
      },
      moveTaskTo: (taskId, day) => latest.current.placeTask(taskId, day),
      toggle: (key) => latest.current.toggleRow(key),
      openProject: (id) => latest.current.onOpenProject?.(id),
      openTask: (id) => latest.current.onSelectTask(id),
      startRename: (id) => setEditingId(id),
      endRename: (id, title) => {
        setEditingId(null);
        const next = title?.trim();
        const task = latest.current.api.tasks.find((t) => t.id === id);
        if (next && task && next !== task.title) latest.current.api.patchTask(id, { title: next });
        refocus();
      },
      requestCommand: (id, cmd) => setCommand({ id, command: cmd }),
      scrollToDay,
      clearCommand: () => setCommand(null),
      refocus,
    }),
    [refocus, scrollToDay],
  );
  const rowActions = useRowActions(api);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    if (!scroller || !(e.target instanceof Node) || !scroller.contains(e.target)) return;
    if (isTypingTarget(e.target)) return;
    const action = timelineKeyAction(e);
    // A selection's own keys first (TV-U12's bar: d the date picker, Space,
    // ⌫…); the Timeline's date moves and its cursor keys stay the view's.
    if (selectedIds.size >= 2 && onViewKey && !(action && VIEW_KEYS_ON_A_SELECTION.has(action))) {
      const selectedNow = selectedTaskId ? (taskById.get(selectedTaskId) ?? null) : null;
      if (onViewKey(e, selectedNow)) {
        e.preventDefault();
        return;
      }
    }
    if (!action) return;
    const row = cursorKey ? rowByKey.get(cursorKey) : undefined;
    // A key the view didn't use keeps its native job (←/→ off a header and
    // Space with no row scroll the canvas).
    if (runKey(action, row)) e.preventDefault();
  };

  /** The selected tasks while two or more are, else none. */
  const selectedTasks = (): Task[] =>
    selectedIds.size >= 2
      ? [...selectedIds].flatMap((id) => {
          const task = taskById.get(id);
          return task ? [task] : [];
        })
      : [];

  /** ⇧T: bring the selection's marks into view, zooming out only if they don't fit. */
  const fitSelection = (row: TimelineRow | undefined): boolean => {
    const days: number[] = [];
    if (selectedIds.size >= 2) {
      for (const id of selectedIds) {
        const day = pointDay(id);
        if (day !== null) days.push(day);
      }
    } else if (row?.kind === "task" && row.point) days.push(row.point.day);
    else if (row?.kind === "section" && row.band) days.push(row.band.start, row.band.end);
    else if (row?.kind === "section" && row.milestone !== null) days.push(row.milestone);
    else if (row?.kind === "project" && row.bar) days.push(row.bar.start, row.bar.end);
    if (days.length === 0) return false;
    const span: DaySpan = { start: Math.min(...days), end: Math.max(...days) };
    const next = fitZoom(span, trackWidth, zoom);
    const center = (span.start + span.end + 1) / 2;
    if (next !== zoom) {
      pending.current = { kind: "day", day: center, at: trackWidth / 2 };
      onDisplayChange({ ...display, timelineZoom: next });
    } else {
      scrollerRef.current?.scrollTo({
        left: Math.max(0, (center - range.start) * dw - trackWidth / 2),
        behavior: "smooth",
      });
    }
    return true;
  };

  /** Run a key's action; false when it did nothing here. */
  const runKey = (action: TimelineKeyAction, row: TimelineRow | undefined): boolean => {
    const foldable =
      row?.kind === "section" || (row?.kind === "project" && row.expandable) ? row : null;
    const shift = shiftDaysOf(action);
    if (shift !== 0) {
      // ⌥←/→ (⇧ a week): the selection, or the row under the cursor (70).
      if (!canDrag) return false;
      const several = selectedTasks();
      if (several.length > 0) writes.shiftTasks(several, shift);
      else if (row?.kind === "task") writes.shiftTasks([row.task], shift);
      else if (!row || !writes.shiftRow(row, shift)) return false;
      return true;
    }
    switch (action) {
      case "date":
        if (row?.kind !== "task" || !canDrag) return false;
        setCommand({ id: row.task.id, command: "due" });
        return true;
      case "clear-date": {
        if (!canDrag) return false;
        const several = selectedTasks();
        const targets = several.length > 0 ? several : row?.kind === "task" ? [row.task] : [];
        if (targets.length === 0) return false;
        writes.clearDue(targets);
        return true;
      }
      case "fit":
        return fitSelection(row);
      case "extend-next":
      case "extend-prev":
        if (!multiSelect || row?.kind !== "task") return false;
        multiSelect.extend(action === "extend-next" ? 1 : -1, taskOrder);
        return true;
      case "select-all":
        if (!multiSelect || taskOrder.length === 0) return false;
        multiSelect.selectAll(taskOrder);
        return true;
      case "next":
        moveCursor(1);
        return true;
      case "prev":
        moveCursor(-1);
        return true;
      case "fold":
      case "unfold": {
        if (!foldable) return false;
        const open = foldable.kind === "project" ? foldable.expanded : !foldable.folded;
        if (open === (action === "fold")) toggleRow(foldable.key);
        return true;
      }
      case "open":
        if (row?.kind === "task") {
          onOpenTask?.(row.task.id);
          return true;
        }
        if (row?.kind === "project" && row.expandable && onOpenProject) {
          onOpenProject(row.project.id);
          return true;
        }
        if (foldable) {
          toggleRow(foldable.key);
          return true;
        }
        return false;
      case "toggle":
        if (row?.kind === "task") {
          if (canEdit) activateTask(row.task, rowActions);
          return true;
        }
        if (foldable) {
          toggleRow(foldable.key);
          return true;
        }
        return false;
      case "today":
        scrollToToday(true);
        return true;
      case "zoom-in":
        changeZoom(stepZoom(zoom, -1));
        return true;
      case "zoom-out":
        changeZoom(stepZoom(zoom, 1));
        return true;
      case "name-column":
        toggleNameColumn();
        return true;
      case "clear":
        // Esc: a selection of several first, then the cursor.
        if (multiSelect?.clear()) return true;
        setCursorKey(null);
        onSelectTask(null);
        return true;
      default:
        return false;
    }
  };

  // ── Geometry for the rows and marks ─────────────────────────────────────
  const geometry = useMemo<TimelineGeometry>(
    () => ({
      range,
      dw,
      zoom,
      today,
      colorBy: display.colorBy,
      nameHidden: nameColumn.hidden,
    }),
    [range, dw, zoom, today, display.colorBy, nameColumn.hidden],
  );
  const topCells = useMemo(() => topTier(zoom, drawn, today), [zoom, drawn, today]);
  const strong = useMemo(
    () =>
      topCells
        .map((c) => c.start)
        .filter((d) => d > drawn.from && d >= range.start && d <= drawn.to),
    [topCells, drawn, range.start],
  );
  const unit = zoom === "week" || zoom === "month" ? "day" : zoom === "quarter" ? "week" : "month";
  const firstWeek = weekStartOf(range.start, weekStartsOn);
  const unitX =
    unit === "week" ? xOfDay(range, dw, firstWeek < range.start ? firstWeek + 7 : firstWeek) : 0;
  const saturdayX = ((6 - weekdayOf(range.start) + 7) % 7) * dw;
  const yearMonths = useMemo(
    () => (zoom === "year" ? topTier("month", drawn, today).map((c) => c.start) : []),
    [zoom, drawn, today],
  );

  // The grid's geometry sits on the frame: the canvas's grid and a sticky
  // header row's track (which paints its own over its opaque surface) read it.
  const frameStyle = {
    "--timeline-name-w": `${nameW}px`,
    "--timeline-dw": `${dw}px`,
    "--timeline-head-h": `${size.header}px`,
    "--timeline-unit": `${unit === "week" ? dw * 7 : dw}px`,
    "--timeline-unit-x": `${unitX}px`,
    "--timeline-weekend-x": `${saturdayX}px`,
    width: nameW + canvasW,
  } as CSSProperties;
  const gridStyle = { left: nameW, width: canvasW } as CSSProperties;
  const bodyMin = Math.max(0, size.height - size.header);
  const cursorIndex = cursorKey ? rows.findIndex((r) => r.key === cursorKey) : -1;
  // The row a drag holds stays drawn while the canvas scrolls under it.
  const dragIndex = dragRowKey ? rows.findIndex((r) => r.key === dragRowKey) : -1;
  const pinned = useMemo(
    () => [cursorIndex, dragIndex].filter((i) => i >= 0),
    [cursorIndex, dragIndex],
  );
  const bodyRef = useRef<HTMLDivElement>(null);
  const statusesFor = useCallback(
    (bucketId: string) => api.statusesForBucket?.(bucketId) ?? [],
    [api.statusesForBucket],
  );
  const toggleUndated = () => {
    const next = showUndated
      ? display.timelineShow.filter((s) => s !== "undated")
      : [...display.timelineShow, "undated" as const];
    onDisplayChange({ ...display, timelineShow: next });
  };
  const empty = !built.hasMarks && !api.loading;

  return (
    <ProjectChoicesProvider projects={buckets} inboxId={inbox?.id ?? null}>
      <StatusChoicesProvider statusesFor={statusesFor} any={(api.statuses?.length ?? 0) > 0}>
        <TimelineCanvasContext.Provider value={canvas}>
          <div className="flex h-full min-h-0 flex-col">
            <PlanViewHeader
              title={scopeTitle}
              view={view}
              onViewChange={onViewChange}
              controls={header}
              canEdit={canEdit}
              onRequestCapture={onRequestCapture}
            />
            {/* The Timeline's own bar: No date on the left; Today and the zoom on the right. */}
            <div className="-mt-1 mb-2 flex shrink-0 items-center gap-1.5">
              {built.undated > 0 || showUndated ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    {onOpenNoDate ? (
                      // The right panel's No date view (70): drag a task from there onto a day.
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={onOpenNoDate}
                        className="px-2"
                        data-timeline-no-date-open=""
                      >
                        <CalendarOff aria-hidden />
                        No date
                        <span className="tabular-nums text-subtle-foreground">
                          · {built.undated}
                        </span>
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-pressed={showUndated}
                        onClick={toggleUndated}
                        className={cn("px-2", showUndated && "bg-state-active")}
                      >
                        <CalendarOff aria-hidden />
                        No date
                        <span className="tabular-nums text-subtle-foreground">
                          · {built.undated}
                        </span>
                      </Button>
                    )}
                  </TooltipTrigger>
                  <TooltipContent>
                    {onOpenNoDate
                      ? "Open the tasks with no date beside the timeline"
                      : showUndated
                        ? "Hide the rows with no date"
                        : "Show the tasks with no date as rows"}
                  </TooltipContent>
                </Tooltip>
              ) : null}
              <div className="flex-1" />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={() => scrollToToday(true)}>
                    Today
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Go to today · T</TooltipContent>
              </Tooltip>
              <SegmentedControl
                aria-label="Timeline zoom"
                size="sm"
                value={zoom}
                onValueChange={(value) => changeZoom(value as TimelineZoom)}
                items={TIMELINE_ZOOMS.map((z) => ({ value: z, label: ZOOM_LABELS[z] }))}
              />
            </div>

            <div className="relative -mx-(--pad-x) -mb-(--pad-x) min-h-0 flex-1 border-t border-hairline">
              <TimelineGeometryContext.Provider value={geometry}>
                <TimelineWindowContext.Provider value={drawn}>
                  <TimelineViewportContext.Provider value={viewport}>
                    <div
                      ref={setScroller}
                      role="grid"
                      aria-label={`${scopeTitle} timeline`}
                      aria-activedescendant={
                        cursorKey && rowByKey.has(cursorKey)
                          ? timelineRowDomId(cursorKey)
                          : undefined
                      }
                      aria-multiselectable={multiSelect ? true : undefined}
                      tabIndex={0}
                      onKeyDown={onKeyDown}
                      onScroll={handleScroll}
                      onPointerDown={pointer.onPointerDown}
                      onPointerMove={onCanvasPointerMove}
                      onPointerLeave={onCanvasPointerLeave}
                      onClickCapture={pointer.onClickCapture}
                      data-timeline=""
                      data-zoom={zoom}
                      data-can-drag={canDrag || undefined}
                      className="scrollbar-thin h-full overflow-auto overscroll-x-contain focus-visible:outline-none data-dragging:cursor-grabbing data-dragging:**:cursor-grabbing"
                    >
                      <div className="relative" style={frameStyle}>
                        <div ref={headerRef} className="sticky top-0 z-(--z-header)">
                          <TimelineHeader
                            topCells={topCells}
                            weekStartsOn={weekStartsOn}
                            dueCounts={dueCounts}
                            onResizeStart={startResize}
                          />
                        </div>
                        <div
                          ref={bodyRef}
                          className="relative flex flex-col"
                          style={{ minHeight: bodyMin }}
                        >
                          {/* The canvas under the rows: the grid, month lines, today. */}
                          <div
                            aria-hidden
                            className="timeline-grid pointer-events-none absolute inset-y-0"
                            data-unit={unit}
                            data-weekends={unit === "day" ? "" : undefined}
                            style={gridStyle}
                          >
                            {yearMonths.map((day) => (
                              <span
                                key={`m${day}`}
                                className="absolute inset-y-0 w-px bg-timeline-grid"
                                style={{ left: xOfDay(range, dw, day) }}
                              />
                            ))}
                            {strong.map((day) => (
                              <span
                                key={day}
                                className="absolute inset-y-0 w-px bg-timeline-grid-strong"
                                style={{ left: xOfDay(range, dw, day) }}
                              />
                            ))}
                            <span
                              data-timeline-today=""
                              className="absolute inset-y-0 w-px -translate-x-1/2 bg-primary"
                              style={{ left: dayCenterX(range, dw, today) }}
                            />
                          </div>
                          {/* The "waits on" lines, under the rows (70, 68b). */}
                          {depMode !== "off" ? (
                            <TimelineDepsLayer
                              relations={relations}
                              byId={taskById}
                              mode={depMode}
                              selected={lineSelection}
                              isHidden={isHidden}
                              pointDay={pointDay}
                              nameW={nameW}
                              bodyRef={bodyRef}
                              scrollerRef={scrollerRef}
                              layoutKey={rows}
                            />
                          ) : null}
                          <VirtualStack
                            items={rows}
                            itemKey={(row) => row.key}
                            estimateSize={(row) =>
                              row.kind === "area" || row.kind === "group" || row.kind === "section"
                                ? HEADER_ROW_GUESS
                                : ROW_GUESS
                            }
                            scrollRef={scrollerRef}
                            scrollMargin={size.header}
                            stickyIndexes={stickyIndexes}
                            stickyClassName="top-(--timeline-head-h) z-(--z-sticky)"
                            pinned={pinned}
                            scrollTo={scrollTo}
                            className="relative z-[1]"
                            render={(row, _index, place) => (
                              <TimelineRowItem
                                row={row}
                                selected={
                                  row.kind === "task" &&
                                  (row.task.id === selectedTaskId || selectedIds.has(row.task.id))
                                }
                                editable={canDragRow(row)}
                                contradiction={
                                  row.kind === "task" ? (lateMarks.get(row.task.id) ?? null) : null
                                }
                                stubs={
                                  row.kind === "task" && row.task.id === selectedTaskId
                                    ? stubs
                                    : null
                                }
                                cursor={row.key === cursorKey}
                                sticky={place.sticky}
                                canEdit={canEdit}
                                queued={row.kind === "task" && api.queuedTaskIds.has(row.task.id)}
                                hue={
                                  row.kind === "project"
                                    ? (row.project.color ?? null)
                                    : row.kind === "task"
                                      ? (hueById.get(row.task.bucketId) ?? null)
                                      : null
                                }
                                showRepeats={show.has("repeats")}
                                command={
                                  row.kind === "task" && command?.id === row.task.id
                                    ? command.command
                                    : null
                                }
                                editing={row.kind === "task" && editingId === row.task.id}
                                taskKey={taskKey}
                                handlers={handlers}
                                actions={rowActions}
                              />
                            )}
                          />
                          {/* Below the last row the name column runs on (its edge, its surface). */}
                          <div aria-hidden className="relative z-[1] flex flex-1">
                            <div
                              className={cn(
                                "sticky left-0 w-(--timeline-name-w) shrink-0 bg-card",
                                !nameColumn.hidden && "border-r border-hairline",
                              )}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </TimelineViewportContext.Provider>
                </TimelineWindowContext.Provider>
              </TimelineGeometryContext.Provider>
              {empty ? (
                <div
                  className="pointer-events-none absolute z-(--z-sticky) rounded-md bg-card/90 px-3 py-2"
                  style={{ left: nameW + 24, top: size.header + 16 }}
                >
                  {/* The rows stay listed, with today's line and one sentence (71). */}
                  <p className="font-sans text-sm text-foreground">
                    {tasks.length === 0 ? "No tasks here yet." : "Nothing has a date yet."}
                  </p>
                  <p className="font-sans text-xs text-muted-foreground">
                    {tasks.length === 0
                      ? "Tasks you give a date show up on the timeline."
                      : canDrag
                        ? "Click a day on a row, or open No date."
                        : "Tasks show up here once they have a date."}
                  </p>
                </div>
              ) : null}
            </div>
          </div>
          {writes.dialog}
          {drop.overlay}
        </TimelineCanvasContext.Provider>
      </StatusChoicesProvider>
    </ProjectChoicesProvider>
  );
}
