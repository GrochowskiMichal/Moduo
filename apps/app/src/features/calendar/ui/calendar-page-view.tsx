// The rebuilt /calendar page. CAL-1: three-pane shell + Week/Day task-lens
// grid. CAL-2: native events end-to-end. CAL-3: the right panel becomes the
// switchable Tasks | Detail surface (the app-wide IA principle's seed),
// panel rows drag onto the grid via the universal drag contract, and task
// blocks drag/resize their schedule/duration. Task reads/ops ride the shipped
// Tasks lane; calendar reads degrade to empty pre-migration (AC13).

import { DndContext, DragOverlay, pointerWithin } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useState } from "react";

import { dispatchOpenCapture } from "../../../components/app/capture-shell";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { RightPanel } from "../../../components/app/right-panel";
import { truncationNotice } from "../../../components/app/truncation-notice";
import { type CaptureSource, useCaptureSource } from "../../../lib/capture-source";
import { ENTITY_OPEN_EVENT } from "../../../lib/entity-open";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { stopFocusWithUndo } from "../../focus/stop-with-undo";
import { toggleFocusPause } from "../../focus/timer";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
import { LinkedNotesPanel } from "../../notes/ui/linked-notes-panel";
import {
  useTaskById,
  useTaskCommands,
  useTasksSelector,
  useTasksStatus,
} from "../../tasks/tasks-context";
import { TaskDetailPanel } from "../../tasks/ui/task-detail-panel";
import { useWorkspace } from "../../workspaces/workspace-context";
import { accountSourceLabel, hiddenIdsForSet, syncAgeLabel } from "../accounts";
import { isElapsedBlock } from "../elapsed";
import { followedEventId } from "../event-view";
import { type CalendarEventModel, type EventChip, eventChipsInRange } from "../events";
import { canFocusBlock } from "../focus";
import { type CalendarModuleApi, useCalendarModule } from "../hooks/use-calendar-module";
import { useCalendarPrefs } from "../hooks/use-calendar-prefs";
import { useCalendarSync } from "../hooks/use-calendar-sync";
import {
  blocksByDay,
  type CalendarView,
  dueChipsByDay,
  localDayKey,
  parseDayKey,
  rangeLabel,
  startOfLocalDay,
  stepAnchor,
  type TaskBlock,
  taskBlocks,
  visibleRange,
} from "../lens";
import { quickCreateCalendars } from "../new-events-to";
import {
  type CalendarViewState,
  type PanelVariantId,
  readPanelVariant,
  readViewState,
  writePanelVariant,
  writeViewState,
} from "../prefs";
import { type StripItem } from "../strip";
import { writableEvent } from "../writable";
import { BookingLinks } from "./booking-links";
import { CalendarAccountsDialog } from "./calendar-accounts-dialog";
import { CalendarComposer } from "./calendar-composer";
import { CalendarConnectDialog } from "./calendar-connect-dialog";
import { CalendarDeleteDialog } from "./calendar-delete-dialog";
import type { MoveEventDeltas } from "./calendar-grid";
import { CalendarRail } from "./calendar-rail";
import { CalendarStrip } from "./calendar-strip";
import { CalendarTasksPanel } from "./calendar-tasks-panel";
import { CalendarToolbar } from "./calendar-toolbar";
import { CalendarViews } from "./calendar-views";
import { CalendarsPanel } from "./calendars-panel";
import { EventDetailPanel } from "./event-detail-panel";
import { EventPopover } from "./event-popover";
import type { QuickCreateDraft } from "./event-quick-create";
import { FocusReadout } from "./focus-readout";
import { CalendarNowNext } from "./now-next";
import { OccurrenceScopeDialog } from "./occurrence-scope-dialog";
import { TaskPopover } from "./task-popover";
import { useCalendarAccountActions } from "./use-calendar-account-actions";
import { useCalendarCompletionLoop } from "./use-calendar-completion-loop";
import { useCalendarConnectReturn } from "./use-calendar-connect-return";
import { useCalendarEventDeepLink } from "./use-calendar-event-deep-link";
import { useCalendarFaults } from "./use-calendar-faults";
import { useCalendarFocus } from "./use-calendar-focus";
import { useCalendarHotkeys } from "./use-calendar-hotkeys";
import { useCalendarLens } from "./use-calendar-lens";
import { useCalendarNarrowPanels } from "./use-calendar-narrow-panels";
import { useCalendarShown } from "./use-calendar-shown";
import { useCalendarTaskDrag } from "./use-calendar-task-drag";
import { useCreateEvent } from "./use-create-event";
import { useEventDelete } from "./use-event-delete";
import { useEventMenu } from "./use-event-menu";
import { useEventMove } from "./use-event-move";
import { useOccurrenceQuestion } from "./use-occurrence-question";
import { usePlanPlacement } from "./use-plan-placement";
import { useScheduleDue } from "./use-schedule-due";

type Props = {
  runtime: ModuoRuntime | null;
  userId: string;
  workspaceId: string;
  /** Inbound `?event=` deep link (DF-2) — navigate to its day + select + open. */
  urlEventId?: string | null;
  /** Called once the deep link has been applied (or found stale) so the page
   * can clear the URL param. */
  onConsumeEventDeepLink?: () => void;
};

type EventPopoverState = { chip: EventChip; rect: DOMRect };
type TaskPopoverState = { block: TaskBlock; rect: DOMRect };
type DetailTarget = { type: "event" | "task"; id: string } | null;

/** The desktop app is the external-sync writer (CAL-6b); web only renders. */
const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function CalendarPageView({
  runtime,
  userId,
  workspaceId,
  urlEventId = null,
  onConsumeEventDeepLink,
}: Props) {
  // Tasks, read narrowly from the page's <TasksProvider> (A4).
  const commands = useTaskCommands();
  const { canEdit, canRead, loading, error } = useTasksStatus();
  const tasks = useTasksSelector((d) => d.liveTasks);
  const buckets = useTasksSelector((d) => d.buckets);
  const sessions = useTasksSelector((_, snap) => snap.sessions);
  const attachmentCounts = useTasksSelector((_, snap) => snap.attachmentCounts);

  const [viewState, setViewState] = useState<CalendarViewState>(() =>
    readViewState(userId, workspaceId),
  );
  // Workspace/user switch → that context's own remembered view.
  useEffect(() => {
    setViewState(readViewState(userId, workspaceId));
  }, [userId, workspaceId]);

  // Calendar prefs — reactive + cross-device synced (CAL-6b): working-hours,
  // week start, weekends, per-account visibility + colors ride the
  // user_preferences.calendar domain; view state stays per-device.
  const { prefs, updatePrefs } = useCalendarPrefs(userId);

  const calendar: CalendarModuleApi = useCalendarModule(runtime, {
    userId,
    workspaceId,
    modulePermission: canEdit ? "edit" : canRead ? "view" : "none",
  });

  const { accountHues, shownEvents, toggleAccountVisibility, busyDayKeys } = useCalendarShown(
    calendar,
    { prefs, updatePrefs },
    tasks,
    userId,
  );
  // Google syncs on the web. Outlook, CalDAV, and ICS still sync from the desktop app.
  const { syncNow } = useCalendarSync({
    runtime,
    workspaceId,
    accounts: calendar.accounts,
    events: calendar.events,
    enabled: Boolean(runtime && workspaceId),
    onSynced: () => void calendar.reload(),
  });

  // Back from connecting Google or Zoom; link signed-in Google accounts.
  useCalendarConnectReturn({ runtime, workspaceId, calendar });

  const {
    setAccountColor,
    removeAccount,
    reconnectTarget,
    setReconnectTarget,
    refreshing,
    refreshCalendars,
  } = useCalendarAccountActions({
    runtime,
    workspaceId,
    isDesktop: IS_DESKTOP,
    calendar,
    updatePrefs,
    syncNow,
    commands,
  });

  const anchor = useMemo(
    () => parseDayKey(viewState.anchor) ?? startOfLocalDay(new Date()),
    [viewState.anchor],
  );
  const range = useMemo(
    () => visibleRange(viewState.view, anchor, prefs),
    [viewState.view, anchor, prefs],
  );
  const lens = useCalendarLens({
    runtime,
    userId,
    workspaceId,
    events: shownEvents,
    range,
    accountHues,
  });
  // SCALE-1: the events read is windowed, so tell the hook what's on screen —
  // navigating past the loaded window widens it and refetches instead of
  // rendering a silently empty month.
  const { ensureRange } = calendar;
  useEffect(() => {
    ensureRange(new Date(range.startMs), new Date(range.endMs));
  }, [ensureRange, range.startMs, range.endMs]);

  // My work sessions are the blocks (TV-F6, AC2.3/AC7.3); due-only tasks sit in
  // the all-day lane.
  const blocks = useMemo(
    () => taskBlocks(tasks, range, { list: sessions, me: userId }),
    [tasks, sessions, range, userId],
  );
  const dueByDay = useMemo(
    () => dueChipsByDay(tasks, range, { list: sessions, me: userId }),
    [tasks, sessions, range, userId],
  );
  const grouped = useMemo(() => blocksByDay(blocks), [blocks]);
  // CALR-8: native events and Google events you connected change here; the rest are view only.
  const isWritable = useCallback(
    (event: CalendarEventModel) => writableEvent(event, calendar.accounts, userId) !== null,
    [calendar.accounts, userId],
  );
  const eventChips = useMemo(
    () => eventChipsInRange(lens.events, range, isWritable, userId),
    [lens.events, range, isWritable, userId],
  );
  const faults = useCalendarFaults({
    onRetry: refreshCalendars,
    retrying: refreshing,
    userId,
    workspaceId,
    accounts: calendar.accounts,
    events: calendar.events,
    degraded: calendar.degraded,
    loading: loading || calendar.loading,
    days: range.days,
    allDayByDay: eventChips.allDay,
  });
  const eventsById = useMemo(
    () => new Map(calendar.events.map((e) => [e.id, e])),
    [calendar.events],
  );

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

  // ── right panel: the switchable Tasks | Detail surface (AC11)
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

  // ── chip interaction state
  const [selectedOccurrenceKey, setSelectedOccurrenceKeyState] = useState<string | null>(null);
  // CALR-10: while Event or Notes is showing, it follows the selected event.
  const setSelectedOccurrenceKey = useCallback(
    (key: string | null) => {
      setSelectedOccurrenceKeyState(key);
      const id = followedEventId(key, panelVariant, readFeaturePanelState("calendar").right);
      if (id)
        setDetailTarget((cur) =>
          cur?.type === "event" && cur.id === id ? cur : { type: "event", id },
        );
    },
    [panelVariant],
  );
  const { members: workspaceMembers } = useWorkspace();
  const viewerMembers = useMemo(
    () =>
      workspaceMembers
        .filter((m) => m.isActive && !m.removedAt)
        .map((m) => ({ userId: m.userId, name: m.displayName || "Teammate" })),
    [workspaceMembers],
  );
  const [eventPopover, setEventPopover] = useState<EventPopoverState | null>(null);
  const [taskPopover, setTaskPopover] = useState<TaskPopoverState | null>(null);
  // CALR-4: a Moduo event deletes at once with Undo; a Google one confirms.
  const del = useEventDelete({
    eventsById,
    deleteEvent: calendar.deleteEvent,
    onDeleted: (id) => {
      setEventPopover(null);
      setDetailTarget((cur) => (cur?.type === "event" && cur.id === id ? null : cur));
      setSelectedOccurrenceKey(null);
    },
  });

  // CALR-11: a change to one occurrence of a repeat asks This event / All events.
  const occurrenceQuestion = useOccurrenceQuestion({
    eventsById,
    selectedOccurrenceKey,
    updateEvent: calendar.updateEvent,
    writeOccurrence: calendar.writeOccurrence,
    confirmDelete: del.request,
  });
  const { requestEventDelete, patchEvent, occurrenceStartOf } = occurrenceQuestion;

  // ── inbound `?event=` deep link (DF-2)
  useCalendarEventDeepLink({
    urlEventId,
    onConsumeEventDeepLink,
    calendar,
    goToDate,
    openDetail,
    setSelectedOccurrenceKey,
  });

  const onEventClick = useCallback(
    (chip: EventChip, rect: DOMRect) => {
      setTaskPopover(null);
      // The Event panel already follows the selection; the card is for when it
      // isn't showing (Notes follows the selection too, and keeps the card).
      if (
        panelVariant === "detail" &&
        followedEventId(chip.occurrenceKey, panelVariant, readFeaturePanelState("calendar").right)
      ) {
        setEventPopover(null);
        return;
      }
      setEventPopover({ chip, rect });
    },
    [panelVariant],
  );
  const onTaskClick = useCallback((block: TaskBlock, rect: DOMRect) => {
    setEventPopover(null);
    setTaskPopover({ block, rect });
  }, []);

  const createCalendars = useMemo(
    () => quickCreateCalendars(calendar.accounts, prefs, workspaceId),
    [calendar.accounts, prefs, workspaceId],
  );

  const onCreateEvent = useCreateEvent(calendar, runtime, workspaceId);

  const onMoveEvent = useCallback(
    (eventId: string, deltas: MoveEventDeltas, occurrence?: { startMs: number; endMs: number }) => {
      const event = eventsById.get(eventId);
      if (!event) return;
      if (occurrence && occurrenceQuestion.askMove(eventId, deltas, occurrence)) return;
      // Occurrence deltas map onto the series anchor (v1 = series edits).
      const startsAt = new Date(
        new Date(event.startsAt).getTime() + deltas.startDeltaMs,
      ).toISOString();
      const endsAt = new Date(new Date(event.endsAt).getTime() + deltas.endDeltaMs).toISOString();
      void calendar.updateEvent(eventId, { startsAt, endsAt });
    },
    [calendar, eventsById, occurrenceQuestion],
  );

  // ── drag-to-schedule (the universal drag contract, AC6)
  const drag = useCalendarTaskDrag({ tasks, sessions, canEdit: lens.edit(canEdit), commands });

  useCalendarNarrowPanels(setPanelVariant);
  const keys = useCalendarHotkeys({
    view: viewState.view,
    days: range.days,
    chips: eventChips,
    eventsById,
    canEdit: lens.edit(canEdit && calendar.canEdit),
    isWritable,
    prefs,
    workspaceId,
    panelVariant,
    selectedOccurrenceKey,
    select: (k) => lens.select(k) || setSelectedOccurrenceKey(k),
    setView,
    goToday,
    step,
    occurrence: occurrenceQuestion,
    onMoveEvent,
    createEvent: onCreateEvent,
    onEventClick: (c, r) => lens.select(c.occurrenceKey) || onEventClick(c, r),
    openDetail,
  });

  // CALR-4b: the right-click / ⌃↵ menu and the Event panel's ⋯.
  const moveEvent = useEventMove(calendar, runtime, workspaceId, userId);
  const { menu: eventMenu, panelMenu } = useEventMenu({
    chips: eventChips,
    eventsById,
    accounts: calendar.accounts,
    userId,
    canEdit: lens.edit(canEdit && calendar.canEdit),
    selectedOccurrenceKey,
    select: setSelectedOccurrenceKey,
    openDetail,
    patchEvent,
    requestEventDelete,
    copyChip: keys.copyChip,
    duplicateChip: keys.duplicateChip,
    moveEvent,
  });

  // CALR-2: Schedule (S) in a day header's due list.
  const onScheduleDue = useScheduleDue({
    tasks,
    prefs,
    commands,
    eventsByDay: eventChips.timed,
    blocksByDay: grouped,
  });

  // CALR-5: Plan's S lifts a task onto the grid; / finds a task.
  const plan = usePlanPlacement({
    tasks,
    view: viewState.view,
    days: range.days,
    prefs,
    commands,
    canEdit: lens.edit(canEdit),
    eventsByDay: eventChips.timed,
    blocksByDay: grouped,
    panelVariant,
    setPanelVariant,
    setView,
    goToDate,
    createEvent: calendar.createEvent,
  });

  const onToggleDone = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) commands.toggleDone(task);
    },
    [commands, tasks],
  );

  // ── the completion loop (CAL-4)
  const {
    nowTick,
    workedTaskIds,
    reviewMode,
    setReviewMode,
    strip,
    onTriageLater,
    onTriageLonger,
    onTriageRemove,
    rollForward,
    openReview,
  } = useCalendarCompletionLoop({
    tasks,
    sessions,
    userId,
    prefs,
    events: calendar.events,
    commands,
    setPanelVariant,
  });
  const { focus, focusBlockId, focusTaskRef, onStartFocus } = useCalendarFocus({
    blocks,
    nowTick,
    tasks,
    buckets,
    workspaceId,
    commands,
  });

  // Focus controls threaded to the popover.
  const onStopFocus = useCallback(() => stopFocusWithUndo(), []);

  const popoverEvent = eventPopover ? (eventsById.get(eventPopover.chip.eventId) ?? null) : null;
  const sourceLabelFor = useCallback(
    (sourceAccountId: string | null): string | null => {
      if (!sourceAccountId) return null;
      const account = calendar.accounts.find((a) => a.id === sourceAccountId);
      return account ? accountSourceLabel(account) : null;
    },
    [calendar.accounts],
  );

  const detailTask = useTaskById(detailTarget?.type === "task" ? detailTarget.id : null);
  const detailEvent =
    detailTarget?.type === "event" ? (eventsById.get(detailTarget.id) ?? null) : null;
  // An open event rides along on a capture as "From: …" (tasks-v3 call 93).
  const detailEventId = detailEvent?.id ?? null;
  const detailEventTitle = detailEvent ? detailEvent.title || "Event" : null;
  const captureSource = useMemo<CaptureSource | null>(
    () =>
      detailEventId && detailEventTitle
        ? { kind: "event", label: detailEventTitle, ref: { type: "event", id: detailEventId } }
        : null,
    [detailEventId, detailEventTitle],
  );
  useCaptureSource(captureSource);

  // The registered views (features/calendar/panel-views.ts), unchanged from the
  // old tabs: the menu lists Detail and Notes, then Tasks below the hairline.
  const panelViews = useMemo(
    () => ({
      tasks: () => (
        <CalendarTasksPanel
          userId={userId}
          weekStartsOn={prefs.weekStartsOn}
          selectedTaskId={plan.selectedTaskId}
          onSelectTask={plan.selectTask}
          liftedTaskId={plan.liftedTaskId}
          onLift={plan.lift}
          findRequest={plan.findRequest}
          onOpenTask={(taskId) => openDetail({ type: "task", id: taskId })}
          onRequestCapture={() => dispatchOpenCapture()}
          skeletonGroups={faults.loadShape.planGroups}
          onShape={faults.rememberPlanShape}
          review={
            reviewMode
              ? {
                  items: strip,
                  onMove: (taskIds) => {
                    const byId = new Map(strip.map((i) => [i.taskId, i]));
                    rollForward(
                      taskIds.map((id) => byId.get(id)).filter((i): i is StripItem => Boolean(i)),
                    );
                  },
                  onRemove: onTriageRemove,
                  onClose: () => setReviewMode(false),
                }
              : null
          }
        />
      ),
      detail: () =>
        detailEvent ? (
          <EventDetailPanel
            runtime={runtime}
            workspaceId={workspaceId}
            currentUserId={userId}
            event={detailEvent}
            accounts={calendar.accounts}
            canEdit={calendar.canEdit}
            writable={isWritable(detailEvent)}
            members={viewerMembers}
            onPatch={patchEvent}
            onDeleteRequest={requestEventDelete}
            onClose={() => setPanelVariant("tasks")}
            menu={panelMenu(detailEvent)}
          />
        ) : detailTask ? (
          <TaskDetailPanel
            task={detailTask}
            onRequestCapture={() => dispatchOpenCapture()}
            onSelectTask={(id) => setDetailTarget({ type: "task", id })}
            runtime={runtime}
            workspaceId={workspaceId}
          />
        ) : (
          <div className="grid h-full place-content-center px-3 text-center">
            <span className="text-sm text-muted-foreground">Select something on the calendar.</span>
          </div>
        ),
      // "Notes" rail (NO-7b, AC8): the notes linked to the selected event/task,
      // plus New-linked-note. Focus follows the same detail selection.
      notes: () => (
        <LinkedNotesPanel
          runtime={runtime}
          workspaceId={workspaceId}
          focus={detailTarget ? { type: detailTarget.type, id: detailTarget.id } : null}
          focusLabel={detailEvent?.title ?? detailTask?.title ?? undefined}
          focusIcon={
            detailTarget?.type === "event"
              ? "calendar"
              : detailTarget?.type === "task"
                ? "check-square"
                : null
          }
          canEdit={calendar.canEdit}
          onOpenNote={(id) =>
            window.dispatchEvent(
              new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: "note", id } }),
            )
          }
        />
      ),
    }),
    [
      calendar,
      detailTarget,
      detailEvent,
      detailTask,
      openDetail,
      runtime,
      setPanelVariant,
      userId,
      workspaceId,
      reviewMode,
      strip,
      rollForward,
      onTriageRemove,
      isWritable,
      viewerMembers,
      panelMenu,
      faults.loadShape.planGroups,
      faults.rememberPlanShape,
      prefs.weekStartsOn,
      plan.selectedTaskId,
      plan.selectTask,
      plan.liftedTaskId,
      plan.lift,
      plan.findRequest,
    ],
  );

  return (
    <DndContext
      sensors={drag.sensors}
      // pointerWithin ONLY: with a closest-center fallback, releasing a row
      // anywhere (over the panel, the rail, the headers) would resolve to the
      // nearest day column and silently schedule the task. Out-of-grid drops
      // must be a no-op cancel.
      collisionDetection={pointerWithin}
      onDragStart={drag.onDragStart}
      onDragEnd={drag.onDragEnd}
      onDragCancel={drag.onDragCancel}
    >
      <FeaturePanelsShell
        feature="calendar"
        notice={truncationNotice(calendar.truncated)}
        left={
          <CalendarRail
            anchor={anchor}
            onSelectDate={goToDate}
            busyDayKeys={busyDayKeys}
            prefs={prefs}
            onPrefs={updatePrefs}
            accounts={calendar.accounts}
            accountHues={accountHues}
            hiddenAccountIds={prefs.hiddenAccountIds}
            onToggleAccountVisibility={toggleAccountVisibility}
            onRecolorAccount={setAccountColor}
            onRemoveAccount={removeAccount}
            onReconnectAccount={IS_DESKTOP ? setReconnectTarget : undefined}
            footer={
              <>
                <CalendarsPanel
                  workspaceId={workspaceId}
                  userId={userId}
                  onShowAccounts={(visibleIds, knownIds) => {
                    const known = [...calendar.accounts.map((account) => account.id), ...knownIds];
                    updatePrefs(() => ({ hiddenAccountIds: hiddenIdsForSet(visibleIds, known) }));
                  }}
                />
                <BookingLinks
                  runtime={runtime}
                  workspaceId={workspaceId}
                  userId={userId}
                  accounts={calendar.accounts}
                />
              </>
            }
          />
        }
        right={
          <RightPanel
            module="calendar"
            views={panelViews}
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
              syncLabel={calendar.accounts.length > 0 ? syncAgeLabel(calendar.accounts) : null}
              onRefresh={calendar.accounts.length > 0 ? refreshCalendars : undefined}
              refreshing={refreshing}
              nowNext={
                <>
                  {lens.menu}
                  <CalendarNowNext
                    events={lens.events}
                    onOpen={(item) => {
                      setSelectedOccurrenceKey(item.occurrenceKey);
                      openDetail({ type: "event", id: item.eventId });
                    }}
                  />
                </>
              }
            />
            {faults.banner}
            <CalendarStrip
              count={strip.length}
              canEdit={canEdit}
              reviewing={reviewMode}
              onMoveToToday={() => rollForward(strip)}
              onReview={openReview}
            />
            {lens.top}
            <CalendarViews
              runtime={runtime}
              workspaceId={workspaceId}
              eventsById={eventsById}
              tasks={tasks}
              onOpenDay={(d) => update({ view: "day", anchor: localDayKey(d) })}
              view={viewState.view}
              days={range.days}
              blocksByDay={lens.tasks(grouped)}
              eventsByDay={eventChips.timed}
              allDayByDay={eventChips.allDay}
              dueByDay={lens.tasks(dueByDay)}
              onDueClick={(id) => openDetail({ type: "task", id })}
              onScheduleDue={canEdit ? onScheduleDue : undefined}
              fileCounts={attachmentCounts}
              prefs={prefs}
              loading={faults.loading}
              error={error}
              onRetry={() => {
                void commands.load();
                void calendar.reload();
              }}
              canEdit={lens.edit(canEdit && calendar.canEdit)}
              onToggleDone={onToggleDone}
              onCreateEvent={onCreateEvent}
              createCalendars={createCalendars}
              onMoveEvent={onMoveEvent}
              onMoveTask={drag.onMoveTask}
              onEventClick={(c, r) => lens.select(c.occurrenceKey) || onEventClick(c, r)}
              onTaskClick={onTaskClick}
              selectedOccurrenceKey={selectedOccurrenceKey}
              onSelectOccurrence={(k) => lens.select(k) || setSelectedOccurrenceKey(k)}
              accountHues={accountHues}
              workedTaskIds={workedTaskIds}
              onTriageLater={onTriageLater}
              onTriageLonger={onTriageLonger}
              onTriageRemove={onTriageRemove}
              focusBlockId={focusBlockId}
              staleAccountIds={faults.syncStatus.staleAccountIds}
              faulted={lens.faulted(faults.hideEmptyHint)}
              loadingAllDayRows={faults.loadShape.allDayRows}
              overlay={faults.firstWeekOverlay}
              cursor={keys.cursor}
              gridLayer={
                <>
                  {plan.layer}
                  {lens.layer}
                </>
              }
            />
          </div>
        }
      />

      <CalendarComposer
        calendar={calendar}
        runtime={runtime}
        workspaceId={workspaceId}
        userId={userId}
        prefs={prefs}
        members={viewerMembers}
        cursor={keys.cursor}
        canEdit={lens.edit(canEdit && calendar.canEdit)}
        createEvent={onCreateEvent}
      />
      <DragOverlay dropAnimation={null}>
        {drag.dragTask ? (
          <div className="w-44 truncate rounded-md border border-border bg-muted px-1.5 py-0.5 text-xs text-foreground">
            {drag.dragTask.title}
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
          writable={isWritable(popoverEvent)}
          sourceLabel={sourceLabelFor(popoverEvent.sourceAccountId)}
          onOpenDetail={() => {
            setEventPopover(null);
            openDetail({ type: "event", id: popoverEvent.id });
          }}
          onDelete={() => {
            setEventPopover(null);
            requestEventDelete(popoverEvent.id, eventPopover.chip.startMs);
          }}
          onClose={() => setEventPopover(null)}
        />
      ) : null}

      {taskPopover ? (
        <TaskPopover
          block={taskPopover.block}
          anchorRect={taskPopover.rect}
          canEdit={canEdit}
          elapsed={isElapsedBlock(taskPopover.block, nowTick)}
          worked={workedTaskIds.has(taskPopover.block.taskId)}
          canFocus={canFocusBlock(taskPopover.block, nowTick)}
          focusing={focus.taskId === taskPopover.block.taskId}
          focusRunning={focus.running && focus.taskId === taskPopover.block.taskId}
          focusReadout={focus.taskId === taskPopover.block.taskId ? <FocusReadout /> : null}
          onToggleDone={() => {
            onToggleDone(taskPopover.block.taskId);
            setTaskPopover(null);
          }}
          onLater={() => {
            onTriageLater(taskPopover.block.taskId, taskPopover.block.sessionId);
            setTaskPopover(null);
          }}
          onLonger={() => {
            onTriageLonger(taskPopover.block.taskId);
            setTaskPopover(null);
          }}
          onRemove={() => {
            onTriageRemove(taskPopover.block.taskId, taskPopover.block.sessionId);
            setTaskPopover(null);
          }}
          onStartFocus={() => onStartFocus(taskPopover.block.taskId)}
          onPauseFocus={() => toggleFocusPause(focusTaskRef)}
          onResumeFocus={() => toggleFocusPause(focusTaskRef)}
          onStopFocus={onStopFocus}
          onOpenDetail={() => {
            const id = taskPopover.block.taskId;
            setTaskPopover(null);
            openDetail({ type: "task", id });
          }}
          onClose={() => setTaskPopover(null)}
        />
      ) : null}

      {eventMenu}
      <OccurrenceScopeDialog {...occurrenceQuestion.dialog} />

      <CalendarDeleteDialog {...del.dialog} />

      {runtime && workspaceId ? (
        <CalendarConnectDialog
          open={reconnectTarget !== null}
          onOpenChange={(open) => {
            if (!open) setReconnectTarget(null);
          }}
          runtime={runtime}
          workspaceId={workspaceId}
          reconnect={reconnectTarget ?? undefined}
          onDone={() => void calendar.reload()}
        />
      ) : null}
      <CalendarAccountsDialog
        {...{ runtime, workspaceId, calendar, updatePrefs, syncNow }}
        isDesktop={IS_DESKTOP}
        hiddenAccountIds={prefs.hiddenAccountIds}
        newEventsTo={prefs.newEventsTo}
      />
    </DndContext>
  );
}
