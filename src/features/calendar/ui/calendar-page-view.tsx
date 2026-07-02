// The rebuilt /calendar page. CAL-1: three-pane shell + Week/Day task-lens
// grid. CAL-2: native events end-to-end. CAL-3: the right panel becomes the
// switchable Tasks | Detail surface (the app-wide IA principle's seed),
// panel rows drag onto the grid via the universal drag contract, and task
// blocks drag/resize their schedule/duration. Task reads/ops ride the shipped
// Tasks lane; calendar reads degrade to empty pre-migration (AC13).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Button } from "../../../components/ui/button";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
import { asDragPayload } from "../../../lib/drag-payload";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { TasksModuleApi } from "../../tasks/hooks/use-tasks-module";
import { pointerWithin } from "@dnd-kit/core";

import { CaptureModal } from "../../tasks/ui/capture-modal";
import { TaskDetailPanel } from "../../tasks/ui/task-detail-panel";
import { dayGeometry } from "../grid-layout";
import {
  blocksByDay,
  localDayKey,
  parseDayKey,
  rangeLabel,
  startOfLocalDay,
  stepAnchor,
  taskBlocks,
  visibleRange,
  type CalendarView,
  type TaskBlock,
} from "../lens";
import { eventChipsInRange, type EventChip } from "../events";
import {
  useCalendarModule,
  type CalendarModuleApi,
} from "../hooks/use-calendar-module";
import {
  readCalendarPrefs,
  readPanelVariant,
  readViewState,
  writePanelVariant,
  writeViewState,
  type CalendarViewState,
  type PanelVariantId,
} from "../prefs";
import { CalendarGrid, type MoveEventDeltas, type MoveTaskResult } from "./calendar-grid";
import { CalendarRail } from "./calendar-rail";
import { CalendarTasksPanel } from "./calendar-tasks-panel";
import { CalendarToolbar } from "./calendar-toolbar";
import { EventDetailPanel } from "./event-detail-panel";
import { EventPopover } from "./event-popover";
import { RightPanelSwitcher, type RightPanelVariant } from "./right-panel-switcher";
import { TaskPopover } from "./task-popover";
import type { QuickCreateDraft } from "./event-quick-create";

type Props = {
  api: TasksModuleApi;
  runtime: ModuoRuntime | null;
  userId: string;
  workspaceId: string;
};

type EventPopoverState = { chip: EventChip; rect: DOMRect };
type TaskPopoverState = { block: TaskBlock; rect: DOMRect };
type DetailTarget = { type: "event" | "task"; id: string } | null;

/** Default duration when a drop schedules a task that has none (AC6). */
const DEFAULT_DROP_MINUTES = 30;
const DROP_SNAP_MINUTES = 15;

export function CalendarPageView({ api, runtime, userId, workspaceId }: Props) {
  const [viewState, setViewState] = useState<CalendarViewState>(() =>
    readViewState(userId, workspaceId),
  );
  // Workspace/user switch → that context's own remembered view.
  useEffect(() => {
    setViewState(readViewState(userId, workspaceId));
  }, [userId, workspaceId]);

  const prefs = useMemo(() => readCalendarPrefs(userId), [userId]);

  const calendar: CalendarModuleApi = useCalendarModule(runtime, {
    userId,
    workspaceId,
    modulePermission: api.canEdit ? "edit" : api.canRead ? "view" : "none",
  });

  const anchor = useMemo(
    () => parseDayKey(viewState.anchor) ?? startOfLocalDay(new Date()),
    [viewState.anchor],
  );
  const range = useMemo(
    () => visibleRange(viewState.view, anchor, prefs),
    [viewState.view, anchor, prefs],
  );
  const blocks = useMemo(() => taskBlocks(api.tasks, range), [api.tasks, range]);
  const grouped = useMemo(() => blocksByDay(blocks), [blocks]);
  const eventChips = useMemo(
    () => eventChipsInRange(calendar.events, range),
    [calendar.events, range],
  );
  const eventsById = useMemo(
    () => new Map(calendar.events.map((e) => [e.id, e])),
    [calendar.events],
  );

  // Mini-month density dots cover EVERY scheduled task + event day the
  // bundles know — the dots inform navigation to days you can't see.
  const busyDayKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const t of api.tasks) {
      if (!t.scheduledAt || t.status === "archived") continue;
      const d = new Date(t.scheduledAt);
      if (!Number.isNaN(d.getTime())) keys.add(localDayKey(d));
    }
    for (const e of calendar.events) {
      const d = new Date(e.startsAt);
      if (!Number.isNaN(d.getTime())) keys.add(localDayKey(d));
    }
    return keys;
  }, [api.tasks, calendar.events]);

  const update = useCallback(
    (next: CalendarViewState) => {
      setViewState(next);
      writeViewState(userId, workspaceId, next);
    },
    [userId, workspaceId],
  );

  const setView = useCallback(
    (view: CalendarView) => update({ ...viewState, view }),
    [update, viewState],
  );
  const goToday = useCallback(
    () => update({ ...viewState, anchor: localDayKey(new Date()) }),
    [update, viewState],
  );
  const step = useCallback(
    (dir: 1 | -1) =>
      update({
        ...viewState,
        anchor: localDayKey(stepAnchor(viewState.view, anchor, dir)),
      }),
    [update, viewState, anchor],
  );
  const goToDate = useCallback(
    (day: Date) => update({ ...viewState, anchor: localDayKey(day) }),
    [update, viewState],
  );

  // ── right panel: the switchable Tasks | Detail surface (AC11) ─────────────
  const [panelVariant, setPanelVariantState] = useState<PanelVariantId>(() =>
    readPanelVariant(userId, workspaceId),
  );
  const setPanelVariant = useCallback(
    (id: PanelVariantId) => {
      setPanelVariantState(id);
      writePanelVariant(userId, workspaceId, id);
    },
    [userId, workspaceId],
  );
  const [detailTarget, setDetailTarget] = useState<DetailTarget>(null);
  const [captureOpen, setCaptureOpen] = useState(false);

  const openDetail = useCallback(
    (target: NonNullable<DetailTarget>) => {
      setDetailTarget(target);
      setPanelVariant("detail");
      const state = readFeaturePanelState("calendar");
      if (!state.right) {
        dispatchLayoutPanelsSet({ feature: "calendar", left: state.left, right: true });
      }
    },
    [setPanelVariant],
  );

  // ── chip interaction state ─────────────────────────────────────────────────
  const [selectedOccurrenceKey, setSelectedOccurrenceKey] = useState<string | null>(null);
  const [eventPopover, setEventPopover] = useState<EventPopoverState | null>(null);
  const [taskPopover, setTaskPopover] = useState<TaskPopoverState | null>(null);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);

  const deleteEvent = deleteEventId ? (eventsById.get(deleteEventId) ?? null) : null;

  const onEventClick = useCallback((chip: EventChip, rect: DOMRect) => {
    setTaskPopover(null);
    setEventPopover({ chip, rect });
  }, []);
  const onTaskClick = useCallback((block: TaskBlock, rect: DOMRect) => {
    setEventPopover(null);
    setTaskPopover({ block, rect });
  }, []);

  const onCreateEvent = useCallback(
    (draft: QuickCreateDraft) => {
      void calendar.createEvent(draft);
    },
    [calendar],
  );

  const onMoveEvent = useCallback(
    (eventId: string, deltas: MoveEventDeltas) => {
      const event = eventsById.get(eventId);
      if (!event) return;
      // Occurrence deltas map onto the series anchor (v1 = series edits).
      const startsAt = new Date(
        new Date(event.startsAt).getTime() + deltas.startDeltaMs,
      ).toISOString();
      const endsAt = new Date(
        new Date(event.endsAt).getTime() + deltas.endDeltaMs,
      ).toISOString();
      void calendar.updateEvent(eventId, { startsAt, endsAt });
    },
    [calendar, eventsById],
  );

  // Task-block drag/resize writes the schedule — the same patch path the
  // Tasks detail panel uses, so Calendar and Tasks stay one truth (AC6).
  const onMoveTask = useCallback(
    (taskId: string, result: MoveTaskResult) => {
      api.patchTask(taskId, {
        scheduledAt: new Date(result.startMs).toISOString(),
        durationMinutes: result.durationMinutes,
      });
    },
    [api],
  );

  const confirmDelete = useCallback(() => {
    if (!deleteEventId) return;
    setDeleteEventId(null);
    setEventPopover(null);
    setDetailTarget((cur) =>
      cur?.type === "event" && cur.id === deleteEventId ? null : cur,
    );
    setSelectedOccurrenceKey(null);
    void calendar.deleteEvent(deleteEventId);
  }, [calendar, deleteEventId]);

  // ── drag-to-schedule (the universal drag contract, AC6) ───────────────────
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const dragTask = dragTaskId ? api.tasks.find((t) => t.id === dragTaskId) : null;

  // The drop slot needs the REAL pointer position: dnd-kit's `delta` folds
  // auto-scroll compensation in, so activator+delta drifts by the scrolled
  // amount whenever the grid auto-scrolls mid-drag. Track the pointer raw.
  const dragPointerRef = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!dragTaskId) return;
    const onMove = (e: PointerEvent) => {
      dragPointerRef.current = { x: e.clientX, y: e.clientY };
    };
    document.addEventListener("pointermove", onMove, { capture: true });
    return () => document.removeEventListener("pointermove", onMove, { capture: true });
  }, [dragTaskId]);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setDragTaskId(null);
      const pointer = dragPointerRef.current;
      dragPointerRef.current = null;
      const payload = asDragPayload(e.active.data.current);
      if (!payload || payload.entityType !== "task") return;
      const overId = e.over ? String(e.over.id) : "";
      if (!overId.startsWith("cal-day:")) return;
      const dayKey = overId.slice("cal-day:".length);
      const day = parseDayKey(dayKey);
      if (!day) return;
      const colEl = document.querySelector<HTMLElement>(
        `[data-day-col][data-day-key="${dayKey}"]`,
      );
      if (!colEl) return;
      const task = api.tasks.find((t) => t.id === payload.entityId);
      if (!task || !api.canEdit) return;
      const geom = dayGeometry(day);
      const rect = colEl.getBoundingClientRect();
      const activator = e.activatorEvent as PointerEvent | MouseEvent;
      const pointerY =
        pointer?.y ??
        (typeof activator?.clientY === "number" ? activator.clientY : rect.top) +
          e.delta.y;
      const frac = Math.min(Math.max((pointerY - rect.top) / rect.height, 0), 1);
      const rawMin = frac * geom.totalMinutes;
      // Duration clamps to the day so a fat-fingered estimate can't push the
      // start negative or paint past the grid bottom.
      const duration = Math.min(
        task.durationMinutes || DEFAULT_DROP_MINUTES,
        geom.totalMinutes,
      );
      const startMin = Math.min(
        Math.max(Math.round(rawMin / DROP_SNAP_MINUTES) * DROP_SNAP_MINUTES, 0),
        geom.totalMinutes - duration,
      );
      api.patchTask(task.id, {
        scheduledAt: new Date(geom.dayStartMs + startMin * 60_000).toISOString(),
        durationMinutes: duration,
      });
    },
    [api],
  );

  // Keyboard nav (AC1): T today · ←/→ period · D/W views · Delete on the
  // selected native chip. Handlers routed through a ref so the one listener
  // never captures stale state.
  const requestDelete = useCallback(
    (occKey: string | null) => {
      if (!occKey) return;
      const eventId = occKey.split(":")[0];
      const event = eventsById.get(eventId);
      if (event && event.sourceAccountId === null && calendar.canEdit) {
        setDeleteEventId(eventId);
      }
    },
    [eventsById, calendar.canEdit],
  );

  const keysRef = useRef({ setView, goToday, step, selectedOccurrenceKey, requestDelete });
  keysRef.current = { setView, goToday, step, selectedOccurrenceKey, requestDelete };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          // Don't steal keys from open overlays (menus typeahead on plain
          // character keys without preventDefault; dialogs own their focus).
          target.closest("[role='dialog'], [role='menu'], [role='listbox'], [role='combobox']"))
      ) {
        return;
      }
      const k = keysRef.current;
      switch (e.key) {
        case "t":
        case "T":
          k.goToday();
          break;
        case "d":
        case "D":
          k.setView("day");
          break;
        case "w":
        case "W":
          k.setView("week");
          break;
        case "ArrowLeft":
          k.step(-1);
          break;
        case "ArrowRight":
          k.step(1);
          break;
        case "Delete":
        case "Backspace":
          // Destructive keys act only from a neutral focus (the grid/body) —
          // never while an interactive element (a panel row, a toolbar
          // button) holds focus with a stale chip selection lingering.
          if (target?.closest("button, [role='button'], a, [tabindex]")) return;
          k.requestDelete(k.selectedOccurrenceKey);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const onToggleDone = useCallback(
    (taskId: string) => {
      const task = api.tasks.find((t) => t.id === taskId);
      if (task) api.toggleDone(task);
    },
    [api],
  );

  const popoverEvent = eventPopover
    ? (eventsById.get(eventPopover.chip.eventId) ?? null)
    : null;
  const sourceLabelFor = useCallback(
    (sourceAccountId: string | null): string | null => {
      if (!sourceAccountId) return null;
      const account = calendar.accounts.find((a) => a.id === sourceAccountId);
      return account ? `${account.displayLabel} — ${account.provider}` : null;
    },
    [calendar.accounts],
  );

  const detailTask =
    detailTarget?.type === "task"
      ? (api.tasks.find((t) => t.id === detailTarget.id) ?? null)
      : null;
  const detailEvent =
    detailTarget?.type === "event"
      ? (eventsById.get(detailTarget.id) ?? null)
      : null;

  const panelVariants = useMemo<RightPanelVariant[]>(
    () => [
      {
        id: "tasks",
        label: "Tasks",
        render: () => (
          <CalendarTasksPanel
            api={api}
            onOpenTask={(taskId) => openDetail({ type: "task", id: taskId })}
            onRequestCapture={() => setCaptureOpen(true)}
          />
        ),
      },
      {
        id: "detail",
        label: "Detail",
        render: () =>
          detailEvent ? (
            <EventDetailPanel
              runtime={runtime}
              workspaceId={workspaceId}
              currentUserId={userId}
              event={detailEvent}
              accounts={calendar.accounts}
              canEdit={calendar.canEdit}
              onPatch={(eventId, patch) => void calendar.updateEvent(eventId, patch)}
              onDeleteRequest={setDeleteEventId}
              onClose={() => setPanelVariant("tasks")}
            />
          ) : detailTask ? (
            <TaskDetailPanel
              task={detailTask}
              buckets={api.buckets}
              inbox={api.inbox}
              canEdit={api.canEdit}
              onRequestCapture={() => setCaptureOpen(true)}
              onSelectTask={(id) => setDetailTarget({ type: "task", id })}
              api={api}
            />
          ) : (
            <div className="grid h-full place-content-center px-3 text-center">
              <span className="text-sm text-muted-foreground">
                Select something on the calendar.
              </span>
            </div>
          ),
      },
    ],
    [
      api,
      calendar,
      detailEvent,
      detailTask,
      openDetail,
      runtime,
      setPanelVariant,
      userId,
      workspaceId,
    ],
  );

  return (
    <DndContext
      sensors={sensors}
      // pointerWithin ONLY: with a closest-center fallback, releasing a row
      // anywhere (over the panel, the rail, the headers) would resolve to the
      // nearest day column and silently schedule the task. Out-of-grid drops
      // must be a no-op cancel.
      collisionDetection={pointerWithin}
      onDragStart={(e) => {
        const payload = asDragPayload(e.active.data.current);
        setDragTaskId(payload?.entityType === "task" ? payload.entityId : null);
      }}
      onDragEnd={onDragEnd}
      onDragCancel={() => setDragTaskId(null)}
    >
      <FeaturePanelsShell
        feature="calendar"
        left={
          <CalendarRail
            anchor={anchor}
            onSelectDate={goToDate}
            busyDayKeys={busyDayKeys}
            prefs={prefs}
          />
        }
        right={
          <RightPanelSwitcher
            variants={panelVariants}
            activeId={panelVariant}
            onChange={(id) => setPanelVariant(id as PanelVariantId)}
          />
        }
        center={
          <div className="flex h-full min-h-0 flex-col">
            <CalendarToolbar
              view={viewState.view}
              label={rangeLabel(range)}
              onPrev={() => step(-1)}
              onNext={() => step(1)}
              onToday={goToday}
              onViewChange={setView}
            />
            <CalendarGrid
              view={viewState.view}
              days={range.days}
              blocksByDay={grouped}
              eventsByDay={eventChips.timed}
              allDayByDay={eventChips.allDay}
              prefs={prefs}
              loading={api.loading}
              error={api.error}
              onRetry={() => {
                void api.reload();
                void calendar.reload();
              }}
              canEdit={api.canEdit && calendar.canEdit}
              onToggleDone={onToggleDone}
              onCreateEvent={onCreateEvent}
              onMoveEvent={onMoveEvent}
              onMoveTask={onMoveTask}
              onEventClick={onEventClick}
              onTaskClick={onTaskClick}
              selectedOccurrenceKey={selectedOccurrenceKey}
              onSelectOccurrence={setSelectedOccurrenceKey}
            />
          </div>
        }
      />

      <DragOverlay dropAnimation={null}>
        {dragTask ? (
          <div className="w-44 truncate rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground">
            {dragTask.title}
          </div>
        ) : null}
      </DragOverlay>

      {eventPopover && popoverEvent ? (
        <EventPopover
          event={popoverEvent}
          occStartMs={eventPopover.chip.startMs}
          occEndMs={eventPopover.chip.endMs}
          anchorRect={eventPopover.rect}
          canEdit={calendar.canEdit}
          sourceLabel={sourceLabelFor(popoverEvent.sourceAccountId)}
          onOpenDetail={() => {
            setEventPopover(null);
            openDetail({ type: "event", id: popoverEvent.id });
          }}
          onDelete={() => {
            setEventPopover(null);
            setDeleteEventId(popoverEvent.id);
          }}
          onClose={() => setEventPopover(null)}
        />
      ) : null}

      {taskPopover ? (
        <TaskPopover
          block={taskPopover.block}
          anchorRect={taskPopover.rect}
          canEdit={api.canEdit}
          onToggleDone={() => {
            onToggleDone(taskPopover.block.taskId);
            setTaskPopover(null);
          }}
          onOpenDetail={() => {
            const id = taskPopover.block.taskId;
            setTaskPopover(null);
            openDetail({ type: "task", id });
          }}
          onClose={() => setTaskPopover(null)}
        />
      ) : null}

      <CaptureModal
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        buckets={api.buckets}
        inbox={api.inbox}
        defaultBucketId={api.inbox?.id ?? null}
        onCreate={api.createTask}
      />

      <Dialog open={deleteEvent !== null} onOpenChange={(open) => !open && setDeleteEventId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {deleteEvent?.rrule ? "Delete this repeating event?" : "Delete this event?"}
            </DialogTitle>
            <DialogDescription>
              {deleteEvent?.rrule
                ? "All occurrences go with it."
                : `"${deleteEvent?.title ?? ""}" will be removed from the calendar.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setDeleteEventId(null)}>
              Cancel
            </Button>
            <Button variant="destructive" size="sm" onClick={confirmDelete}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DndContext>
  );
}
