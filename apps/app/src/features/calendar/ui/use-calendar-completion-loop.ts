// The completion loop (CAL-4): the strip of elapsed blocks, "Later" / "Took
// longer" / "Remove" triage with an Undo toast each, and rolling a queue into
// today's gaps (AC9).

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { UNDO_TOAST_MS } from "../../../lib/undo-toast";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
import type { Task } from "../../tasks/model";
import type { useTaskCommands } from "../../tasks/tasks-context";
import { eventChipsInRange } from "../events";
import { type BusyInterval, findNextGap } from "../gap-finder";
import type { CalendarModuleApi } from "../hooks/use-calendar-module";
import type { useCalendarPrefs } from "../hooks/use-calendar-prefs";
import {
  DEFAULT_BLOCK_MINUTES,
  localDayKey,
  startOfLocalDay,
  taskBlocks,
  visibleRange,
} from "../lens";
import type { PanelVariantId } from "../prefs";
import {
  planRollForward,
  type RollContext,
  rollForwardMessage,
  undoRollForward,
} from "../roll-forward";
import { type StripItem, stripItems } from "../strip";
import { tookLongerDeltaSeconds } from "../triage";
import { formatTimeOfDay } from "./time-format";

type Input = {
  tasks: Task[];
  sessions: NonNullable<Parameters<typeof taskBlocks>[2]>["list"];
  userId: string;
  prefs: ReturnType<typeof useCalendarPrefs>["prefs"];
  events: CalendarModuleApi["events"];
  commands: ReturnType<typeof useTaskCommands>;
  setPanelVariant: (id: PanelVariantId) => void;
};

export function useCalendarCompletionLoop({
  tasks,
  sessions,
  userId,
  prefs,
  events,
  commands,
  setPanelVariant,
}: Input) {
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

  const strip = useMemo(
    () => stripItems(tasks, nowTick, workedTaskIds),
    [tasks, nowTick, workedTaskIds],
  );

  // Today's gap-finding context, built fresh at click time (accurate `now`,
  // current busy set) rather than on a periodic tick.
  const buildTodayContext = useCallback((): RollContext => {
    const now = Date.now();
    const todayStart = startOfLocalDay(new Date(now));
    const todayRange = visibleRange("day", todayStart, prefs);
    const todayKey = localDayKey(todayStart);
    const todayBlocks = taskBlocks(tasks, todayRange, { list: sessions, me: userId });
    const todayEvents = eventChipsInRange(events, todayRange).timed.get(todayKey) ?? [];
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
  }, [tasks, sessions, userId, events, prefs]);

  const onTriageLater = useCallback(
    (taskId: string, sessionId?: string | null) => {
      // A block of a work session moves that session (TV-F6), not the one the
      // task row mirrors.
      const session = sessionId ? sessions.find((s) => s.id === sessionId) : undefined;
      if (session) {
        const fromStart = session.startsAt;
        const fromEnd = session.endsAt;
        const durMs = Math.max(60_000, Date.parse(fromEnd) - Date.parse(fromStart));
        const gap = findNextGap({
          ...buildTodayContext(),
          durationMinutes: Math.round(durMs / 60_000),
        });
        if (gap == null) {
          toast("No open slot left today — it's waiting in the strip below.");
          return;
        }
        const moved = commands.updateSession(session.id, {
          startsAt: new Date(gap).toISOString(),
          endsAt: new Date(gap + durMs).toISOString(),
        });
        if (!moved) return; // refused up front, and said why
        toast(`Moved to ${formatTimeOfDay(gap)}`, {
          duration: UNDO_TOAST_MS,
          action: {
            label: "Undo",
            onClick: () =>
              commands.updateSession(session.id, { startsAt: fromStart, endsAt: fromEnd }),
          },
        });
        return;
      }
      const task = tasks.find((t) => t.id === taskId);
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
      commands.scheduleTaskAt(taskId, new Date(gap).toISOString());
      toast(`Moved to ${formatTimeOfDay(gap)}`, {
        duration: UNDO_TOAST_MS,
        action: { label: "Undo", onClick: () => commands.scheduleTaskAt(taskId, fromIso) },
      });
    },
    [commands, tasks, sessions, buildTodayContext],
  );

  const onTriageLonger = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const delta = tookLongerDeltaSeconds({ durationMinutes: task.durationMinutes });
      // One adjustment (TV-D3); its Undo removes exactly that one, so time
      // tracked on the task meanwhile stays.
      const logged = commands.logTimeAdjustment(taskId, delta);
      markWorked(taskId, true);
      toast(`+${Math.round(delta / 60)}m logged · kept open`, {
        duration: UNDO_TOAST_MS,
        action: {
          label: "Undo",
          onClick: () => {
            void logged.then((adjustment) => {
              if (adjustment) commands.undoTimeAdjustment(taskId, adjustment);
            });
            markWorked(taskId, false);
          },
        },
      });
    },
    [commands, tasks, markWorked],
  );

  const onTriageRemove = useCallback(
    (taskId: string, sessionId?: string | null) => {
      // A block of a work session removes that session (TV-F6); Undo puts one
      // back at the same times.
      const session = sessionId ? sessions.find((s) => s.id === sessionId) : undefined;
      if (session) {
        if (!commands.removeSession(session.id)) return; // refused up front, and said why
        markWorked(taskId, false);
        toast("Removed from the calendar", {
          duration: UNDO_TOAST_MS,
          action: {
            label: "Undo",
            onClick: () =>
              commands.addSession(session.taskId, {
                startsAt: session.startsAt,
                endsAt: session.endsAt,
                userId: session.userId,
              }),
          },
        });
        return;
      }
      const task = tasks.find((t) => t.id === taskId);
      if (!task?.scheduledAt) return;
      const fromIso = task.scheduledAt;
      commands.unscheduleTask(taskId);
      markWorked(taskId, false);
      toast("Removed from the calendar", {
        duration: UNDO_TOAST_MS,
        // Undo puts the time back through patchTask, which since TV-P0 sends
        // a scheduled time through the reschedule op: the trail shows the
        // unschedule and the restore, both true.
        action: {
          label: "Undo",
          onClick: () => commands.patchTask(taskId, { scheduledAt: fromIso }),
        },
      });
    },
    [commands, tasks, sessions, markWorked],
  );

  // Roll a queue of strip items into today's gaps; one Undo reverses all (AC9).
  const rollForward = useCallback(
    (items: StripItem[]) => {
      // Only tasks still scheduled can be moved — the reschedule op no-ops on an
      // already-unscheduled task, which would over-count the "Moved N" toast.
      const live = items.filter((i) => {
        const t = tasks.find((x) => x.id === i.taskId);
        return Boolean(t?.scheduledAt);
      });
      if (live.length === 0) return;
      const plan = planRollForward(live, buildTodayContext());
      for (const p of plan.placements) {
        commands.scheduleTaskAt(p.taskId, new Date(p.toMs).toISOString());
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
              commands.scheduleTaskAt(u.taskId, new Date(u.toMs).toISOString());
            }
          },
        },
      });
    },
    [commands, tasks, buildTodayContext],
  );

  const openReview = useCallback(() => {
    setReviewMode(true);
    setPanelVariant("tasks");
    const state = readFeaturePanelState("calendar");
    if (!state.right) {
      dispatchLayoutPanelsSet({ feature: "calendar", left: state.left, right: true });
    }
  }, [setPanelVariant]);

  return {
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
  };
}
