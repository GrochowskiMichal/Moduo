// The rebuilt /calendar page. CAL-1: three-pane shell + Week/Day task-lens
// grid. CAL-2: native events end-to-end — draw-to-create, move/resize,
// repeats, the chip popover, and the right-panel event Detail (links +
// activity). The full right-panel switcher (Tasks | Detail) lands with CAL-3.
// Task reads/ops ride the shipped Tasks lane; calendar reads degrade to empty
// pre-migration (the AC13 posture) — the page still works as a task lens.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
import type { ModuoRuntime } from "../../../lib/runtime.types";
import type { TasksModuleApi } from "../../tasks/hooks/use-tasks-module";
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
} from "../lens";
import { eventChipsInRange, type EventChip } from "../events";
import {
  useCalendarModule,
  type CalendarModuleApi,
} from "../hooks/use-calendar-module";
import {
  readCalendarPrefs,
  readViewState,
  writeViewState,
  type CalendarViewState,
} from "../prefs";
import { CalendarGrid, type MoveEventDeltas } from "./calendar-grid";
import { CalendarRail } from "./calendar-rail";
import { CalendarToolbar } from "./calendar-toolbar";
import { EventDetailPanel } from "./event-detail-panel";
import { EventPopover } from "./event-popover";
import type { QuickCreateDraft } from "./event-quick-create";

type Props = {
  api: TasksModuleApi;
  runtime: ModuoRuntime | null;
  userId: string;
  workspaceId: string;
};

type PopoverState = { chip: EventChip; rect: DOMRect };

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

  // ── event interaction state ────────────────────────────────────────────────
  const [selectedOccurrenceKey, setSelectedOccurrenceKey] = useState<string | null>(null);
  const [popover, setPopover] = useState<PopoverState | null>(null);
  const [openEventId, setOpenEventId] = useState<string | null>(null);
  const [deleteEventId, setDeleteEventId] = useState<string | null>(null);

  const openEvent = openEventId ? (eventsById.get(openEventId) ?? null) : null;
  const deleteEvent = deleteEventId ? (eventsById.get(deleteEventId) ?? null) : null;

  const openDetail = useCallback(
    (eventId: string) => {
      setPopover(null);
      setOpenEventId(eventId);
      // The Detail lives in the right panel — make sure it's open.
      const state = readFeaturePanelState("calendar");
      if (!state.right) {
        dispatchLayoutPanelsSet({ feature: "calendar", left: state.left, right: true });
      }
    },
    [],
  );

  const onEventClick = useCallback((chip: EventChip, rect: DOMRect) => {
    setPopover({ chip, rect });
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

  const confirmDelete = useCallback(() => {
    if (!deleteEventId) return;
    setDeleteEventId(null);
    setPopover(null);
    if (openEventId === deleteEventId) setOpenEventId(null);
    setSelectedOccurrenceKey(null);
    void calendar.deleteEvent(deleteEventId);
  }, [calendar, deleteEventId, openEventId]);

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

  const popoverEvent = popover ? (eventsById.get(popover.chip.eventId) ?? null) : null;
  const sourceLabelFor = useCallback(
    (sourceAccountId: string | null): string | null => {
      if (!sourceAccountId) return null;
      const account = calendar.accounts.find((a) => a.id === sourceAccountId);
      return account ? `${account.displayLabel} — ${account.provider}` : null;
    },
    [calendar.accounts],
  );

  return (
    <>
      <FeaturePanelsShell
        feature="calendar"
        hideRight={!openEvent}
        left={
          <CalendarRail
            anchor={anchor}
            onSelectDate={goToDate}
            busyDayKeys={busyDayKeys}
            prefs={prefs}
          />
        }
        right={
          openEvent ? (
            <EventDetailPanel
              runtime={runtime}
              workspaceId={workspaceId}
              currentUserId={userId}
              event={openEvent}
              accounts={calendar.accounts}
              canEdit={calendar.canEdit}
              onPatch={(eventId, patch) => void calendar.updateEvent(eventId, patch)}
              onDeleteRequest={setDeleteEventId}
              onClose={() => setOpenEventId(null)}
            />
          ) : undefined
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
              onEventClick={onEventClick}
              selectedOccurrenceKey={selectedOccurrenceKey}
              onSelectOccurrence={setSelectedOccurrenceKey}
            />
          </div>
        }
      />

      {popover && popoverEvent ? (
        <EventPopover
          event={popoverEvent}
          occStartMs={popover.chip.startMs}
          occEndMs={popover.chip.endMs}
          anchorRect={popover.rect}
          canEdit={calendar.canEdit}
          sourceLabel={sourceLabelFor(popoverEvent.sourceAccountId)}
          onOpenDetail={() => openDetail(popoverEvent.id)}
          onDelete={() => {
            setPopover(null);
            setDeleteEventId(popoverEvent.id);
          }}
          onClose={() => setPopover(null)}
        />
      ) : null}

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
    </>
  );
}
