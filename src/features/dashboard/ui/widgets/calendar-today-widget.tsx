// "Today" dashboard widget (CAL-7, AC14 — the Calendar DoD widget). A quiet
// mini-agenda of what's left today: the next-up chip emphasized, the upcoming
// few after it, and the "unfinished from earlier" strip count with an inline
// Move-to-today (reuses the loop's gap-finder + roll-forward). Rows deep-link
// via `moduo:entity:open`. Never red, never a guilt wall (R10).

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ArrowRight, CalendarClock } from "lucide-react";

import type { ModuoRuntime } from "@/lib/runtime.types";
import { cn } from "@/lib/utils";
import { shapeToday, type TodayChip, type TodayView } from "@/features/calendar/today";
import { stripItems } from "@/features/calendar/strip";
import { planRollForward, rollForwardMessage } from "@/features/calendar/roll-forward";
import { DEFAULT_CALENDAR_PREFS } from "@/features/calendar/prefs";
import {
  localDayKey,
  startOfLocalDay,
  taskBlocks,
  visibleRange,
} from "@/features/calendar/lens";
import { eventChipsInRange, type CalendarEventModel } from "@/features/calendar/events";
import type { Task } from "@/features/tasks/model";
import { formatTimeOfDay } from "@/features/calendar/ui/time-format";
import type { WidgetConfig } from "../../types";
import { WidgetShell } from "./widget-shell";

function openEntity(chip: TodayChip) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("moduo:entity:open", {
      detail: { type: chip.entityType, id: chip.entityId },
    }),
  );
}

const EMPTY: TodayView = {
  dayStartMs: 0,
  totalMinutes: 1440,
  nowMinutes: 0,
  chips: [],
  next: null,
  remaining: [],
  stripCount: 0,
};

export function CalendarTodayList({
  view,
  canEdit,
  onMoveToToday,
}: {
  view: TodayView;
  canEdit: boolean;
  onMoveToToday: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {view.stripCount > 0 ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2 text-sm text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            · {view.stripCount} unfinished from earlier
          </span>
          {canEdit ? (
            <button
              type="button"
              onClick={onMoveToToday}
              className="shrink-0 rounded-md text-xs text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              Move to today
            </button>
          ) : null}
        </div>
      ) : null}

      {view.remaining.length === 0 ? (
        <div className="grid h-full place-items-center px-4 text-center">
          <p className="text-sm text-muted-foreground">
            {view.chips.length > 0 ? "Nothing left today — nicely done." : "Nothing scheduled today."}
          </p>
        </div>
      ) : (
        <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto p-2">
          {view.remaining.map((chip, i) => (
            <li key={`${chip.entityType}:${chip.entityId}`}>
              <button
                type="button"
                onClick={() => openEntity(chip)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                )}
              >
                <span className="w-14 shrink-0 tabular-nums text-2xs text-muted-foreground">
                  {formatTimeOfDay(chip.startMs)}
                </span>
                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    i === 0 ? "font-medium text-foreground" : "text-foreground",
                  )}
                >
                  {chip.title}
                </span>
                {i === 0 ? (
                  <ArrowRight className="size-icon-xs shrink-0 text-muted-foreground/70" aria-hidden />
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Props = {
  runtime: ModuoRuntime | null;
  workspaceId: string;
  config: WidgetConfig;
  isLocked: boolean;
  onUpdateConfig: (patch: Partial<WidgetConfig>) => void;
};

export function CalendarTodayWidget({ runtime, workspaceId, config }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [events, setEvents] = useState<CalendarEventModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [canEdit, setCanEdit] = useState(false);
  const [reloadStamp, setReloadStamp] = useState(0);

  useEffect(() => {
    if (!runtime || !workspaceId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const [taskBundle, calBundle] = await Promise.all([
          runtime.tasks.list(workspaceId),
          runtime.calendar.listModule(workspaceId),
        ]);
        if (!active) return;
        setTasks(taskBundle.tasks.filter((t) => !t.deletedAt));
        setEvents(calBundle.events);
        setCanEdit(true);
      } catch {
        // A widget must never wall — degrade to the quiet empty state.
        if (active) {
          setTasks([]);
          setEvents([]);
        }
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [runtime, workspaceId, reloadStamp]);

  const view = loading ? EMPTY : shapeToday({ tasks, events, weekStartsOn: 1, now: new Date() });

  // In-flight guard: a double-click must not double-fire the reschedules.
  const movingRef = useRef(false);

  const onMoveToToday = useCallback(() => {
    if (!runtime || !workspaceId || movingRef.current) return;
    const now = Date.now();
    const items = stripItems(tasks, now);
    if (items.length === 0) return;
    movingRef.current = true;
    // Today's busy set (blocks + events) for the gap-finder — the working-hours
    // default at 08–18 (the widget has no per-user prefs; the full-fidelity
    // roll-forward with custom hours lives on the calendar page).
    const todayStart = startOfLocalDay(new Date(now));
    const range = visibleRange("day", todayStart, { weekStartsOn: 1, showWeekends: true });
    const todayKey = localDayKey(todayStart);
    const busy = [
      ...taskBlocks(tasks, range).map((b) => ({ startMs: b.startMs, endMs: b.endMs })),
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
        setReloadStamp((s) => s + 1);
      })
      .catch(() => toast.error("Couldn't move those to today — try the calendar."))
      .finally(() => {
        movingRef.current = false;
      });
  }, [runtime, workspaceId, tasks, events]);

  return (
    <WidgetShell config={config} title="Today" className="flex h-full flex-col bg-card">
      {loading ? (
        <div className="grid h-full place-items-center">
          <CalendarClock className="size-6 animate-pulse text-muted-foreground motion-reduce:animate-none" aria-hidden />
        </div>
      ) : (
        <CalendarTodayList view={view} canEdit={canEdit} onMoveToToday={onMoveToToday} />
      )}
    </WidgetShell>
  );
}
