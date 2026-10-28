// Placing a task from Plan (CALR-5, AC20). S lifts the selected Plan task to
// the next free slot that fits its estimate; while it's lifted ⇥ hops to the
// next free time, ↑↓ move it 15 minutes, ←→ a day, ↵ places it and esc lets
// go, F toggles task block ⇄ focus time holding it (CALR-14); a click in the
// free-time wash places it there. Placing is one patchTask
// with one Undo (commands/undo.ts), so nothing else on the grid moves. The keys
// while lifted are a transient gesture (a window capture listener, outside the
// registry, like a drag); S and / are registry keys. / focuses Find a task.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAppHotkeys } from "../../../lib/hotkeys";
import { formatDuration } from "../../../lib/time-format";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
import type { Task } from "../../tasks/model";
import type { useTaskCommands } from "../../tasks/tasks-context";
import { placeTask } from "../commands/undo";
import type { EventChip } from "../events";
import { focusDraftForTask } from "../focus-item";
import { type BusyInterval, findFreeSlot, freeSlots, nextFreeSlot } from "../gap-finder";
import { type CalendarView, localDayKey, startOfLocalDay, type TaskBlock } from "../lens";
import {
  liftSearchFrom,
  nudgePlacement,
  type Placement,
  placementBusy,
  placementMinutes,
  type PlacementNudge,
  togglePlacementKind,
} from "../place-task";
import type { CalendarPrefs, PanelVariantId } from "../prefs";
import { PlacementLayer } from "./placement-layer";
import { inCalendarOverlay } from "./use-calendar-hotkeys";

type Input = {
  tasks: readonly Task[];
  view: CalendarView;
  days: Date[];
  prefs: Pick<CalendarPrefs, "workStartMinute" | "workEndMinute">;
  eventsByDay: ReadonlyMap<string, readonly EventChip[]>;
  blocksByDay: ReadonlyMap<string, readonly TaskBlock[]>;
  commands: Pick<ReturnType<typeof useTaskCommands>, "patchTask">;
  canEdit: boolean;
  panelVariant: PanelVariantId;
  setPanelVariant: (id: PanelVariantId) => void;
  setView: (view: CalendarView) => void;
  goToDate: (day: Date) => void;
  /** Creates the focus time a focus placement lands as. */
  createEvent: (draft: ReturnType<typeof focusDraftForTask>) => Promise<unknown>;
};

const KEY_NUDGE: Record<string, PlacementNudge> = {
  ArrowUp: "earlier",
  ArrowDown: "later",
  ArrowLeft: "prev-day",
  ArrowRight: "next-day",
};

function inTextField(e: KeyboardEvent): boolean {
  const t = e.target;
  return (
    t instanceof HTMLElement &&
    (t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA")
  );
}

/** Plan is the panel showing. */
function planShowing(variant: PanelVariantId): boolean {
  return variant === "tasks" && readFeaturePanelState("calendar").right;
}

export function usePlanPlacement(input: Input) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [findRequest, setFindRequest] = useState(0);
  // A lift waiting for the grid to show the week it starts in.
  const pendingLift = useRef<string | null>(null);

  const selectedRef = useRef(selectedTaskId);
  const ref = useRef({ ...input, placement });
  useEffect(() => {
    ref.current = { ...input, placement };
    selectedRef.current = selectedTaskId;
  });

  const timedBusy = useCallback((taskId: string): BusyInterval[] => {
    const k = ref.current;
    return placementBusy(k.eventsByDay, k.blocksByDay, taskId);
  }, []);

  const lift = useCallback(
    (taskId: string) => {
      const k = ref.current;
      const task = k.tasks.find((t) => t.id === taskId);
      if (!task || !k.canEdit) return;
      setSelectedTaskId(taskId);
      if (k.view === "month") {
        pendingLift.current = taskId;
        k.setView("week");
        return;
      }
      const nowMs = Date.now();
      const from = liftSearchFrom({ nowMs, visibleDays: k.days, dueDate: task.dueDate });
      const dayKeys = k.days.map(localDayKey);
      if (!dayKeys.includes(localDayKey(new Date(from)))) {
        pendingLift.current = taskId;
        k.goToDate(new Date(from));
        return;
      }
      const durationMinutes = placementMinutes(task);
      const startMs = findFreeSlot({
        fromMs: from,
        days: k.days,
        workStartMinute: k.prefs.workStartMinute,
        workEndMinute: k.prefs.workEndMinute,
        durationMinutes,
        busy: timedBusy(taskId),
      });
      if (startMs == null) {
        toast(`No free time left this week fits ${formatDuration(durationMinutes)}.`, {
          description: "⌘→ shows next week.",
        });
        return;
      }
      setPlacement({ taskId, startMs, durationMinutes });
    },
    [timedBusy],
  );

  // The week the lift needed is on screen now (its events read for that range).
  const { days, view, eventsByDay } = input;
  useEffect(() => {
    const id = pendingLift.current;
    if (!id || view === "month") return;
    pendingLift.current = null;
    lift(id);
  }, [days, view, eventsByDay, lift]);

  const place = useCallback((startMs: number) => {
    const k = ref.current;
    const p = k.placement;
    const task = p ? k.tasks.find((t) => t.id === p.taskId) : undefined;
    setPlacement(null);
    if (!p || !task) return;
    if (p.kind === "focus") {
      void k.createEvent(focusDraftForTask(task, startMs, p.durationMinutes));
      return;
    }
    placeTask(
      k.commands,
      task,
      { scheduledAt: new Date(startMs).toISOString(), durationMinutes: p.durationMinutes },
      "Task placed",
      task.title,
    );
  }, []);

  // A lifted task that went away (done, deleted, Month view) is let go.
  const liftedTask = placement ? input.tasks.find((t) => t.id === placement.taskId) : undefined;
  const lost = placement !== null && (!liftedTask || input.view === "month");
  useEffect(() => {
    if (lost) setPlacement(null);
  }, [lost]);

  // The keys while lifted: ahead of the grid's own (capture, on window).
  const lifted = placement !== null;
  useEffect(() => {
    if (!lifted) return;
    /** ⇥: the next free time that fits, after where it sits now. */
    const hop = (p: Placement) => {
      const k = ref.current;
      const next = nextFreeSlot({
        fromMs: Date.now(),
        currentMs: p.startMs,
        days: k.days,
        workStartMinute: k.prefs.workStartMinute,
        workEndMinute: k.prefs.workEndMinute,
        durationMinutes: p.durationMinutes,
        busy: timedBusy(p.taskId),
      });
      if (next == null) toast("No later free time this week fits it.");
      else setPlacement({ ...p, startMs: next });
    };
    const nudge = (p: Placement, how: PlacementNudge) => {
      const moved = nudgePlacement(p, how);
      setPlacement(moved);
      const dayKey = localDayKey(new Date(moved.startMs));
      const k = ref.current;
      if (!k.days.some((d) => localDayKey(d) === dayKey)) k.goToDate(new Date(moved.startMs));
    };
    /** F: task block ⇄ focus time holding it. */
    const toggleKind = (p: Placement) => {
      const task = ref.current.tasks.find((t) => t.id === p.taskId);
      if (task) setPlacement(togglePlacementKind(p, task));
    };
    /** True when the key was the gesture's. */
    const act = (e: KeyboardEvent, p: Placement): boolean => {
      if (e.key === "Escape") setPlacement(null);
      else if (e.key === "Enter") place(p.startMs);
      else if (e.key === "Tab" && !e.shiftKey) hop(p);
      else if (KEY_NUDGE[e.key] && !e.shiftKey) nudge(p, KEY_NUDGE[e.key]);
      else if (e.key === "f" || e.key === "F") toggleKind(p);
      else return false;
      return true;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || inTextField(e) || inCalendarOverlay(e)) return;
      const p = ref.current.placement;
      if (p && act(e, p)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [lifted, place, timedBusy]);

  useAppHotkeys({
    "calendar.place-task": (e) => {
      const k = ref.current;
      if (inCalendarOverlay(e) || !k.canEdit || !planShowing(k.panelVariant)) return false;
      const focused =
        e.target instanceof Element
          ? e.target.closest<HTMLElement>("[data-plan-task-id]")?.dataset.planTaskId
          : undefined;
      const id = focused ?? selectedRef.current;
      if (!id) return false;
      lift(id);
    },
    "calendar.find-task": (e) => {
      if (inCalendarOverlay(e)) return false;
      const k = ref.current;
      if (k.panelVariant !== "tasks") k.setPanelVariant("tasks");
      const state = readFeaturePanelState("calendar");
      if (!state.right)
        dispatchLayoutPanelsSet({ feature: "calendar", left: state.left, right: true });
      setFindRequest((n) => n + 1);
    },
  });
  // The wash: free time that fits the lifted task, on the days shown.
  const freeByDay = useMemo(() => {
    const map = new Map<string, BusyInterval[]>();
    if (!placement) return map;
    const busy = placementBusy(eventsByDay, input.blocksByDay, placement.taskId);
    const nowMs = Date.now();
    for (const day of days) {
      const dayStartMs = startOfLocalDay(day).getTime();
      map.set(
        localDayKey(day),
        freeSlots({
          nowMs: Math.max(nowMs, dayStartMs),
          dayStartMs,
          workStartMinute: input.prefs.workStartMinute,
          workEndMinute: input.prefs.workEndMinute,
          durationMinutes: placement.durationMinutes,
          busy,
        }),
      );
    }
    return map;
  }, [placement, eventsByDay, input.blocksByDay, days, input.prefs]);

  const layer =
    placement && liftedTask && view !== "month" ? (
      <PlacementLayer
        days={days}
        placement={placement}
        title={liftedTask.title}
        freeByDay={freeByDay}
        onPlaceAt={place}
      />
    ) : null;

  return {
    selectedTaskId,
    selectTask: setSelectedTaskId,
    liftedTaskId: placement?.taskId ?? null,
    lift,
    findRequest,
    layer,
  };
}
