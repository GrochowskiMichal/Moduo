// DB-5 — "Today" widget (ports CAL-7 `calendar/today.ts` + the loop's gap-finder
// + roll-forward). A quiet mini-agenda of what's left today: next-up emphasized,
// the upcoming few, and an "unfinished from earlier" strip with an inline
// Move-to-today (edit-gated by `canWrite`). Rows deep-link; never a guilt wall.

import { ArrowRight, CalendarClock } from "lucide-react";
import { useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { eventChipsInRange } from "@/features/calendar/events";
import { localDayKey, startOfLocalDay, taskBlocks, visibleRange } from "@/features/calendar/lens";
import { DEFAULT_CALENDAR_PREFS } from "@/features/calendar/prefs";
import { planRollForward, rollForwardMessage } from "@/features/calendar/roll-forward";
import { stripItems } from "@/features/calendar/strip";
import { shapeToday, type TodayChip } from "@/features/calendar/today";
import { formatTimeOfDay } from "@/features/calendar/ui/time-format";
import { getRuntime } from "@/lib/runtime";
import { cn } from "@/lib/utils";

import {
  requestDashboardDataRefresh,
  useDashboardData,
} from "../../context/dashboard-data-context";
import { useDensity } from "../../hooks/use-density";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { openEntity } from "../../widget-nav";
import { WidgetBodyRoot } from "./widget-primitives";

export function CalendarTodayWidget({ size, canWrite }: WidgetComponentProps) {
  const { tasks: taskSource, calendar: calendarSource, workspaceId } = useDashboardData();
  const density = useDensity();
  const movingRef = useRef(false);

  const loading =
    (taskSource.loading || calendarSource.loading) &&
    taskSource.data.tasks.length === 0 &&
    calendarSource.data.events.length === 0;

  const liveTasks = useMemo(
    () => taskSource.data.tasks.filter((t) => !t.deletedAt),
    [taskSource.data.tasks],
  );
  const events = calendarSource.data.events;

  const view = useMemo(
    () => shapeToday({ tasks: liveTasks, events, weekStartsOn: 1, now: new Date() }),
    [liveTasks, events],
  );

  const onMoveToToday = useCallback(() => {
    const runtime = getRuntime();
    if (!runtime || !workspaceId || movingRef.current) return;
    const now = Date.now();
    const items = stripItems(liveTasks, now);
    if (items.length === 0) return;
    movingRef.current = true;
    // Today's busy set (blocks + timed events) for the gap-finder — default
    // working hours (the widget has no per-user prefs; full fidelity lives on
    // the calendar page).
    const todayStart = startOfLocalDay(new Date(now));
    const range = visibleRange("day", todayStart, { weekStartsOn: 1, showWeekends: true });
    const todayKey = localDayKey(todayStart);
    const busy = [
      ...taskBlocks(liveTasks, range).map((b) => ({ startMs: b.startMs, endMs: b.endMs })),
      ...(eventChipsInRange(events, range).timed.get(todayKey) ?? []).map((c) => ({
        startMs: c.startMs,
        endMs: c.endMs,
      })),
    ];
    const plan = planRollForward(items, {
      nowMs: now,
      dayStartMs: todayStart.getTime(),
      workStartMinute: DEFAULT_CALENDAR_PREFS.workStartMinute,
      workEndMinute: DEFAULT_CALENDAR_PREFS.workEndMinute,
      busy,
    });
    void Promise.all(
      plan.placements.map((p) =>
        runtime.tasks.opReschedule({
          workspaceId,
          taskId: p.taskId,
          scheduledAt: new Date(p.toMs).toISOString(),
        }),
      ),
    )
      .then(() => {
        toast(rollForwardMessage(plan));
        requestDashboardDataRefresh();
      })
      .catch(() => toast.error("Couldn't move those to today — try the calendar."))
      .finally(() => {
        movingRef.current = false;
      });
  }, [workspaceId, liveTasks, events]);

  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <CalendarClock
          className="size-6 animate-pulse text-muted-foreground motion-reduce:animate-none"
          aria-hidden
        />
      </div>
    );
  }

  const budget = widgetRowBudget(size, density);
  const remaining = view.remaining.slice(0, budget);

  return (
    <WidgetBodyRoot>
      {view.stripCount > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">{view.stripCount} unfinished from earlier</span>
          {canWrite ? (
            <button
              type="button"
              onClick={onMoveToToday}
              className="shrink-0 rounded-sm text-xs text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Move to today
            </button>
          ) : null}
        </div>
      ) : null}

      {remaining.length === 0 ? (
        <div className="grid h-full place-items-center px-3 text-center">
          <p className="text-sm text-muted-foreground">
            {view.chips.length > 0
              ? "Nothing left today — nicely done."
              : "Nothing scheduled today."}
          </p>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin p-1.5">
          {remaining.map((chip: TodayChip, i) => (
            <li key={`${chip.entityType}:${chip.entityId}`}>
              <button
                type="button"
                onClick={() => openEntity(chip.entityType, chip.entityId)}
                className="flex min-h-[var(--row-h)] w-full items-center gap-2 rounded-md px-2 py-1 text-left hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="w-14 shrink-0 tabular-nums text-2xs text-muted-foreground">
                  {formatTimeOfDay(chip.startMs)}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate text-sm",
                    i === 0 ? "font-medium text-foreground" : "text-foreground",
                  )}
                >
                  {chip.title}
                </span>
                {i === 0 ? (
                  <ArrowRight
                    className="size-icon-xs shrink-0 text-muted-foreground/70"
                    aria-hidden
                  />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </WidgetBodyRoot>
  );
}
