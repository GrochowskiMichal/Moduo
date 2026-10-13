// Upcoming on the List (tasks-v3 §8, call 83; TV-U15): its scope, its day
// groups and headers, its row words, and moving rows between days — a drop
// on another day, Earlier's "Move all…", ⌥←/→ (a day) and ⌥⇧←/→ (a week),
// `t` (Today). A repeat asks "Move just this one · Change the pattern"
// first (27 g). Every move ends in one Undo. The rows, groups, keys and
// states are the List's; this hook hands it what differs (list-extensions).

import { isOpenTask } from "@contracts/vocabularies";
import { ChevronDown } from "lucide-react";
import { type ReactNode, useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "../../../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../../components/ui/dropdown-menu";
import { formatDay } from "../../../lib/time-format";
import { undoToast } from "../../../lib/undo-toast";
import { daysLeftInWeek } from "../day-buckets";
import { todayStr } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { type GroupAddState, groupAddState } from "../list-group-add";
import type { Task } from "../model";
import { changePatternRule, engineZone } from "../recurrence-engine";
import {
  dropDayFor,
  inUpcoming,
  moveToDay,
  orderUpcoming,
  rowDay,
  shiftDay,
  stillMoved,
  upcomingAccepts,
  upcomingGroupOf,
  upcomingGroups,
  upcomingHeaderLine,
  upcomingWhen,
} from "../upcoming";
import { nowOn, useToday } from "../use-today";
import { DayPickerDialog } from "./day-picker-dialog";
import type { ListGrouping } from "./list-extensions";
import { RepeatMoveDialog } from "./repeat-move-dialog";

type UpcomingApi = Pick<
  TasksModuleApi,
  "tasks" | "teamMembers" | "patchTask" | "scheduleTaskAt" | "moveOccurrence" | "currentUserId"
>;

/** What's waiting on the person: the repeat question, or a day to pick. */
type Pending =
  | { kind: "repeat"; taskIds: string[]; day: string }
  | { kind: "pick"; taskIds: string[] };

const NONE: GroupAddState = { kind: "none" };

/** "Thu", "Tomorrow", "Oct 30": a day key in the one grammar. */
function dayWord(day: string, now: Date): string {
  const [y, m, d] = day.split("-").map(Number);
  return formatDay(new Date(y ?? 0, (m ?? 1) - 1, d ?? 1), now);
}

/** Next Monday, as the date panel's "Next week" (a day key). */
function nextWeek(now: Date): string {
  return shiftDay(todayStr(now), daysLeftInWeek(now) + 1);
}

export function useUpcomingView({
  api,
  canEdit,
  inboxId,
  projectIds,
}: {
  api: UpcomingApi;
  canEdit: boolean;
  inboxId: string | null;
  /** The sidebar's project order (Upcoming's last tie-break). */
  projectIds: readonly string[];
}): {
  /** Upcoming's tasks before Filter and search (the coverage rule). */
  scope: Task[];
  grouping: ListGrouping;
  onViewKey: (event: React.KeyboardEvent<HTMLDivElement>, selected: Task | null) => boolean;
  /** The repeat question and the day picker, mounted by the page. */
  dialogs: ReactNode;
} {
  const today = useToday();
  const me = api.currentUserId ?? null;
  const myTeams = useMemo(
    () => new Set(api.teamMembers.filter((m) => m.userId === me).map((m) => m.teamId)),
    [api.teamMembers, me],
  );
  const scope = useMemo(() => {
    const now = nowOn(today);
    return api.tasks.filter((t) => inUpcoming(t, { me, myTeams }, now));
  }, [api.tasks, me, myTeams, today]);
  const scopeIds = useMemo(() => new Set(scope.map((t) => t.id)), [scope]);

  // The newest API and tasks for the writes (they run from toasts and dialogs).
  const latest = useRef(api);
  useLayoutEffect(() => {
    latest.current = api;
  });
  const current = useCallback(
    (id: string) => latest.current.tasks.find((t) => t.id === id) ?? null,
    [],
  );

  /**
   * Move rows to a day, one Undo for all. A repeat moves just this one, or its
   * pattern (`choice`). Undo puts back what each move changed, unless it
   * changed again since (Undo never overwrites a newer change).
   */
  const moveTasks = useCallback(
    (tasks: readonly Task[], day: string, choice: "one" | "pattern" = "one") => {
      const now = new Date();
      const writer = latest.current;
      const undos: Array<() => void> = [];
      for (const task of tasks) {
        const write = moveToDay(task, day);
        if (!write) continue;
        const before = { dueDate: task.dueDate, scheduledAt: task.scheduledAt };
        if (task.recurrence && choice === "pattern") {
          const to = new Date(write.kind === "due" ? write.dueDate : write.scheduledAt);
          const rule = changePatternRule(task.recurrence, to, engineZone());
          writer.patchTask(
            task.id,
            write.kind === "due"
              ? { recurrence: rule, dueDate: write.dueDate }
              : { recurrence: rule, scheduledAt: write.scheduledAt },
          );
          const ruleBefore = task.recurrence;
          undos.push(() => {
            const now2 = current(task.id);
            // Still the rule and the day this move made (the server works the
            // rule's pointer out again, so compare the pattern, not the JSON).
            if (!now2 || now2.recurrence?.rrule !== rule.rrule || !stillMoved(now2, write)) return;
            latest.current.patchTask(
              task.id,
              write.kind === "due"
                ? { recurrence: ruleBefore, dueDate: before.dueDate }
                : { recurrence: ruleBefore, scheduledAt: before.scheduledAt },
            );
          });
        } else if (task.recurrence) {
          const back = rowDay(task);
          writer.moveOccurrence(
            task.id,
            write.kind === "due" ? { dueOn: day } : { startsAt: write.scheduledAt },
          );
          undos.push(() => {
            if (!back || !stillMoved(current(task.id), write)) return;
            latest.current.moveOccurrence(
              task.id,
              write.kind === "due"
                ? { dueOn: back }
                : { startsAt: before.scheduledAt ?? write.scheduledAt },
            );
          });
        } else if (write.kind === "due") {
          writer.patchTask(task.id, { dueDate: write.dueDate });
          undos.push(() => {
            if (!stillMoved(current(task.id), write)) return;
            latest.current.patchTask(task.id, { dueDate: before.dueDate });
          });
        } else {
          writer.scheduleTaskAt(task.id, write.scheduledAt);
          undos.push(() => {
            if (!stillMoved(current(task.id), write) || !before.scheduledAt) return;
            latest.current.scheduleTaskAt(task.id, before.scheduledAt);
          });
        }
      }
      if (undos.length === 0) return;
      const where = dayWord(day, now);
      const label =
        undos.length === 1 ? `Moved to ${where}` : `Moved ${undos.length} tasks to ${where}`;
      undoToast(label, {
        onUndo: () => {
          for (const undo of undos) undo();
        },
      });
    },
    [current],
  );

  const [pending, setPending] = useState<Pending | null>(null);

  /** Move rows to a day; a repeat among them asks first. */
  const requestMove = useCallback(
    (tasks: readonly Task[], day: string) => {
      if (!canEdit) return;
      const moving = tasks.filter((t) => moveToDay(t, day));
      if (moving.length === 0) return;
      if (moving.some((t) => t.recurrence)) {
        setPending({ kind: "repeat", taskIds: moving.map((t) => t.id), day });
        return;
      }
      moveTasks(moving, day);
    },
    [canEdit, moveTasks],
  );

  const projectRank = useMemo(() => {
    const rank = new Map<string, number>();
    if (inboxId) rank.set(inboxId, -1);
    projectIds.forEach((id, i) => {
      rank.set(id, i);
    });
    return (id: string) => rank.get(id) ?? projectIds.length;
  }, [inboxId, projectIds]);

  const grouping = useMemo<ListGrouping>(
    () => ({
      groups: (tasks, now) => upcomingGroups(orderUpcoming(tasks, projectRank), now),
      keyOf: (task, now) => upcomingGroupOf(task, now),
      header: (group, now) => {
        const line = upcomingHeaderLine(group.key as "today", group.tasks, now);
        if (line !== null) return { sub: line };
        return { count: group.tasks.filter((t) => isOpenTask(t)).length };
      },
      headerAction: (group) => {
        if (group.key !== "earlier") return null;
        const open = group.tasks.filter((t) => isOpenTask(t));
        if (open.length === 0) return null;
        return (
          <MoveAllMenu
            count={open.length}
            onMove={(day) => requestMove(open, day)}
            onPick={() => setPending({ kind: "pick", taskIds: open.map((t) => t.id) })}
          />
        );
      },
      accepts: (key, task) => upcomingAccepts(key, task, new Date()),
      onDrop: (key, task) => {
        const day = dropDayFor(key, new Date());
        if (day === "pick") setPending({ kind: "pick", taskIds: [task.id] });
        else if (day) requestMove([task], day);
      },
      // "+" adds only in its days (U10's note): Earlier and Later have none.
      addState: (key) =>
        key === "earlier" || key === "later"
          ? NONE
          : groupAddState({ scope: "upcoming", groupBy: "date", key, canEdit, today, inboxId }),
      whenOf: upcomingWhen,
    }),
    [projectRank, requestMove, canEdit, today, inboxId],
  );

  const onViewKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, selected: Task | null): boolean => {
      if (!selected || !canEdit || !scopeIds.has(selected.id)) return false;
      if (event.metaKey || event.ctrlKey) return false;
      const now = new Date();
      const todayKey = todayStr(now);
      const from = rowDay(selected);
      if (!from) return false;
      let target: string | null = null;
      if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        const delta = (event.key === "ArrowRight" ? 1 : -1) * (event.shiftKey ? 7 : 1);
        target = shiftDay(from, delta);
      } else if (!event.altKey && event.key.toLowerCase() === "t") {
        target = todayKey;
      } else {
        return false;
      }
      // A new date is never in the past: the earliest is today.
      if (target < todayKey) target = todayKey;
      if (target !== from) requestMove([selected], target);
      return true;
    },
    [canEdit, scopeIds, requestMove],
  );

  const pendingTasks = pending
    ? pending.taskIds.flatMap((id) => {
        const t = current(id);
        return t ? [t] : [];
      })
    : [];
  const close = () => setPending(null);
  const dialogs = (
    <>
      <RepeatMoveDialog
        open={pending?.kind === "repeat"}
        tasks={pendingTasks}
        dayLabel={pending?.kind === "repeat" ? dayWord(pending.day, new Date()) : ""}
        onChoose={(choice) => {
          if (pending?.kind === "repeat") moveTasks(pendingTasks, pending.day, choice);
          close();
        }}
        onClose={close}
      />
      <DayPickerDialog
        open={pending?.kind === "pick"}
        title={
          pendingTasks.length === 1
            ? `Move “${pendingTasks[0]?.title || "Untitled"}” to…`
            : `Move ${pendingTasks.length} tasks to…`
        }
        onPick={(day) => {
          const tasks = pendingTasks;
          const picked = todayStr(day);
          // A new date is never in the past (the keys clamp the same way).
          if (picked < todayStr(new Date())) {
            toast("Pick today or a day after.");
            return;
          }
          close();
          requestMove(tasks, picked);
        }}
        onClose={close}
      />
    </>
  );

  return { scope, grouping, onViewKey, dialogs };
}

/** Earlier's "Move all…": Today · Tomorrow · Next week · Pick…. */
function MoveAllMenu({
  count,
  onMove,
  onPick,
}: {
  count: number;
  onMove: (day: string) => void;
  onPick: () => void;
}) {
  const now = new Date();
  const today = todayStr(now);
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          aria-label={`Move all ${count} earlier tasks`}
          onClick={(e) => e.stopPropagation()}
        >
          Move all…
          <ChevronDown aria-hidden className="size-icon-xs" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={() => onMove(today)}>Today</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMove(shiftDay(today, 1))}>Tomorrow</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onMove(nextWeek(now))}>Next week</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onPick}>Pick…</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
