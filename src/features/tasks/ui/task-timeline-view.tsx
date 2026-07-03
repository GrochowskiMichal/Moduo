import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  pointerWithin,
  useDraggable,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { differenceInCalendarDays, startOfDay } from "date-fns";
import { ChevronDown, ChevronRight, GripVertical } from "lucide-react";

import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { SegmentedControl } from "../../../components/ui/segmented-control";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import type { Bucket, Task } from "../model";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import {
  resolveBarDrag,
  resolveConnectorDrop,
  resolveTrayDrop,
  type BarDragMode,
  type TimelineDatePatch,
} from "../timeline-drag";
import {
  BAR_H,
  FADE_PX,
  HEADER_H,
  LANE_HEADER_H,
  TIMELINE_ZOOMS,
  TITLE_INSIDE_MIN_PX,
  arrowEndpoints,
  axisTicks,
  axisWindow,
  barForTask,
  barRowTop,
  buildTimelineRollup,
  dayAtX,
  layoutRows,
  monthSegments,
  todayLineX,
  xForDay,
  type AxisWindow,
  type TimelineBar,
  type TimelineZoom,
} from "../timeline-geometry";
import { asTaskDrag, asTaskDropTarget, taskDrag, useTaskDndSensors } from "./dnd/task-dnd";
import type { PlanView } from "./plan-view-header";
import { PlanViewHeader } from "./plan-view-header";
import { BlockedMarker } from "./task-row";

type Props = {
  tasks: Task[];
  scopeTitle: string;
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  zoom: TimelineZoom;
  onZoomChange: (zoom: TimelineZoom) => void;
  buckets: Bucket[];
  inbox: Bucket | null;
  canEdit: boolean;
  onRequestCapture: () => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  tagFilterControl?: ReactNode;
  activeTagFilters?: ReactNode;
  api: TasksModuleApi;
};

const ZOOM_LABELS: Record<TimelineZoom, string> = {
  week: "Week",
  month: "Month",
  quarter: "Quarter",
};

/** Pixels of pointer travel before a bar pointer-down becomes a drag (a plain
 * click still selects). Mirrors the dnd-kit sensors' 6px activation. */
const BAR_DRAG_SLOP_PX = 5;

/** Shared bar coloring — the solid span and its fade extension match. */
function barTone(done: boolean): string {
  return done ? "border-border/60 bg-muted/50" : "border-primary/35 bg-primary/10";
}

/** An in-flight connector-dot drag (AC8), in canvas coordinates. */
type ConnectorState = {
  fromId: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  targetId: string | null;
  valid: boolean;
};

export function TaskTimelineView({
  tasks,
  scopeTitle,
  view,
  onViewChange,
  zoom,
  onZoomChange,
  buckets,
  inbox,
  canEdit,
  onRequestCapture,
  selectedTaskId,
  onSelectTask,
  tagFilterControl,
  activeTagFilters,
  api,
}: Props) {
  // Lane collapse + tray visibility are transient view state (per mount);
  // only the zoom is a persisted preference (spec: Month default, persisted).
  const [collapsedLanes, setCollapsedLanes] = useState<ReadonlySet<string>>(new Set());
  const [trayOpen, setTrayOpen] = useState(true);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);

  // Minute tick so the today line drifts through the day like the calendar's.
  // The heavy geometry only cares about the local DAY — it memoizes on
  // `today`, so the tick re-renders two style offsets, not the whole rollup.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const todayMs = startOfDay(now).getTime();
  const today = useMemo(() => new Date(todayMs), [todayMs]);

  const win = useMemo(() => axisWindow(tasks, zoom, today), [tasks, zoom, today]);

  const laneDefs = useMemo(() => {
    const defs = inbox ? [{ id: inbox.id, name: "Inbox" }] : [];
    return [...defs, ...buckets.map((b) => ({ id: b.id, name: b.name }))];
  }, [inbox, buckets]);

  const rollup = useMemo(
    () =>
      buildTimelineRollup({ tasks, laneDefs, collapsedIds: collapsedLanes, window: win, now: today }),
    [tasks, laneDefs, collapsedLanes, win, today],
  );
  const layout = useMemo(() => layoutRows(rollup.lanes), [rollup.lanes]);
  const arrows = useMemo(
    () => arrowEndpoints(api.taskRelations, layout.barsByTask),
    [api.taskRelations, layout.barsByTask],
  );
  const ticks = useMemo(() => axisTicks(win), [win]);
  const months = useMemo(() => monthSegments(win), [win]);
  const todayX = todayLineX(win, now);
  const canvasW = win.totalDays * win.dayWidth;
  const datedCount = rollup.lanes.reduce((n, lane) => n + lane.count, 0);

  // ── Today recenter ──────────────────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const winRef = useRef(win);
  winRef.current = win;
  const centerToday = useCallback((smooth = false) => {
    const el = scrollRef.current;
    if (!el) return;
    const x = todayLineX(winRef.current, new Date());
    el.scrollTo({
      left: Math.max(0, x - el.clientWidth / 2),
      behavior: smooth ? "smooth" : "auto",
    });
  }, []);
  // Anchor the viewport to the same DATE when the window's origin shifts at
  // constant zoom (a scope/filter change or the midnight rollover moves
  // `win.start`) — otherwise a preserved pixel scrollLeft silently lands on a
  // different date range. Declared BEFORE the recenter effect so an absolute
  // recenter (zoom/load) always wins over the relative adjustment.
  const prevWinRef = useRef<{ start: Date; dayWidth: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    const prev = prevWinRef.current;
    prevWinRef.current = { start: win.start, dayWidth: win.dayWidth };
    if (!el || !prev || prev.dayWidth !== win.dayWidth) return;
    const deltaDays = differenceInCalendarDays(prev.start, win.start);
    if (deltaDays !== 0) el.scrollLeft += deltaDays * win.dayWidth;
  }, [win]);

  // Center on mount, on zoom change, and once the bundle lands (the window's
  // extent settles then). Not on every task edit — mid-scroll jumps are rude.
  const loaded = !api.loading;
  useLayoutEffect(() => {
    centerToday();
  }, [zoom, loaded, centerToday]);

  const toggleLane = useCallback((bucketId: string) => {
    setCollapsedLanes((prev) => {
      const next = new Set(prev);
      if (next.has(bucketId)) next.delete(bucketId);
      else next.add(bucketId);
      return next;
    });
  }, []);

  const highlightIds = useMemo(() => {
    const ids = new Set<string>();
    if (hoveredTaskId) ids.add(hoveredTaskId);
    if (selectedTaskId) ids.add(selectedTaskId);
    return ids;
  }, [hoveredTaskId, selectedTaskId]);

  // ── Writes (AC5/AC6) — everything goes through the optimistic patchTask ────
  const commitPatch = useCallback(
    (taskId: string, patch: TimelineDatePatch | null) => {
      if (patch) api.patchTask(taskId, patch);
    },
    [api],
  );

  // ── Tray → axis drag (dnd-kit; pointerWithin ONLY — an out-of-axis release
  // is a no-op, never a stray schedule). The drop DAY comes from raw pointer
  // COORDINATES resolved against a rect measured at that moment, never from
  // dnd-kit's delta (auto-scroll folds into it — gotchas.md). Keyboard drags
  // are disabled: they never produce coordinates, so a keyboard "lift" here
  // could only ever no-op (the detail panel's Schedule field is the
  // accessible path).
  const sensors = useTaskDndSensors({ sortable: false, keyboard: false });
  const [trayDragTask, setTrayDragTask] = useState<Task | null>(null);
  const [trayHoverDay, setTrayHoverDay] = useState<Date | null>(null);
  const lastPointerRef = useRef<{ x: number; y: number } | null>(null);
  const lanesElRef = useRef<HTMLDivElement | null>(null);
  const trayMoveCleanupRef = useRef<(() => void) | null>(null);

  /** The day under a viewport point, measured against the lanes rect NOW. */
  const dayAtPoint = useCallback((x: number, y: number): Date | null => {
    const el = lanesElRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const inside = x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    return inside ? dayAtX(winRef.current, x - rect.left) : null;
  }, []);

  const stopTrayTracking = useCallback(() => {
    trayMoveCleanupRef.current?.();
    trayMoveCleanupRef.current = null;
    lastPointerRef.current = null;
    setTrayHoverDay(null);
    setTrayDragTask(null);
  }, []);

  const onDragStart = useCallback(
    (e: DragStartEvent) => {
      const drag = asTaskDrag(e.active.data.current);
      if (!drag || drag.from !== "tray") return;
      const task = tasks.find((t) => t.id === drag.taskId) ?? null;
      setTrayDragTask(task);
      const onMove = (ev: globalThis.PointerEvent) => {
        lastPointerRef.current = { x: ev.clientX, y: ev.clientY };
        const day = dayAtPoint(ev.clientX, ev.clientY);
        setTrayHoverDay((prev) => (prev?.getTime() === day?.getTime() ? prev : day));
      };
      document.addEventListener("pointermove", onMove, { capture: true });
      trayMoveCleanupRef.current = () =>
        document.removeEventListener("pointermove", onMove, { capture: true });
    },
    [tasks, dayAtPoint],
  );

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      const target = asTaskDropTarget(e.over?.data.current);
      // Resolve the day AT DROP TIME with a fresh rect (mid-drag wheel scroll
      // moved the canvas under the pointer). Fallback for a flick-drop with
      // no tracked move yet: the activator point + dnd-kit's delta — safe
      // here because autoScroll is off, so delta is pure pointer travel.
      let point = lastPointerRef.current;
      if (!point && e.activatorEvent instanceof PointerEvent) {
        point = {
          x: e.activatorEvent.clientX + e.delta.x,
          y: e.activatorEvent.clientY + e.delta.y,
        };
      }
      const day = point ? dayAtPoint(point.x, point.y) : null;
      if (canEdit && trayDragTask && target?.type === "timeline-axis" && day) {
        commitPatch(trayDragTask.id, resolveTrayDrop(trayDragTask, day));
      }
      stopTrayTracking();
    },
    [canEdit, trayDragTask, commitPatch, stopTrayTracking, dayAtPoint],
  );

  // ── Connector-dot drag (AC8) — the dot on a blocker bar's end dragged onto
  // the bar it blocks. A document-level gesture (it crosses lanes); targets
  // are hit-tested by coordinates, validity comes from the pure resolver, and
  // self/duplicate/cycle drops are silent no-ops.
  const [connector, setConnector] = useState<ConnectorState | null>(null);
  const connectorRef = useRef<ConnectorState | null>(null);
  const connectorCleanupRef = useRef<(() => void) | null>(null);
  const relationsRef = useRef(api.taskRelations);
  relationsRef.current = api.taskRelations;
  const apiRef = useRef(api);
  apiRef.current = api;

  const startConnector = useCallback(
    (fromId: string, e: ReactPointerEvent<HTMLElement>) => {
      if (!canEdit || e.button !== 0) return;
      const lanes = lanesElRef.current;
      if (!lanes) return;
      e.stopPropagation(); // never also start the bar's own move/resize drag
      // A second dot press (multi-touch) tears the first gesture down instead
      // of orphaning its document listeners.
      connectorCleanupRef.current?.();
      connectorCleanupRef.current = null;

      const pointerId = e.pointerId;
      const setBoth = (next: ConnectorState | null) => {
        connectorRef.current = next;
        setConnector(next);
      };
      const toCanvas = (cx: number, cy: number) => {
        const rect = lanes.getBoundingClientRect();
        return { x: cx - rect.left, y: cy - rect.top };
      };
      const dotRect = e.currentTarget.getBoundingClientRect();
      const anchor = toCanvas(dotRect.left + dotRect.width / 2, dotRect.top + dotRect.height / 2);
      const lastClient = { x: e.clientX, y: e.clientY };
      setBoth({
        fromId,
        x1: anchor.x,
        y1: anchor.y,
        x2: anchor.x,
        y2: anchor.y,
        targetId: null,
        valid: false,
      });

      const hitTargetAt = (cx: number, cy: number): string | null =>
        (document.elementFromPoint(cx, cy) as HTMLElement | null)
          ?.closest?.("[data-timeline-drop]")
          ?.getAttribute("data-timeline-drop") ?? null;

      const cleanup = () => {
        connectorCleanupRef.current?.();
        connectorCleanupRef.current = null;
      };
      const cancel = () => {
        cleanup();
        setBoth(null);
      };
      const onMove = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        if (ev.buttons === 0) {
          cancel(); // lost the button outside the window — self-heal
          return;
        }
        lastClient.x = ev.clientX;
        lastClient.y = ev.clientY;
        const targetId = hitTargetAt(ev.clientX, ev.clientY);
        const p = toCanvas(ev.clientX, ev.clientY);
        setBoth({
          fromId,
          x1: anchor.x,
          y1: anchor.y,
          x2: p.x,
          y2: p.y,
          targetId,
          valid: !!resolveConnectorDrop(fromId, targetId, relationsRef.current),
        });
      };
      const onUp = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId !== pointerId) return;
        const active = connectorRef.current;
        cancel();
        if (!active) return;
        // The browser fires a click after this pointerup (dot and release
        // point share an ancestor) — swallow it so an aborted or committed
        // connector gesture never doubles as a selection click.
        const swallowClick = (ce: MouseEvent) => {
          ce.stopPropagation();
          ce.preventDefault();
          remove();
        };
        const remove = () => {
          document.removeEventListener("click", swallowClick, { capture: true });
          window.clearTimeout(timer);
        };
        document.addEventListener("click", swallowClick, { capture: true });
        const timer = window.setTimeout(remove, 150);
        // Re-hit-test AT RELEASE — a wheel scroll can move the canvas under a
        // stationary pointer without a pointermove (the TL-2 lesson).
        const targetId = hitTargetAt(ev.clientX ?? lastClient.x, ev.clientY ?? lastClient.y);
        const res = resolveConnectorDrop(active.fromId, targetId, relationsRef.current);
        // addBlocker(blockedTaskId, blockerTaskId) — the dot's bar blocks the target.
        if (res) apiRef.current.addBlocker(res.blockedTaskId, res.blockerTaskId);
      };
      const onKey = (ev: globalThis.KeyboardEvent) => {
        if (ev.key === "Escape") {
          // The drag consumed this Escape — don't also dismiss overlays.
          ev.preventDefault();
          ev.stopPropagation();
          cancel();
        }
      };
      document.addEventListener("pointermove", onMove, { capture: true });
      document.addEventListener("pointerup", onUp, { capture: true });
      document.addEventListener("pointercancel", cancel, { capture: true });
      window.addEventListener("keydown", onKey, { capture: true });
      connectorCleanupRef.current = () => {
        document.removeEventListener("pointermove", onMove, { capture: true });
        document.removeEventListener("pointerup", onUp, { capture: true });
        document.removeEventListener("pointercancel", cancel, { capture: true });
        window.removeEventListener("keydown", onKey, { capture: true });
      };
    },
    [canEdit],
  );

  // The whole component unmounts mid-drag if the scope switches — drop the
  // document listeners with it.
  useEffect(
    () => () => {
      trayMoveCleanupRef.current?.();
      connectorCleanupRef.current?.();
    },
    [],
  );

  const groupControl = (
    <div className="flex items-center gap-1.5">
      <Button size="sm" variant="ghost" onClick={() => centerToday(true)}>
        Today
      </Button>
      <SegmentedControl
        aria-label="Timeline zoom"
        size="sm"
        value={zoom}
        onValueChange={(value) => onZoomChange(value as TimelineZoom)}
        items={TIMELINE_ZOOMS.map((z) => ({ value: z, label: ZOOM_LABELS[z] }))}
      />
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PlanViewHeader
        title={scopeTitle}
        view={view}
        onViewChange={onViewChange}
        groupControl={groupControl}
        filterControl={tagFilterControl}
        activeFilters={activeTagFilters}
        canEdit={canEdit}
        onRequestCapture={onRequestCapture}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        autoScroll={false}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={stopTrayTracking}
      >
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="scrollbar-thin h-full overflow-auto">
            <div className="relative" style={{ width: canvasW }}>
              {/* Sticky two-row date header: month bands + ticks + the Today pill. */}
              <div
                className="sticky top-0 z-20 border-b border-border bg-background"
                style={{ height: HEADER_H }}
              >
                {/* Month bands: the label sticks to the viewport's left edge
                    while its band is in view, so month context never scrolls
                    away mid-month. */}
                {months.map((m) => (
                  <div
                    key={m.x}
                    className="absolute top-1 flex overflow-hidden"
                    style={{ left: m.x, width: m.width }}
                  >
                    <span className="sticky left-1 truncate pl-1 font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground">
                      {m.label}
                    </span>
                  </div>
                ))}
                {ticks.map((t) => (
                  <span
                    key={t.x}
                    className="absolute bottom-1 font-sans text-2xs tabular-nums text-muted-foreground/70"
                    style={{ left: t.x + 4 }}
                  >
                    {t.label}
                  </span>
                ))}
                <span
                  className="absolute bottom-0.5 -translate-x-1/2 rounded-full bg-primary px-1.5 py-px font-sans text-2xs font-medium text-primary-foreground"
                  style={{ left: todayX }}
                >
                  Today
                </span>
              </div>

              {/* Lanes region — gridlines + today line + swimlanes + arrows.
                  Also the ONE dnd-kit droppable for tray→axis scheduling. */}
              <LanesDropRegion
                lanesElRef={lanesElRef}
                canEdit={canEdit}
                minHeight={layout.totalHeight + 8}
              >
                {ticks.map((t) => (
                  <div
                    key={t.x}
                    className="absolute inset-y-0 w-px bg-border/40"
                    style={{ left: t.x }}
                    aria-hidden
                  />
                ))}
                <div
                  className="absolute inset-y-0 z-[1] w-px bg-primary/70"
                  style={{ left: todayX }}
                  aria-hidden
                />
                {/* Day wash under the dragged tray chip — where it will land. */}
                {trayDragTask && trayHoverDay ? (
                  <div
                    className="absolute inset-y-0 z-[1] bg-accent/40"
                    style={{ left: xForDay(win, trayHoverDay), width: win.dayWidth }}
                    aria-hidden
                  />
                ) : null}

                {rollup.lanes.map((lane) => (
                  <TimelineLaneBlock
                    key={lane.bucketId}
                    name={lane.name}
                    count={lane.count}
                    collapsed={lane.collapsed}
                    bars={lane.bars}
                    bodyHeight={layout.laneBodyHeights.get(lane.bucketId) ?? 0}
                    canEdit={canEdit}
                    win={win}
                    today={today}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={onSelectTask}
                    onHoverTask={setHoveredTaskId}
                    onToggle={() => toggleLane(lane.bucketId)}
                    onCommit={commitPatch}
                    onConnectorStart={startConnector}
                    connectorSourceId={connector?.fromId ?? null}
                    connectorTargetId={connector?.valid ? connector.targetId : null}
                    api={api}
                  />
                ))}

                {/* In-flight connector line — dashed, accent, arrowhead. */}
                {connector ? (
                  <svg
                    className="pointer-events-none absolute left-0 top-0 z-[5]"
                    width={canvasW}
                    height={layout.totalHeight}
                    aria-hidden
                  >
                    <defs>
                      <marker
                        id="tl-connector-arrow"
                        viewBox="0 0 8 8"
                        refX="7"
                        refY="4"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                      >
                        <path d="M0,0.5 L7.5,4 L0,7.5" fill="none" stroke="var(--primary)" />
                      </marker>
                    </defs>
                    <path
                      d={`M ${connector.x1} ${connector.y1} C ${connector.x1 + 32} ${connector.y1}, ${connector.x2 - 32} ${connector.y2}, ${connector.x2} ${connector.y2}`}
                      fill="none"
                      stroke="var(--primary)"
                      strokeWidth={1.5}
                      strokeDasharray={connector.valid ? undefined : "4 3"}
                      markerEnd="url(#tl-connector-arrow)"
                    />
                  </svg>
                ) : null}

                {/* Dependency arrows — one overlay, subtle at rest, highlighted
                    when either endpoint is hovered/selected (AC7). */}
                {arrows.length > 0 ? (
                  <svg
                    className="pointer-events-none absolute left-0 top-0 z-[3]"
                    width={canvasW}
                    height={layout.totalHeight}
                    aria-hidden
                  >
                    <defs>
                      <marker
                        id="tl-arrow"
                        viewBox="0 0 8 8"
                        refX="7"
                        refY="4"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                      >
                        <path d="M0,0.5 L7.5,4 L0,7.5" fill="none" stroke="var(--border)" />
                      </marker>
                      <marker
                        id="tl-arrow-hi"
                        viewBox="0 0 8 8"
                        refX="7"
                        refY="4"
                        markerWidth="7"
                        markerHeight="7"
                        orient="auto-start-reverse"
                      >
                        <path d="M0,0.5 L7.5,4 L0,7.5" fill="none" stroke="var(--primary)" />
                      </marker>
                    </defs>
                    {arrows.map((a) => {
                      const hi = highlightIds.has(a.blockerId) || highlightIds.has(a.blockedId);
                      const bend = Math.max(24, Math.min(56, Math.abs(a.x2 - a.x1) / 2));
                      return (
                        <path
                          key={`${a.blockerId}:${a.blockedId}`}
                          d={`M ${a.x1} ${a.y1} C ${a.x1 + bend} ${a.y1}, ${a.x2 - bend} ${a.y2}, ${a.x2} ${a.y2}`}
                          fill="none"
                          stroke={hi ? "var(--primary)" : "var(--border)"}
                          strokeWidth={hi ? 1.5 : 1}
                          markerEnd={hi ? "url(#tl-arrow-hi)" : "url(#tl-arrow)"}
                        />
                      );
                    })}
                  </svg>
                ) : null}
              </LanesDropRegion>
            </div>
          </div>

          {/* Empty axis — quiet hint, the tray below stays prominent (AC10). */}
          {datedCount === 0 && !api.loading ? (
            <div className="pointer-events-none absolute inset-x-0 top-16 z-10 flex justify-center">
              <span className="rounded-md bg-background/90 px-3 py-1.5 font-sans text-sm text-muted-foreground">
                {rollup.tray.length > 0
                  ? "Nothing on the timeline yet — drag a task up from the tray to schedule it."
                  : "No tasks in this scope yet."}
              </span>
            </div>
          ) : null}
        </div>

        {/* Unscheduled tray — collapsible bottom strip; chips drag onto a day. */}
        {rollup.tray.length > 0 ? (
          <div className="mt-2 shrink-0 rounded-md border border-border bg-card">
            <button
              type="button"
              aria-expanded={trayOpen}
              onClick={() => setTrayOpen((v) => !v)}
              className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {trayOpen ? (
                <ChevronDown className="size-3.5" aria-hidden />
              ) : (
                <ChevronRight className="size-3.5" aria-hidden />
              )}
              Unscheduled
              <span className="tabular-nums text-muted-foreground/70">{rollup.tray.length}</span>
            </button>
            {trayOpen ? (
              <div className="scrollbar-thin flex max-h-28 flex-wrap gap-1.5 overflow-y-auto px-2 pb-2">
                {rollup.tray.map((task) => (
                  <TrayChip
                    key={task.id}
                    task={task}
                    canEdit={canEdit}
                    selected={task.id === selectedTaskId}
                    onSelect={() => onSelectTask(task.id)}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {typeof document !== "undefined"
          ? createPortal(
              <DragOverlay>
                {trayDragTask ? (
                  <div className="flex max-w-56 items-center gap-1 truncate rounded-md border border-border bg-background px-2 py-1 font-sans text-xs text-foreground shadow-lg">
                    <GripVertical className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
                    <span className="truncate">{trayDragTask.title || "Untitled"}</span>
                  </div>
                ) : null}
              </DragOverlay>,
              document.body,
            )
          : null}
      </DndContext>
    </div>
  );
}

// ── The axis droppable (one region; the drop day comes from the raw pointer) ─

function LanesDropRegion({
  lanesElRef,
  canEdit,
  minHeight,
  children,
}: {
  lanesElRef: React.MutableRefObject<HTMLDivElement | null>;
  canEdit: boolean;
  minHeight: number;
  children: ReactNode;
}) {
  const { setNodeRef } = useDroppable({
    id: "timeline-axis",
    data: { type: "timeline-axis" },
    disabled: !canEdit,
  });
  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      setNodeRef(node);
      lanesElRef.current = node;
    },
    [setNodeRef, lanesElRef],
  );
  return (
    <div ref={setRefs} className="relative" style={{ minHeight }}>
      {children}
    </div>
  );
}

// ── Tray chip (drag source; grip only when editable) ─────────────────────────

function TrayChip({
  task,
  canEdit,
  selected,
  onSelect,
}: {
  task: Task;
  canEdit: boolean;
  selected: boolean;
  onSelect: () => void;
}) {
  // An optimistic `tmp-` id can't be written to the server yet — the chip
  // becomes draggable the moment the create round-trip mints the real id.
  const draggable = canEdit && !task.id.startsWith("tmp-");
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: `tray:${task.id}`,
    data: taskDrag(task.id, "tray"),
    disabled: !draggable,
  });
  // The browser fires a click on the chip after a drag's pointerup (dnd-kit
  // doesn't cancel it) — an aborted out-of-axis drag must stay a true no-op,
  // not turn into a surprise selection.
  const wasDraggedRef = useRef(false);
  if (isDragging) wasDraggedRef.current = true;
  return (
    <button
      ref={setNodeRef}
      {...listeners}
      type="button"
      onClick={() => {
        if (wasDraggedRef.current) {
          wasDraggedRef.current = false;
          return;
        }
        onSelect();
      }}
      className={cn(
        "flex max-w-56 items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-left font-sans text-xs text-foreground",
        "transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        draggable && "touch-none cursor-grab",
        isDragging && "opacity-50",
        selected && "ring-1 ring-ring/60",
      )}
    >
      {draggable ? (
        <GripVertical className="size-3 shrink-0 text-muted-foreground/60" aria-hidden />
      ) : null}
      <span className="truncate">{task.title || "Untitled"}</span>
    </button>
  );
}

// ── Lane block (header row + bar rows) ───────────────────────────────────────

function TimelineLaneBlock({
  name,
  count,
  collapsed,
  bars,
  bodyHeight,
  canEdit,
  win,
  today,
  selectedTaskId,
  onSelectTask,
  onHoverTask,
  onToggle,
  onCommit,
  onConnectorStart,
  connectorSourceId,
  connectorTargetId,
  api,
}: {
  name: string;
  count: number;
  collapsed: boolean;
  bars: TimelineBar[];
  bodyHeight: number;
  canEdit: boolean;
  win: AxisWindow;
  today: Date;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onHoverTask: (id: string | null) => void;
  onToggle: () => void;
  onCommit: (taskId: string, patch: TimelineDatePatch | null) => void;
  onConnectorStart: (taskId: string, e: ReactPointerEvent<HTMLElement>) => void;
  connectorSourceId: string | null;
  connectorTargetId: string | null;
  api: TasksModuleApi;
}) {
  return (
    <div>
      <div className="flex items-center" style={{ height: LANE_HEADER_H }}>
        {/* Sticky so the lane label stays readable while scrolling the axis. */}
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggle}
          className="sticky left-0 z-10 flex h-full items-center gap-1 bg-background pl-1 pr-3 font-sans text-2xs font-medium uppercase tracking-wide text-muted-foreground transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {collapsed ? (
            <ChevronRight className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
          <span className="max-w-48 truncate">{name}</span>
          <span className="tabular-nums text-muted-foreground/70">{count}</span>
        </button>
      </div>
      {!collapsed ? (
        <div className="relative" style={{ height: bodyHeight }}>
          {bars.map((bar, i) => (
            <TimelineBarRow
              key={bar.task.id}
              bar={bar}
              top={barRowTop(i)}
              canEdit={canEdit}
              win={win}
              today={today}
              selected={bar.task.id === selectedTaskId}
              onSelect={() => onSelectTask(bar.task.id)}
              onHover={onHoverTask}
              onCommit={onCommit}
              onConnectorStart={onConnectorStart}
              isConnectorSource={bar.task.id === connectorSourceId}
              isConnectorTarget={bar.task.id === connectorTargetId}
              api={api}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ── One bar: click selects; body-drag moves; edge-drag adjusts/sets a date ───

type BarDragState = {
  mode: BarDragMode;
  pointerId: number;
  /** The local DAY grabbed at pointerdown — day-based so a mid-drag window
   * origin shift (midnight tick, a collaborator extending the extent) can't
   * displace the delta the way canvas pixels would. */
  grabDay: Date;
  startClientX: number;
  /** The lane body — re-measured per move so mid-drag scrolling stays honest. */
  surface: HTMLElement;
  started: boolean;
  deltaDays: number;
  pointerDay: Date;
};

function TimelineBarRow({
  bar,
  top,
  canEdit,
  win,
  today,
  selected,
  onSelect,
  onHover,
  onCommit,
  onConnectorStart,
  isConnectorSource,
  isConnectorTarget,
  api,
}: {
  bar: TimelineBar;
  top: number;
  canEdit: boolean;
  win: AxisWindow;
  today: Date;
  selected: boolean;
  onSelect: () => void;
  onHover: (id: string | null) => void;
  onCommit: (taskId: string, patch: TimelineDatePatch | null) => void;
  onConnectorStart: (taskId: string, e: ReactPointerEvent<HTMLElement>) => void;
  isConnectorSource: boolean;
  isConnectorTarget: boolean;
  api: TasksModuleApi;
}) {
  const { task } = bar;
  const blocked = api.blockedTaskIds.has(task.id);

  // ── Pointer drag engine (custom — continuous day-snapped drags fit dnd-kit's
  // discrete droppables badly; spec §Assumptions). Three exits per gotchas.md:
  // pointerup, pointercancel, and buttons===0 self-heal on move.
  const dragRef = useRef<BarDragState | null>(null);
  const [drag, setDrag] = useState<BarDragState | null>(null);
  const suppressClickRef = useRef(false);

  const endDrag = useCallback(
    (commit: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      if (!d?.started) return;
      // Only a pointerup produces a follow-up click to swallow; a cancelled
      // drag (pointercancel / lost capture / buttons-0 self-heal) never
      // clicks, and a stale flag would eat the NEXT genuine click.
      if (commit) {
        suppressClickRef.current = true;
        onCommit(
          task.id,
          resolveBarDrag(task, d.mode, { deltaDays: d.deltaDays, pointerDay: d.pointerDay }),
        );
      }
    },
    [onCommit, task],
  );

  // Escape cancels an in-flight drag (the preview snaps back, nothing writes).
  useEffect(() => {
    if (!drag?.started) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") endDrag(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drag?.started, endDrag]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    suppressClickRef.current = false; // a fresh press always re-arms the click
    if (!canEdit || e.button !== 0) return;
    // The checkbox (and any future in-bar control) owns its own pointer.
    if ((e.target as HTMLElement).closest("button")) return;
    const barEl = e.currentTarget;
    const surface = barEl.offsetParent as HTMLElement | null;
    if (!surface) return;
    const rect = barEl.getBoundingClientRect();
    const offsetX = e.clientX - rect.left;
    const zone = Math.min(8, rect.width / 3);
    const mode: BarDragMode =
      offsetX < zone ? "start" : offsetX > rect.width - zone ? "end" : "move";
    const surfaceRect = surface.getBoundingClientRect();
    try {
      barEl.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers (tests) have no active id to capture — the move/up
      // handlers still receive bubbled events, so the drag works regardless.
    }
    const state: BarDragState = {
      mode,
      pointerId: e.pointerId,
      grabDay: dayAtX(win, e.clientX - surfaceRect.left),
      startClientX: e.clientX,
      surface,
      started: false,
      deltaDays: 0,
      pointerDay: bar.startDay,
    };
    dragRef.current = state;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    if (e.buttons === 0) {
      // Lost the button outside the window — self-heal, never a stuck ghost.
      endDrag(false);
      return;
    }
    if (!d.started && Math.abs(e.clientX - d.startClientX) < BAR_DRAG_SLOP_PX) return;
    const surfaceRect = d.surface.getBoundingClientRect();
    // Day-based delta: window-clamped on both ends, immune to origin shifts.
    const pointerDay = dayAtX(win, e.clientX - surfaceRect.left);
    const deltaDays = differenceInCalendarDays(pointerDay, d.grabDay);
    if (
      !d.started ||
      deltaDays !== d.deltaDays ||
      pointerDay.getTime() !== d.pointerDay.getTime()
    ) {
      const next = { ...d, started: true, deltaDays, pointerDay };
      dragRef.current = next;
      setDrag(next);
    }
  };

  // Preview: render the bar exactly where a release would put it — the preview
  // task runs through the same resolver + geometry as the commit, clamps
  // included, so what you see is what gets written.
  const displayBar = useMemo(() => {
    if (!drag?.started) return bar;
    const patch = resolveBarDrag(task, drag.mode, {
      deltaDays: drag.deltaDays,
      pointerDay: drag.pointerDay,
    });
    if (!patch) return bar;
    return barForTask({ ...task, ...patch }, win, today) ?? bar;
  }, [drag, bar, task, win, today]);

  // The INTERACTIVE element is the solid span only — the fade extension is a
  // separate pointer-events-none layer, so the visually-empty faded tail is
  // never an invisible click/drag surface. Dragging the solid span's edge on
  // the open side is the "faded edge" gesture (sets the missing date).
  const solidX = displayBar.x + (displayBar.solidLeft ? 0 : FADE_PX);
  const solidW =
    displayBar.width -
    (displayBar.solidLeft ? 0 : FADE_PX) -
    (displayBar.solidRight ? 0 : FADE_PX);
  const edgeZonePx = Math.min(8, solidW / 3);

  // Content lives inside the bar only when both edges are solid and the bar
  // is wide enough; otherwise the whole cluster — checkbox included — renders
  // beside the bar, past the fade.
  const labelInside =
    displayBar.solidLeft && displayBar.solidRight && solidW >= TITLE_INSIDE_MIN_PX;

  // One content cluster for both placements: check-off, title, lock, drift dot.
  // The checkbox is the row's native keyboard stop (Board parity — bars, like
  // cards, are mouse-selection surfaces; List remains the keyboard-first view).
  const meta = (
    <>
      <CompleteToggle done={bar.done} disabled={!canEdit} onToggle={() => api.toggleDone(task)} />
      <span
        className={cn(
          "min-w-0 truncate font-sans text-xs",
          bar.done
            ? "text-muted-foreground line-through"
            : blocked
              ? "text-muted-foreground"
              : "text-foreground",
          labelInside && "flex-1",
        )}
      >
        {task.title || "Untitled"}
      </span>
      {blocked ? <BlockedMarker taskId={task.id} api={api} /> : null}
      {bar.pastEnd ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="size-1.5 shrink-0 rounded-full bg-foreground/50"
              aria-label="Past its date — still open"
            />
          </TooltipTrigger>
          <TooltipContent>Past its date — still open</TooltipContent>
        </Tooltip>
      ) : null}
    </>
  );

  const interactive = {
    onClick: () => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      onSelect();
    },
    onMouseEnter: () => onHover(task.id),
    onMouseLeave: () => onHover(null),
  };

  const fadeExtMask = displayBar.solidRight
    ? "linear-gradient(to right, transparent 0, black 100%)" // fade-in toward the due day
    : "linear-gradient(to right, black 0, transparent 100%)"; // fade-out past the start

  return (
    <>
      {/* Fade extension — pure paint, never a pointer target. */}
      {!(displayBar.solidLeft && displayBar.solidRight) ? (
        <div
          className={cn(
            "pointer-events-none absolute z-[2] border",
            displayBar.solidRight ? "border-r-0" : "border-l-0",
            barTone(bar.done),
          )}
          style={{
            left: displayBar.solidLeft ? solidX + solidW : displayBar.x,
            top,
            width: FADE_PX,
            height: BAR_H,
            maskImage: fadeExtMask,
            WebkitMaskImage: fadeExtMask,
          }}
          aria-hidden
        />
      ) : null}
      <div
        {...interactive}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        onLostPointerCapture={() => endDrag(false)}
        data-timeline-bar={task.id}
        data-timeline-drop={task.id}
        className={cn(
          "group/bar absolute z-[2] flex select-none items-center gap-1.5 border px-1.5",
          displayBar.solidLeft ? "rounded-l-md" : "rounded-l-none border-l-0",
          displayBar.solidRight ? "rounded-r-md" : "rounded-r-none border-r-0",
          "transition-colors duration-(--motion-fade) ease-(--ease-out)",
          drag?.started ? "z-[4] cursor-grabbing" : canEdit ? "cursor-grab" : "cursor-pointer",
          barTone(bar.done),
          !bar.done && "hover:bg-primary/15",
          selected && "ring-2 ring-ring/60",
          // A valid connector target lights up quietly; invalid ones stay mute.
          isConnectorTarget && "ring-2 ring-primary/70",
        )}
        style={{ left: solidX, top, width: solidW, height: BAR_H }}
      >
        {/* Edge cursor affordances — sized exactly like the drag hit zones. */}
        {canEdit ? (
          <>
            <div
              className="absolute inset-y-0 left-0 cursor-ew-resize"
              style={{ width: edgeZonePx }}
              aria-hidden
            />
            <div
              className="absolute inset-y-0 right-0 cursor-ew-resize"
              style={{ width: edgeZonePx }}
              aria-hidden
            />
            {/* Connector dot (AC8) — hover-revealed at the bar's end; drag it
                onto another bar to make this task block that one. Mouse
                gesture only (the detail panel's Add blocker is the keyboard
                path), and never on a done bar — a completed task can't block
                anything, so offering the gesture would draw inert arrows. */}
            {!bar.done ? (
              <span
                onPointerDown={(e) => onConnectorStart(task.id, e)}
                className={cn(
                  "absolute -right-1.5 top-1/2 z-[5] size-3 -translate-y-1/2 cursor-crosshair rounded-full border border-primary bg-background",
                  "opacity-0 transition-opacity duration-(--motion-fade) ease-(--ease-out) group-hover/bar:opacity-100",
                  isConnectorSource && "opacity-100",
                )}
                aria-hidden
              />
            ) : null}
          </>
        ) : null}
        {labelInside ? meta : null}
      </div>
      {!labelInside ? (
        <div
          {...interactive}
          data-timeline-drop={task.id}
          className="absolute z-[2] flex max-w-64 cursor-pointer items-center gap-1.5 rounded-md px-1"
          style={{ left: displayBar.x + displayBar.width + 6, top, height: BAR_H }}
        >
          {meta}
        </div>
      ) : null}
    </>
  );
}
