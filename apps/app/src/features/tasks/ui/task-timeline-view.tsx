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
// the handles (Edit in the workspace and, inside a project, on it; across
// projects a project shared view-only is refused by the server, TL2-14).

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

import { useTimeRegion } from "../../../lib/time-region";
import { cn } from "../../../lib/utils";
import { useAssignees } from "../assignees";
import { type CompletedMode, isCompletedHidden } from "../completed";
import { byIdOf } from "../derived";
import { type TasksDisplay, type TimelineShow, timelineScopeOf } from "../display";
import type { Bucket, Task, TaskRelation } from "../model";
import { PRIVATE_PROJECT_LABEL } from "../model";
import {
  useStatusesForBucket,
  useTaskCommands,
  useTasksReader,
  useTasksSelector,
  useTasksStatus,
  useTasksUserId,
} from "../tasks-context";
import { contradictions } from "../timeline-deps";
import {
  buildTimelineRows,
  type TimelineGroup,
  type TimelineRow,
  taskRowKey,
  timelineGroupsFor,
} from "../timeline-rows";
import {
  dayNumOfKey,
  topTier,
  weekCounts,
  weekdayOf,
  weekStartOf,
  xOfDay,
} from "../timeline-scale";
import { useToday } from "../use-today";
import type { PlanHeaderControls, PlanView } from "./plan-view-header";
import { PlanViewHeader } from "./plan-view-header";
import { ProjectChoicesProvider, StatusChoicesProvider } from "./project-choices";
import { useRowActions } from "./row-facts";
import type { TaskCommand } from "./task-context-menu";
import { TimelineEmptyNote, TimelineGrid } from "./timeline-canvas-parts";
import { depStubsFor } from "./timeline-dep-stubs";
import { TimelineDepsLayer } from "./timeline-deps-layer";
import { createCanvasStore, TimelineCanvasContext } from "./timeline-drag-store";
import { TimelineHeader } from "./timeline-header";
import { timelineKeyDown } from "./timeline-key-handler";
import {
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
import { TimelineToolbar } from "./timeline-toolbar";
import type { MultiSelect } from "./use-task-selection";
import { type CanvasLive, useTimelineCanvas } from "./use-timeline-canvas";
import { useTimelineDrop } from "./use-timeline-drop";
import { useTimelineFolds } from "./use-timeline-folds";
import { useTimelineNameColumn } from "./use-timeline-name-column";
import { useTimelineViewport } from "./use-timeline-viewport";
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
  /**
   * Across projects (All, My tasks): may this person move this project's or
   * section's dates? A project shared view-only shows no handles. Absent: all.
   */
  canDragIn?: (projectId: string) => boolean;
  /**
   * The same for a task: its project's answer, or its own (the assignee
   * keeps Edit on a task in a project they can only view). Absent: all.
   */
  canDragTask?: (task: Task) => boolean;
};

const EVERY_PROJECT = () => true;

const NO_IDS: ReadonlySet<string> = new Set();
const NO_RELATIONS: readonly TaskRelation[] = [];

/** A first guess at a row's height (VirtualStack measures each once drawn). */
const ROW_GUESS = 36;
const HEADER_ROW_GUESS = 28;

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
  canDragIn = EVERY_PROJECT,
  canDragTask = EVERY_PROJECT,
}: Props) {
  // What the Timeline reads from the Tasks module (A4): each slice on its own.
  const commands = useTaskCommands();
  const { patchTask } = commands;
  const read = useTasksReader();
  const { loading } = useTasksStatus();
  const archivedBuckets = useTasksSelector((d) => d.archivedBuckets);
  const archivedTasks = useTasksSelector((d) => d.archivedTasks);
  const allAreas = useTasksSelector((d) => d.areas);
  const attachmentCounts = useTasksSelector((_, snap) => snap.attachmentCounts);
  const moduleUserId = useTasksUserId();
  const queuedTaskIds = useTasksSelector((d) => d.queuedTaskIds);
  const allSections = useTasksSelector((d) => d.sections);
  const sessions = useTasksSelector((_, snap) => snap.sessions);
  const statuses = useTasksSelector((d) => d.statuses);
  const statusesForBucket = useStatusesForBucket();
  const taskRelations = useTasksSelector((d) => d.bundle.taskRelations);
  const liveTasks = useTasksSelector((d) => d.liveTasks);
  const scopeKey = inbox && selection === inbox.id ? "inbox" : selection;
  const scopeKind = useMemo(() => timelineScopeOf(scopeKey), [scopeKey]);
  // Drags need Edit (TV-TL2): the page works it out (`canDrag`); without one,
  // the workspace's Edit decides. The server still checks every write.
  const canDrag = canEdit && (canDragProp ?? true);
  const [canvas] = useState(createCanvasStore);
  const selectedIds = multiSelect?.ids ?? NO_IDS;
  const zoom = display.timelineZoom;
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
  const foldKey = `moduo:tasks:folds:${moduleUserId ?? "anon"}:${scopeKey}:timeline:${workspaceId}`;
  const { toggled, toggleRow, expanded } = useTimelineFolds(foldKey);

  // ── Rows ────────────────────────────────────────────────────────────────
  const projects = useMemo(
    () => (scopeKind.kind === "project" ? [...buckets, ...archivedBuckets] : buckets),
    [scopeKind.kind, buckets, archivedBuckets],
  );
  // A project's bar and progress count all its work, an archived one's too.
  const allTasks = useMemo(
    () => (scopeKind.kind === "project" ? [...liveTasks, ...archivedTasks] : liveTasks),
    [scopeKind.kind, liveTasks, archivedTasks],
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
  // A group header is a value: your own reads "You", as on the List (MOD-137).
  const personName = useCallback(
    (id: string) => {
      const person = personById(id);
      return person?.isMe ? person.name : person?.fullName || "Someone";
    },
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
        areas: allAreas,
        sections: allSections,
        sessions: sessions,
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
      allAreas,
      allSections,
      sessions,
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
  const { nameHidden, nameW, toggleNameColumn, startResize } = useTimelineNameColumn();

  // ── The scroller, its size, the range and the drawn window ─────────────
  const {
    dw,
    scrollerRef,
    headerRef,
    size,
    trackWidth,
    range,
    drawn,
    viewport,
    canvasW,
    pending,
    handleScroll,
    scrollToToday,
    changeZoom,
    scrollToDay,
  } = useTimelineViewport({
    today,
    extent: built.extent,
    scopeKey,
    loaded: !loading,
    zoom,
    nameW,
    display,
    onDisplayChange,
  });

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
  // Across projects, each row asks its own project (TV-TL2): a project shared
  // with you view-only has no handles, its tasks none either.
  const canMoveTask = useCallback(
    (task: Task) => canDrag && canDragTask(task),
    [canDrag, canDragTask],
  );
  const canDragRow = useCallback(
    (row: TimelineRow) =>
      row.kind === "task"
        ? canMoveTask(row.task)
        : canDrag &&
          (row.kind === "section"
            ? canDragIn(row.projectId)
            : row.kind === "project"
              ? canDragIn(row.project.id)
              : false),
    [canDrag, canDragIn, canMoveTask],
  );

  // ── Dependencies (70, 68b) ──────────────────────────────────────────────
  // Only the reader's own copy: a relation to a task they can't see draws nothing.
  const taskById = byIdOf(liveTasks);
  const relations = taskRelations ?? NO_RELATIONS;
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
    return depStubsFor({ self, relations, taskById, pointDay, isHidden, projectName });
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
  const writes = useTimelineWrites(zoom);
  const canvasLive = useRef<CanvasLive>({
    range,
    dw,
    nameW,
    rowOf: (key) => rowByKey.get(key),
    canDrag: canDragRow,
    canEditTask: (id) => {
      const task = taskById.get(id);
      return !!task && canMoveTask(task);
    },
    selection: selectedIds,
  });
  useLayoutEffect(() => {
    canvasLive.current = {
      range,
      dw,
      nameW,
      rowOf: (key) => rowByKey.get(key),
      canDrag: canDragRow,
      canEditTask: (id) => {
        const task = taskById.get(id);
        return !!task && canMoveTask(task);
      },
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
    onDrop: (id, day) => {
      const task = taskById.get(id);
      if (task && canMoveTask(task)) writes.placeTask(id, day);
    },
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
  // ⇧L opened this task's late mark (68b) from the keyboard; the cursor
  // moving on closes it.
  const [lateOpen, setLateOpen] = useState<{ id: string; at: string | null } | null>(null);
  if (lateOpen && lateOpen.at !== cursorKey) setLateOpen(null);
  const lateOpenId = lateOpen?.at === cursorKey ? lateOpen.id : null;
  const [editingId, setEditingId] = useState<string | null>(null);
  const refocus = useCallback(() => scrollerRef.current?.focus({ preventScroll: true }), []);
  const latest = useRef({
    onSelectTask,
    onOpenProject,
    toggleRow,
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
        const task = read().liveTasks.find((t) => t.id === id);
        if (next && task && next !== task.title) patchTask(id, { title: next });
        refocus();
      },
      requestCommand: (id, cmd) => setCommand({ id, command: cmd }),
      scrollToDay,
      clearCommand: () => setCommand(null),
      closeLate: () => {
        setLateOpen(null);
        refocus();
      },
      refocus,
    }),
    [refocus, scrollToDay, read, patchTask],
  );
  const rowActions = useRowActions(commands);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) =>
    timelineKeyDown(
      {
        scrollerRef,
        selectedIds,
        selectedTaskId,
        multiSelect,
        taskOrder,
        taskById,
        rowByKey,
        cursorKey,
        setCursorKey,
        moveCursor,
        canEdit,
        canDrag,
        canMoveTask,
        canDragRow,
        writes,
        rowActions,
        lateMarks,
        setCommand,
        setLateOpen: (open) => setLateOpen(open),
        pointDay,
        toggleRow,
        onSelectTask,
        onOpenTask,
        onOpenProject,
        onViewKey,
        scrollToToday,
        changeZoom,
        toggleNameColumn,
        zoom,
        range,
        dw,
        trackWidth,
        pending,
        display,
        onDisplayChange,
      },
      e,
    );

  // ── Geometry for the rows and marks ─────────────────────────────────────
  const geometry = useMemo<TimelineGeometry>(
    () => ({
      range,
      dw,
      zoom,
      today,
      colorBy: display.colorBy,
      nameHidden,
    }),
    [range, dw, zoom, today, display.colorBy, nameHidden],
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
    (bucketId: string) => statusesForBucket?.(bucketId) ?? [],
    [statusesForBucket],
  );
  const toggleUndated = () => {
    const next = showUndated
      ? display.timelineShow.filter((s) => s !== "undated")
      : [...display.timelineShow, "undated" as const];
    onDisplayChange({ ...display, timelineShow: next });
  };
  const empty = !built.hasMarks && !loading;

  return (
    <ProjectChoicesProvider projects={buckets} inboxId={inbox?.id ?? null}>
      <StatusChoicesProvider statusesFor={statusesFor} any={(statuses?.length ?? 0) > 0}>
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
            <TimelineToolbar
              undated={built.undated}
              showUndated={showUndated}
              onOpenNoDate={onOpenNoDate}
              onToggleUndated={toggleUndated}
              onToday={() => scrollToToday(true)}
              zoom={zoom}
              onZoom={changeZoom}
            />

            {/* Out to the centre's edges: its sides and foot are --panel-inset (MOD-121). */}
            <div className="relative -mx-(--panel-inset) -mb-(--panel-inset) min-h-0 flex-1 border-t border-hairline">
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
                      className="scrollbar-thin h-full overflow-auto overscroll-x-contain focus-visible:outline-none data-dragging:cursor-grabbing data-dragging:select-none data-dragging:**:cursor-grabbing"
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
                          <TimelineGrid
                            range={range}
                            dw={dw}
                            today={today}
                            unit={unit}
                            style={gridStyle}
                            yearMonths={yearMonths}
                            strong={strong}
                          />
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
                                lateOpen={row.kind === "task" && row.task.id === lateOpenId}
                                stubs={
                                  row.kind === "task" && row.task.id === selectedTaskId
                                    ? stubs
                                    : null
                                }
                                cursor={row.key === cursorKey}
                                sticky={place.sticky}
                                canEdit={canEdit}
                                queued={row.kind === "task" && queuedTaskIds.has(row.task.id)}
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
                                files={
                                  row.kind === "task"
                                    ? (attachmentCounts?.get(row.task.id) ?? 0)
                                    : 0
                                }
                              />
                            )}
                          />
                          {/* Below the last row the name column runs on (its edge, its surface). */}
                          <div aria-hidden className="relative z-[1] flex flex-1">
                            <div
                              className={cn(
                                "sticky left-0 w-(--timeline-name-w) shrink-0 bg-card",
                                !nameHidden && "border-r border-hairline",
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
                <TimelineEmptyNote
                  noTasks={tasks.length === 0}
                  canDrag={canDrag}
                  left={nameW + 24}
                  top={size.header + 16}
                />
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
