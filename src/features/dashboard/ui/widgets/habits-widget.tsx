// DB-7 — "Habits" widget. Daily checkboxes + streaks over the shared `habits`
// table (multiple Habits widgets show the same habits). Ticking today is the one
// sanctioned accent "done-check" (R5). Add is inline (no config popover yet — DB-8);
// remove has an Undo. Degrades to a calm empty state pre-migration (the table is
// deploy-gated).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { getRuntime } from "@/lib/runtime";
import { undoToast } from "@/lib/undo-toast";
import { todayStr } from "@/features/tasks/helpers";
import type { HabitRow } from "@/lib/runtime.types";

import {
  requestDashboardDataRefresh,
  useDashboardData,
} from "../../context/dashboard-data-context";
import {
  computeStreak,
  isChecked,
  nextHabitEmoji,
  nextPosition,
  recentDays,
  sortHabits,
  toggleCheck,
} from "../../habits";
import { useDensity } from "../../hooks/use-density";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { WidgetBodyRoot, WidgetEmpty, WidgetLoading, WidgetMore } from "./widget-primitives";

function HabitRowView({
  habit,
  today,
  checks,
  showWeek,
  onToggle,
  onRemove,
}: {
  habit: HabitRow;
  today: string;
  checks: string[];
  showWeek: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const streak = computeStreak(checks, today);
  const checkedToday = isChecked(checks, today);
  const week = recentDays(today, 7);

  return (
    <li className="group flex min-h-[var(--row-h)] items-center gap-2 rounded-md px-2 py-1 hover:bg-accent">
      <span className="w-5 shrink-0 text-center text-sm" aria-hidden>
        {habit.emoji || "•"}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{habit.name}</span>

      {showWeek ? (
        <span className="flex shrink-0 items-center gap-0.5" aria-hidden>
          {week.map((day) => (
            <span
              key={day}
              className={cn(
                "size-1.5 rounded-full",
                isChecked(checks, day) ? "bg-primary" : "bg-border",
              )}
            />
          ))}
        </span>
      ) : null}

      {streak > 0 ? (
        <span className="shrink-0 text-2xs tabular-nums text-muted-foreground/80">{streak}d</span>
      ) : null}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${habit.name}`}
        className="shrink-0 rounded-sm text-muted-foreground/0 transition-colors group-hover:text-muted-foreground/70 hover:!text-foreground focus-visible:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="size-icon-xs" aria-hidden />
      </button>

      <button
        type="button"
        onClick={onToggle}
        aria-label={`${checkedToday ? "Uncheck" : "Check"} ${habit.name} for today`}
        aria-pressed={checkedToday}
        className={cn(
          "grid size-icon-lg shrink-0 place-items-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checkedToday
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border text-transparent hover:border-foreground/40",
        )}
      >
        <Check className="size-icon-xs" aria-hidden />
      </button>
    </li>
  );
}

function AddHabit({ onAdd }: { onAdd: (name: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (adding) inputRef.current?.focus();
  }, [adding]);

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onAdd(trimmed);
    setName("");
    setAdding(false);
  };

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mx-1.5 mb-1.5 mt-0.5 flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus className="size-icon-xs" aria-hidden />
        New habit
      </button>
    );
  }

  return (
    <div className="mx-1.5 mb-1.5 mt-0.5 shrink-0">
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
          else if (e.key === "Escape") {
            setName("");
            setAdding(false);
          }
        }}
        onBlur={submit}
        placeholder="Name a habit…"
        className="h-[var(--ctrl-h-sm)] w-full rounded-md border border-border bg-muted px-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
    </div>
  );
}

export function HabitsWidget({ size }: WidgetComponentProps) {
  const { habits: source, workspaceId } = useDashboardData();
  const density = useDensity();
  const today = todayStr();

  const sorted = useMemo(() => sortHabits(source.data), [source.data]);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());

  // Optimistic checks: `pending[id]` overrides the server value until its write
  // settles. There is deliberately NO blanket re-seed from the source — that would
  // clobber an in-flight tick on the very reload the tick triggers. Instead each
  // habit's writes are serialized (one flush loop per id), coalesce rapid taps,
  // and the override is cleared only after the server reflects it.
  const [pending, setPending] = useState<Record<string, string[]>>({});
  const pendingRef = useRef(pending);
  useEffect(() => {
    pendingRef.current = pending;
  });
  const inflightRef = useRef<Set<string>>(new Set());

  const setHabitPending = useCallback((id: string, checks: string[] | undefined) => {
    setPending((prev) => {
      if (checks === undefined) {
        if (!(id in prev)) return prev;
        const rest = { ...prev };
        delete rest[id];
        return rest;
      }
      return { ...prev, [id]: checks };
    });
  }, []);

  const flush = useCallback(
    async (id: string) => {
      const runtime = getRuntime();
      if (!runtime || inflightRef.current.has(id)) return;
      inflightRef.current.add(id);
      try {
        // Write the latest desired checks until it stops changing, then reload and
        // clear the override (only if no newer tap superseded it meanwhile).
        while (true) {
          const target = pendingRef.current[id];
          if (target === undefined) break;
          await runtime.habits.setChecks({ id, checks: target });
          if (pendingRef.current[id] !== target) continue; // a newer tap — write again
          await source.reload();
          if (pendingRef.current[id] === target) setHabitPending(id, undefined);
          break;
        }
      } catch {
        setHabitPending(id, undefined);
        toast.error("Couldn't save that.");
      } finally {
        inflightRef.current.delete(id);
      }
    },
    [source, setHabitPending],
  );

  const checksOf = (habit: HabitRow): string[] => pending[habit.id] ?? habit.checks;

  const onToggle = useCallback(
    (habit: HabitRow) => {
      const base = pendingRef.current[habit.id] ?? habit.checks;
      setHabitPending(habit.id, toggleCheck(base, today));
      void flush(habit.id);
    },
    [today, flush, setHabitPending],
  );

  const onAdd = useCallback(
    (name: string) => {
      const runtime = getRuntime();
      if (!runtime || !workspaceId) return;
      void runtime.habits
        .upsert({
          workspaceId,
          name,
          emoji: nextHabitEmoji(sorted.length),
          position: nextPosition(sorted),
        })
        .then(() => source.reload())
        .catch(() => toast.error("Couldn't add that habit."));
    },
    [workspaceId, sorted, source],
  );

  const onRemove = useCallback(
    (habit: HabitRow) => {
      const runtime = getRuntime();
      if (!runtime || !workspaceId) return;
      setRemovedIds((prev) => new Set(prev).add(habit.id));
      void runtime.habits
        .remove(habit.id)
        .then(() => {
          source.reload();
          undoToast(`Removed “${habit.name}”`, {
            onUndo: () => {
              void runtime.habits
                .upsert({
                  workspaceId,
                  name: habit.name,
                  emoji: habit.emoji,
                  position: habit.position,
                })
                .then((created) =>
                  habit.checks.length > 0
                    ? runtime.habits.setChecks({ id: created.id, checks: habit.checks })
                    : undefined,
                )
                .then(() => {
                  setRemovedIds((prev) => {
                    const nextSet = new Set(prev);
                    nextSet.delete(habit.id);
                    return nextSet;
                  });
                  source.reload();
                })
                .catch(() => toast.error("Couldn't restore that habit."));
            },
          });
        })
        .catch(() => {
          setRemovedIds((prev) => {
            const nextSet = new Set(prev);
            nextSet.delete(habit.id);
            return nextSet;
          });
          toast.error("Couldn't remove that habit.");
        });
    },
    [workspaceId, source],
  );

  if (source.loading && sorted.length === 0) return <WidgetLoading />;

  const visible = sorted.filter((habit) => !removedIds.has(habit.id));
  const budget = widgetRowBudget(size, density);
  const shown = visible.slice(0, budget);
  const overflow = visible.length - shown.length;
  const showWeek = size === "L";

  return (
    <WidgetBodyRoot>
      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col">
          <WidgetEmpty>No habits yet. Add one to start a streak.</WidgetEmpty>
          <AddHabit onAdd={onAdd} />
        </div>
      ) : (
        <>
          <ul className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto scrollbar-thin p-1.5 pb-0">
            {shown.map((habit) => (
              <HabitRowView
                key={habit.id}
                habit={habit}
                today={today}
                checks={checksOf(habit)}
                showWeek={showWeek}
                onToggle={() => onToggle(habit)}
                onRemove={() => onRemove(habit)}
              />
            ))}
          </ul>
          <WidgetMore count={overflow} />
          <AddHabit onAdd={onAdd} />
        </>
      )}
    </WidgetBodyRoot>
  );
}
