// The rebuilt /calendar page. CAL-1: three-pane shell + Week/Day task-lens
// grid. CAL-2: native events end-to-end. CAL-3: the right panel becomes the
// switchable Tasks | Detail surface (the app-wide IA principle's seed),
// panel rows drag onto the grid via the universal drag contract, and task
// blocks drag/resize their schedule/duration. Task reads/ops ride the shipped
// Tasks lane; calendar reads degrade to empty pre-migration (AC13).

import {
  DndContext,
  type DragEndEvent,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import {
  RightPanelSwitcher,
  type RightPanelVariant,
} from "../../../components/app/right-panel-switcher";
import { truncationNotice } from "../../../components/app/truncation-notice";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { asDragPayload } from "../../../lib/drag-payload";
import { ENTITY_OPEN_EVENT, takeEntityOpenIntent } from "../../../lib/entity-open";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { UNDO_TOAST_MS } from "../../../lib/undo-toast";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
import { LinkedNotesPanel } from "../../notes/ui/linked-notes-panel";
import type { TasksModuleApi } from "../../tasks/hooks/use-tasks-module";
import { CaptureModal } from "../../tasks/ui/capture-modal";
import { TaskDetailPanel } from "../../tasks/ui/task-detail-panel";
import { accountSourceLabel, resolveAccountHues, syncAgeLabel, visibleEvents } from "../accounts";
import { cleanupCredentialsForRemoval } from "../caldav-connect";
import { CONNECT_FINISHED_EVENT, connectDoneMessage, takeConnectNotice } from "../connect-return";
import { isElapsedBlock } from "../elapsed";
import type { CalendarAccountModel } from "../events";
import { type EventChip, eventChipsInRange } from "../events";
import { canFocusBlock, loggedMessage } from "../focus";
import { type BusyInterval, findNextGap } from "../gap-finder";
import { ensureGoogleCalendarAccounts, pushGoogleWebEvent } from "../google-web";
import { dayGeometry } from "../grid-layout";
import { useBlockFocus } from "../hooks/use-block-focus";
import { type CalendarModuleApi, useCalendarModule } from "../hooks/use-calendar-module";
import { useCalendarPrefs } from "../hooks/use-calendar-prefs";
import { useCalendarSync } from "../hooks/use-calendar-sync";
import {
  blocksByDay,
  type CalendarView,
  DEFAULT_BLOCK_MINUTES,
  localDayKey,
  parseDayKey,
  rangeLabel,
  startOfLocalDay,
  stepAnchor,
  type TaskBlock,
  taskBlocks,
  visibleRange,
} from "../lens";
import { mapGoogleEvent } from "../mirror";
import {
  type CalendarViewState,
  type PanelVariantId,
  readPanelVariant,
  readViewState,
  writePanelVariant,
  writeViewState,
} from "../prefs";
import { expandEventOccurrences } from "../recurrence-expand";
import {
  planRollForward,
  type RollContext,
  rollForwardMessage,
  undoRollForward,
} from "../roll-forward";
import { resolveCalendarDeepLink } from "../search";
import { type StripItem, stripItems } from "../strip";
import { tookLongerDeltaSeconds } from "../triage";
import { BookingLinks } from "./booking-links";
import { CalendarConnectDialog } from "./calendar-connect-dialog";
import { CalendarGrid, type MoveEventDeltas, type MoveTaskResult } from "./calendar-grid";
import { CalendarRail } from "./calendar-rail";
import { CalendarStrip } from "./calendar-strip";
import { CalendarTasksPanel } from "./calendar-tasks-panel";
import { CalendarToolbar } from "./calendar-toolbar";
import { CalendarsPanel } from "./calendars-panel";
import { EventDetailPanel } from "./event-detail-panel";
import { EventPopover } from "./event-popover";
import type { QuickCreateDraft } from "./event-quick-create";
import { FocusReadout } from "./focus-readout";
import { TaskPopover } from "./task-popover";
import { formatTimeOfDay } from "./time-format";

type Props = {
  api: TasksModuleApi;
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

/** Default duration when a drop schedules a task that has none (AC6). */
const DEFAULT_DROP_MINUTES = 30;
const DROP_SNAP_MINUTES = 15;
/** The desktop app is the external-sync writer (CAL-6b); web only renders. */
const IS_DESKTOP = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function CalendarPageView({
  api,
  runtime,
  userId,
  workspaceId,
  urlEventId = null,
  onConsumeEventDeepLink,
}: Props) {
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
    modulePermission: api.canEdit ? "edit" : api.canRead ? "view" : "none",
  });

  // Attribution: each account's bounded hue + the visibility filter (§3a).
  const accountHues = useMemo(
    () => resolveAccountHues(calendar.accounts, prefs.accountColors),
    [calendar.accounts, prefs.accountColors],
  );
  const shownEvents = useMemo(
    () => visibleEvents(calendar.events, prefs.hiddenAccountIds),
    [calendar.events, prefs.hiddenAccountIds],
  );
  const toggleAccountVisibility = useCallback(
    (accountId: string) => {
      updatePrefs((prev) => {
        const hidden = new Set(prev.hiddenAccountIds);
        if (hidden.has(accountId)) hidden.delete(accountId);
        else hidden.add(accountId);
        return { hiddenAccountIds: [...hidden] };
      });
    },
    [updatePrefs],
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

  // Back from connecting Google or Zoom: say when it didn't take, and ask first
  // when this tab didn't start it (see connect-return.ts).
  const [connectTick, setConnectTick] = useState(0);
  useEffect(() => {
    const onConnected = () => setConnectTick((tick) => tick + 1);
    window.addEventListener(CONNECT_FINISHED_EVENT, onConnected);
    void takeConnectNotice().then((outcome) => {
      if (outcome?.status === "failed") toast.error(outcome.message);
      if (outcome?.status !== "confirm") return;
      toast(outcome.title, {
        description: "Only if you started connecting it, here or in the Moduo app.",
        duration: Number.POSITIVE_INFINITY,
        action: {
          label: "Connect",
          onClick: () =>
            void outcome.confirm().then((done) => {
              if (done.status === "failed") toast.error(done.message);
              else toast(connectDoneMessage(done.provider));
            }),
        },
        cancel: { label: "Not now", onClick: () => {} },
      });
    });
    return () => window.removeEventListener(CONNECT_FINISHED_EVENT, onConnected);
  }, []);

  const accountKey = calendar.accounts
    .map((account) => `${account.externalId}:${account.deletedAt ?? ""}`)
    .join("|");
  const accountsRef = useRef(calendar.accounts);
  useEffect(() => {
    accountsRef.current = calendar.accounts;
  }, [calendar.accounts]);
  useEffect(() => {
    if (!runtime || !workspaceId || calendar.loading) return;
    void accountKey;
    void connectTick;
    let cancelled = false;
    void (async () => {
      try {
        const added = await ensureGoogleCalendarAccounts({
          runtime,
          workspaceId,
          accounts: accountsRef.current,
        });
        if (!cancelled && added) await calendar.reload();
      } catch (err) {
        console.warn("[calendar] google link", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime, workspaceId, calendar.loading, calendar.reload, accountKey, connectTick]);

  const setAccountColor = useCallback(
    (accountId: string, hue: string) => {
      updatePrefs((prev) => ({ accountColors: { ...prev.accountColors, [accountId]: hue } }));
    },
    [updatePrefs],
  );
  const removeAccount = useCallback(
    (accountId: string) => {
      if (!runtime || !workspaceId) return;
      const removed = calendar.accounts.find((a) => a.id === accountId);
      void (async () => {
        try {
          // Clean up any OS-keychain secret (CalDAV last-row / ICS feed) before
          // the row is gone, then cascade-remove in Supabase.
          if (removed) {
            await cleanupCredentialsForRemoval({
              isDesktop: IS_DESKTOP,
              removed,
              allAccounts: calendar.accounts,
            });
          }
          await runtime.calendar.removeAccount({ workspaceId, accountId });
          // Prune the removed account's prefs so the maps don't accrue dead ids.
          updatePrefs((prev) => {
            const { [accountId]: _drop, ...accountColors } = prev.accountColors;
            return {
              hiddenAccountIds: prev.hiddenAccountIds.filter((id) => id !== accountId),
              accountColors,
            };
          });
          await calendar.reload();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Couldn't remove the calendar.");
        }
      })();
    },
    [runtime, workspaceId, calendar, updatePrefs],
  );
  const [reconnectTarget, setReconnectTarget] = useState<CalendarAccountModel | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshCalendars = useCallback(() => {
    setRefreshing(true);
    // Desktop: pull from providers first (no-op on web), then re-read Supabase.
    void syncNow()
      .then(() => Promise.all([calendar.reload(), api.reload()]))
      .catch(() => toast.error("Couldn't refresh calendars — try again."))
      .finally(() => setRefreshing(false));
  }, [syncNow, calendar, api]);

  const anchor = useMemo(
    () => parseDayKey(viewState.anchor) ?? startOfLocalDay(new Date()),
    [viewState.anchor],
  );
  const range = useMemo(
    () => visibleRange(viewState.view, anchor, prefs),
    [viewState.view, anchor, prefs],
  );
  // SCALE-1: the events read is windowed, so tell the hook what's on screen —
  // navigating past the loaded window widens it and refetches instead of
  // rendering a silently empty month.
  const { ensureRange } = calendar;
  useEffect(() => {
    ensureRange(new Date(range.startMs), new Date(range.endMs));
  }, [ensureRange, range.startMs, range.endMs]);

  const blocks = useMemo(() => taskBlocks(api.tasks, range), [api.tasks, range]);
  const grouped = useMemo(() => blocksByDay(blocks), [blocks]);
  const eventChips = useMemo(() => eventChipsInRange(shownEvents, range), [shownEvents, range]);
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
    for (const e of shownEvents) {
      const d = new Date(e.startsAt);
      if (!Number.isNaN(d.getTime())) keys.add(localDayKey(d));
    }
    return keys;
  }, [api.tasks, shownEvents]);

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

  // ── inbound `?event=` deep link (DF-2) ────────────────────────────────────
  // A widget row / linked chip / notification opens a specific event: navigate
  // to its series-anchor day, select + highlight the first occurrence there,
  // and open its detail. Consume-once (keyed by id) so render churn can't fight
  // the user who navigated away; wait for the events bundle before deciding an
  // id is stale. On apply — or when stale/unknown — clear the URL param.
  const processedEventIdRef = useRef<string | null>(null);
  /** Which id we've already dropped the date window for (SCALE-1), once each. */
  const widenedForEventIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!urlEventId) {
      processedEventIdRef.current = null;
      widenedForEventIdRef.current = null;
      return;
    }
    if (processedEventIdRef.current === urlEventId) return;
    if (calendar.loading) return; // wait for events before ruling stale
    const target = resolveCalendarDeepLink(urlEventId, { events: calendar.events });
    if (target.kind === "none") {
      // The events read is windowed (SCALE-1), so "not in memory" does NOT
      // mean "deleted" — a link to a 2023 event simply hasn't been fetched.
      // Drop the window once and let the reload re-run this effect before
      // ruling the id stale; otherwise every pre-window deep link lies.
      // Only wait for a reload if dropping the window will ACTUALLY cause one.
      // `ensureAllTime` is a no-op once the window is already all-time (an
      // earlier deep link in this session), and returning here on that path
      // would strand the link: no toast, no consume, `?event=` stuck in the URL.
      if (!calendar.isAllTimeWindow && widenedForEventIdRef.current !== urlEventId) {
        widenedForEventIdRef.current = urlEventId;
        calendar.ensureAllTime();
        return;
      }
      processedEventIdRef.current = urlEventId;
      takeEntityOpenIntent(urlEventId); // spend the "take me there" mark
      toast("Couldn't find that event", {
        description: "It may have been deleted or isn't on this calendar.",
      });
      onConsumeEventDeepLink?.();
      return;
    }
    processedEventIdRef.current = urlEventId;
    takeEntityOpenIntent(urlEventId); // spend the "take me there" mark
    // For a recurring event, land on the nearest UPCOMING occurrence (a weekly
    // standup created months ago shouldn't teleport the user months back); a
    // one-off / ended series falls back to the series start. Using the same
    // expander the chips use means the occurrence key below matches a real chip.
    const event = calendar.events.find((e) => e.id === target.eventId);
    let occurrenceMs = new Date(target.startsAt).getTime();
    if (event?.rrule) {
      const todayMs = startOfLocalDay(new Date()).getTime();
      const yearAheadMs = todayMs + 366 * 24 * 60 * 60 * 1000;
      const next = expandEventOccurrences(event, todayMs, yearAheadMs)[0];
      if (next) occurrenceMs = next.startMs;
    }
    goToDate(new Date(occurrenceMs));
    setSelectedOccurrenceKey(`${target.eventId}:${occurrenceMs}`);
    openDetail({ type: "event", id: target.eventId });
    onConsumeEventDeepLink?.();
  }, [
    urlEventId,
    calendar.loading,
    calendar.events,
    calendar.ensureAllTime,
    calendar.isAllTimeWindow,
    goToDate,
    openDetail,
    onConsumeEventDeepLink,
  ]);

  const onEventClick = useCallback((chip: EventChip, rect: DOMRect) => {
    setTaskPopover(null);
    setEventPopover({ chip, rect });
  }, []);
  const onTaskClick = useCallback((block: TaskBlock, rect: DOMRect) => {
    setEventPopover(null);
    setTaskPopover({ block, rect });
  }, []);

  const createCalendars = useMemo(
    () => [
      { id: "moduo", label: "Moduo" },
      ...calendar.accounts
        .filter((account) => account.provider === "google" && !account.deletedAt)
        .map((account) => ({
          id: account.id,
          label: account.displayLabel || "Google",
        })),
    ],
    [calendar.accounts],
  );

  const onCreateEvent = useCallback(
    (draft: QuickCreateDraft) => {
      const target = calendar.accounts.find((account) => account.id === draft.calendarId);
      if (!target || target.provider !== "google" || !runtime || !workspaceId) {
        void calendar.createEvent(draft);
        return;
      }
      void (async () => {
        try {
          const raw = await pushGoogleWebEvent({
            externalAccountId: target.externalId,
            title: draft.title,
            startsAt: draft.startsAt,
            endsAt: draft.endsAt,
            allDay: draft.allDay,
            rrule: draft.rrule,
            timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
          });
          const mapped = mapGoogleEvent(raw);
          if (!mapped) throw new Error("Google did not return the event.");
          await runtime.calendar.mirrorEvents({
            workspaceId,
            accountId: target.id,
            events: [mapped],
            deletedExternalIds: [],
          });
          await calendar.reload();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "Couldn't save the event on Google.");
        }
      })();
    },
    [calendar, runtime, workspaceId],
  );

  const onMoveEvent = useCallback(
    (eventId: string, deltas: MoveEventDeltas) => {
      const event = eventsById.get(eventId);
      if (!event) return;
      // Occurrence deltas map onto the series anchor (v1 = series edits).
      const startsAt = new Date(
        new Date(event.startsAt).getTime() + deltas.startDeltaMs,
      ).toISOString();
      const endsAt = new Date(new Date(event.endsAt).getTime() + deltas.endDeltaMs).toISOString();
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
    setDetailTarget((cur) => (cur?.type === "event" && cur.id === deleteEventId ? null : cur));
    setSelectedOccurrenceKey(null);
    void calendar.deleteEvent(deleteEventId);
  }, [calendar, deleteEventId]);

  // ── drag-to-schedule (the universal drag contract, AC6) ───────────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
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
      const colEl = document.querySelector<HTMLElement>(`[data-day-col][data-day-key="${dayKey}"]`);
      if (!colEl) return;
      const task = api.tasks.find((t) => t.id === payload.entityId);
      if (!task || !api.canEdit) return;
      const geom = dayGeometry(day);
      const rect = colEl.getBoundingClientRect();
      const activator = e.activatorEvent as PointerEvent | MouseEvent;
      const pointerY =
        pointer?.y ??
        (typeof activator?.clientY === "number" ? activator.clientY : rect.top) + e.delta.y;
      const frac = Math.min(Math.max((pointerY - rect.top) / rect.height, 0), 1);
      const rawMin = frac * geom.totalMinutes;
      // Duration clamps to the day so a fat-fingered estimate can't push the
      // start negative or paint past the grid bottom.
      const duration = Math.min(task.durationMinutes || DEFAULT_DROP_MINUTES, geom.totalMinutes);
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
  useEffect(() => {
    keysRef.current = { setView, goToday, step, selectedOccurrenceKey, requestDelete };
  });

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

  // ── the completion loop (CAL-4) ───────────────────────────────────────────
  // A gentle page tick so the strip count follows blocks as they elapse (the
  // grid keeps its own 30s tick; this one only drives the strip membership).
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowTick(Date.now()), 60_000);
    const onWake = () => setNowTick(Date.now());
    document.addEventListener("visibilitychange", onWake);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onWake);
    };
  }, []);

  // "Took longer" blocks acknowledged this session — suppressed from the strip
  // and the in-grid triage until reload (the lens model has no per-block store
  // to persist "worked"; the LOGGED TIME persists, this suppression doesn't).
  const [workedTaskIds, setWorkedTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const markWorked = useCallback((taskId: string, worked: boolean) => {
    setWorkedTaskIds((prev) => {
      const next = new Set(prev);
      if (worked) next.add(taskId);
      else next.delete(taskId);
      return next;
    });
  }, []);

  const [reviewMode, setReviewMode] = useState(false);

  // The focus session (CAL-5) — one at a time; accrues to the task's tracked
  // total via the shipped time path.
  const focus = useBlockFocus(api.addTimeSpent);

  const strip = useMemo(
    () => stripItems(api.tasks, nowTick, workedTaskIds),
    [api.tasks, nowTick, workedTaskIds],
  );

  // Today's gap-finding context, built fresh at click time (accurate `now`,
  // current busy set) rather than on a periodic tick.
  const buildTodayContext = useCallback((): RollContext => {
    const now = Date.now();
    const todayStart = startOfLocalDay(new Date(now));
    const todayRange = visibleRange("day", todayStart, prefs);
    const todayKey = localDayKey(todayStart);
    const todayBlocks = taskBlocks(api.tasks, todayRange);
    const todayEvents = eventChipsInRange(calendar.events, todayRange).timed.get(todayKey) ?? [];
    const busy: BusyInterval[] = [
      ...todayBlocks.map((b) => ({ startMs: b.startMs, endMs: b.endMs })),
      ...todayEvents.map((c) => ({ startMs: c.startMs, endMs: c.endMs })),
    ];
    return {
      nowMs: now,
      dayStartMs: todayStart.getTime(),
      workStartMinute: prefs.workStartMinute,
      workEndMinute: prefs.workEndMinute,
      busy,
    };
  }, [api.tasks, calendar.events, prefs]);

  const onTriageLater = useCallback(
    (taskId: string) => {
      const task = api.tasks.find((t) => t.id === taskId);
      if (!task?.scheduledAt) return;
      const fromIso = task.scheduledAt;
      const dur =
        task.durationMinutes && task.durationMinutes > 0
          ? task.durationMinutes
          : DEFAULT_BLOCK_MINUTES;
      const ctx = buildTodayContext();
      const gap = findNextGap({ ...ctx, durationMinutes: dur });
      if (gap == null) {
        toast("No open slot left today — it's waiting in the strip below.");
        return;
      }
      api.scheduleTaskAt(taskId, new Date(gap).toISOString());
      toast(`Moved to ${formatTimeOfDay(gap)}`, {
        duration: UNDO_TOAST_MS,
        action: { label: "Undo", onClick: () => api.scheduleTaskAt(taskId, fromIso) },
      });
    },
    [api, buildTodayContext],
  );

  const onTriageLonger = useCallback(
    (taskId: string) => {
      const task = api.tasks.find((t) => t.id === taskId);
      if (!task) return;
      const delta = tookLongerDeltaSeconds({ durationMinutes: task.durationMinutes });
      // One adjustment (TV-D3); its Undo removes exactly that one, so time
      // tracked on the task meanwhile stays.
      const logged = api.logTimeAdjustment(taskId, delta);
      markWorked(taskId, true);
      toast(`+${Math.round(delta / 60)}m logged · kept open`, {
        duration: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          onClick: () => {
            void logged.then((adjustment) => {
              if (adjustment) api.undoTimeAdjustment(taskId, adjustment);
            });
            markWorked(taskId, false);
          },
        },
      });
    },
    [api, markWorked],
  );

  const onTriageRemove = useCallback(
    (taskId: string) => {
      const task = api.tasks.find((t) => t.id === taskId);
      if (!task?.scheduledAt) return;
      const fromIso = task.scheduledAt;
      api.unscheduleTask(taskId);
      markWorked(taskId, false);
      toast("Removed from the calendar", {
        duration: UNDO_TOAST_MS,
        // Re-schedule from cleared state uses patchTask (the op needs an
        // existing schedule to move) — an undo restore, not a fresh intent.
        action: { label: "Undo", onClick: () => api.patchTask(taskId, { scheduledAt: fromIso }) },
      });
    },
    [api, markWorked],
  );

  // Roll a queue of strip items into today's gaps; one Undo reverses all (AC9).
  const rollForward = useCallback(
    (items: StripItem[]) => {
      // Only tasks still scheduled can be moved — the reschedule op no-ops on an
      // already-unscheduled task, which would over-count the "Moved N" toast.
      const live = items.filter((i) => {
        const t = api.tasks.find((x) => x.id === i.taskId);
        return Boolean(t?.scheduledAt);
      });
      if (live.length === 0) return;
      const plan = planRollForward(live, buildTodayContext());
      for (const p of plan.placements) {
        api.scheduleTaskAt(p.taskId, new Date(p.toMs).toISOString());
      }
      const message = rollForwardMessage(plan);
      if (plan.placements.length === 0) {
        toast(message);
        return;
      }
      toast(message, {
        duration: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          onClick: () => {
            for (const u of undoRollForward(plan.placements)) {
              api.scheduleTaskAt(u.taskId, new Date(u.toMs).toISOString());
            }
          },
        },
      });
    },
    [api, buildTodayContext],
  );

  const openReview = useCallback(() => {
    setReviewMode(true);
    setPanelVariant("tasks");
    const state = readFeaturePanelState("calendar");
    if (!state.right) {
      dispatchLayoutPanelsSet({ feature: "calendar", left: state.left, right: true });
    }
  }, [setPanelVariant]);

  // Focus controls threaded to the popover.
  const onStopFocus = useCallback(() => {
    const result = focus.stop();
    if (!result) return;
    const task = api.tasks.find((t) => t.id === result.taskId);
    toast(loggedMessage(result.seconds, task?.title ?? ""));
  }, [focus, api.tasks]);

  const popoverEvent = eventPopover ? (eventsById.get(eventPopover.chip.eventId) ?? null) : null;
  const sourceLabelFor = useCallback(
    (sourceAccountId: string | null): string | null => {
      if (!sourceAccountId) return null;
      const account = calendar.accounts.find((a) => a.id === sourceAccountId);
      return account ? accountSourceLabel(account) : null;
    },
    [calendar.accounts],
  );

  const detailTask =
    detailTarget?.type === "task"
      ? (api.tasks.find((t) => t.id === detailTarget.id) ?? null)
      : null;
  const detailEvent =
    detailTarget?.type === "event" ? (eventsById.get(detailTarget.id) ?? null) : null;

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
              runtime={runtime}
              workspaceId={workspaceId}
            />
          ) : (
            <div className="grid h-full place-content-center px-3 text-center">
              <span className="text-sm text-muted-foreground">
                Select something on the calendar.
              </span>
            </div>
          ),
      },
      {
        // "Notes" rail (NO-7b, AC8): the notes linked to the selected event/task,
        // plus New-linked-note. Focus follows the same detail selection.
        id: "notes",
        label: "Notes",
        render: () => (
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
      },
    ],
    [
      api,
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
        notice={truncationNotice(calendar.truncated)}
        left={
          <CalendarRail
            anchor={anchor}
            onSelectDate={goToDate}
            busyDayKeys={busyDayKeys}
            prefs={prefs}
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
                  onShowAccounts={(accountIds) => {
                    const show = new Set(accountIds);
                    updatePrefs(() => ({
                      hiddenAccountIds: calendar.accounts
                        .map((account) => account.id)
                        .filter((id) => !show.has(id)),
                    }));
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
              syncLabel={calendar.accounts.length > 0 ? syncAgeLabel(calendar.accounts) : null}
              onRefresh={calendar.accounts.length > 0 ? refreshCalendars : undefined}
              refreshing={refreshing}
            />
            <CalendarStrip
              count={strip.length}
              canEdit={api.canEdit}
              reviewing={reviewMode}
              onMoveToToday={() => rollForward(strip)}
              onReview={openReview}
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
              createCalendars={createCalendars}
              onMoveEvent={onMoveEvent}
              onMoveTask={onMoveTask}
              onEventClick={onEventClick}
              onTaskClick={onTaskClick}
              selectedOccurrenceKey={selectedOccurrenceKey}
              onSelectOccurrence={setSelectedOccurrenceKey}
              accountHues={accountHues}
              workedTaskIds={workedTaskIds}
              onTriageLater={onTriageLater}
              onTriageLonger={onTriageLonger}
              onTriageRemove={onTriageRemove}
              focusTaskId={focus.taskId}
              focusRunningSinceMs={focus.runningSinceMs}
              focusBaseSeconds={focus.baseSeconds}
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
          elapsed={isElapsedBlock(taskPopover.block, nowTick)}
          worked={workedTaskIds.has(taskPopover.block.taskId)}
          canFocus={canFocusBlock(taskPopover.block, nowTick)}
          focusing={focus.taskId === taskPopover.block.taskId}
          focusRunning={focus.running && focus.taskId === taskPopover.block.taskId}
          focusReadout={
            focus.taskId === taskPopover.block.taskId ? (
              <FocusReadout runningSinceMs={focus.runningSinceMs} baseSeconds={focus.baseSeconds} />
            ) : null
          }
          onToggleDone={() => {
            onToggleDone(taskPopover.block.taskId);
            setTaskPopover(null);
          }}
          onLater={() => {
            onTriageLater(taskPopover.block.taskId);
            setTaskPopover(null);
          }}
          onLonger={() => {
            onTriageLonger(taskPopover.block.taskId);
            setTaskPopover(null);
          }}
          onRemove={() => {
            onTriageRemove(taskPopover.block.taskId);
            setTaskPopover(null);
          }}
          onStartFocus={() => focus.start(taskPopover.block.taskId)}
          onPauseFocus={() => focus.pause()}
          onResumeFocus={() => focus.resume()}
          onStopFocus={onStopFocus}
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
    </DndContext>
  );
}
