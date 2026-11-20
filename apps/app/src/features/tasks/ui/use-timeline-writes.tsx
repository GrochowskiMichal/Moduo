// What the Timeline saves (Tasks v3 TV-TL2, REPLAN 70): a drag's result, a
// click on an undated row, a ⌥←/→, the dependency mark's fix and a drop from
// the No date view. Every change is one store write with one Undo:
//   - tasks (one or a selection) through the bulk engine (`bulkWrite`,
//     TV-U12), which also moves a hollow point's session and a repeat's
//     occurrence;
//   - a section's dates through `setSectionDates`, a project's through
//     `setProjectDates`.
// A repeat asks first ("Just this one" or "Change the pattern", TV-U15's
// dialog). Moving a task later offers "Also move the 3 that wait on this" in
// the toast; nothing moves by itself.

import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";

import { undoToast } from "../../../lib/undo-toast";
import { dayWordOf, dueDayOf as dueKeyOf, tasksWord } from "../bulk";
import type { Section, Task } from "../model";
import { engineZone } from "../recurrence-engine";
import { useTaskCommands, useTasksReader } from "../tasks-context";
import { waitingOn, waitingWords } from "../timeline-deps";
import {
  asksAboutRepeat,
  moveSpan,
  newBarSpan,
  planDay,
  planShift,
  type RepeatChoice,
  type TaskMovePlan,
} from "../timeline-drag";
import type { DaySpan, TimelineRow } from "../timeline-rows";
import { dayNumOfKey, keyOfDay, type TimelineZoom } from "../timeline-scale";
import { milestoneWords, spanWords } from "../timeline-words";
import { RepeatMoveDialog } from "./repeat-move-dialog";
import type { CanvasCommit } from "./use-timeline-canvas";

type Ask =
  /** `alsoUndo`: the move this one follows up ("Also move…"), undone with it. */
  | {
      kind: "shift";
      taskIds: readonly string[];
      shift: number;
      alsoUndo?: () => void;
      skipped?: number;
    }
  | { kind: "day"; taskId: string; day: string };

export type TimelineWrites = {
  commit: (commit: CanvasCommit) => void;
  /**
   * Move tasks' dates by days (⌥←/→ on one, or a selection). `skipped`: the
   * selected tasks left where they are (not yours to move), named in the toast.
   */
  shiftTasks: (tasks: readonly Task[], shift: number, skipped?: number) => void;
  /** Move a section's or a project's dates by days (⌥←/→ on its row). */
  shiftRow: (row: TimelineRow, shift: number) => boolean;
  /** Make a task due on a day (the dependency mark's fix, a drop from No date). */
  placeTask: (taskId: string, day: number) => void;
  /** ⇧D: clear tasks' due dates (one, or a selection; `skipped` as above). */
  clearDue: (tasks: readonly Task[], skipped?: number) => void;
  /** The repeat question, for the view to mount. */
  dialog: ReactNode;
};

/**
 * A selection's toast says how many of it stayed put because they aren't
 * yours to move ("Moved 3 tasks a day later · 2 not yours to move").
 */
export function withSkipped(label: string, skipped: number): string {
  return skipped > 0 ? `${label} · ${skipped} not yours to move` : label;
}

function shiftWords(shift: number): string {
  const size = Math.abs(shift);
  const by = size === 1 ? "a day" : size === 7 ? "a week" : `${size} days`;
  return `${by} ${shift < 0 ? "earlier" : "later"}`;
}

export function useTimelineWrites(zoom: TimelineZoom): TimelineWrites {
  // The newest of everything: writes run from dialogs and toasts, later.
  const commands = useTaskCommands();
  const read = useTasksReader();
  const latest = useRef({ commands, read, zoom });
  useLayoutEffect(() => {
    latest.current = { commands, read, zoom };
  });
  const [ask, setAsk] = useState<Ask | null>(null);

  const taskOf = useCallback(
    (id: string) => latest.current.read().liveTasks.find((t) => t.id === id) ?? null,
    [],
  );

  // "Also move…" calls `shiftTasks`, which is defined below.
  const shiftRef = useRef<(tasks: readonly Task[], shift: number, alsoUndo?: () => void) => void>(
    () => undefined,
  );

  /**
   * Save a plan of task moves; a move later offers the ones that wait on them.
   * `alsoUndo`: the move this one follows up, put back by the same Undo.
   */
  const run = useRef<
    (plan: TaskMovePlan, shift: number, alsoUndo?: () => void, skipped?: number) => void
  >(() => undefined);
  run.current = (plan, shift, alsoUndo, skipped = 0) => {
    if (plan.writes.length === 0) return;
    void latest.current.commands.bulkWrite(plan.writes, {
      label: (main) => withSkipped(plan.label(main), skipped),
      alsoUndo,
      followUp:
        shift > 0
          ? (changed, undoThis) => {
              const now = latest.current.read();
              const byId = new Map(now.liveTasks.map((t) => [t.id, t]));
              const waiting = waitingOn(new Set(changed), now.bundle.taskRelations ?? [], byId);
              if (waiting.length === 0) return null;
              const ids = waiting.map((t) => t.id);
              return {
                label: waitingWords(waiting.length, changed.length),
                // As they are when clicked (one may have moved meanwhile); a
                // repeat among them asks; one Undo puts both moves back.
                onClick: () => {
                  const fresh = ids.flatMap((id) => {
                    const task = latest.current.read().liveTasks.find((t) => t.id === id);
                    return task ? [task] : [];
                  });
                  shiftRef.current(fresh, shift, () => {
                    undoThis();
                    alsoUndo?.();
                  });
                },
              };
            }
          : undefined,
    });
  };

  const runShift = useCallback(
    (
      tasks: readonly Task[],
      shift: number,
      choice: RepeatChoice,
      alsoUndo?: () => void,
      skipped = 0,
    ) => {
      run.current(
        planShift(tasks, shift, choice, engineZone(), new Date()),
        shift,
        alsoUndo,
        skipped,
      );
    },
    [],
  );

  const runDay = useCallback((task: Task, day: string, choice: RepeatChoice) => {
    const from = dueKeyOf(task);
    const was = dayNumOfKey(from);
    const to = dayNumOfKey(day);
    const shift = was !== null && to !== null ? to - was : 0;
    run.current(planDay(task, day, choice, engineZone(), new Date()), shift);
  }, []);

  const shiftWith = useCallback(
    (tasks: readonly Task[], shift: number, alsoUndo?: () => void, skipped = 0) => {
      if (shift === 0 || tasks.length === 0) return;
      if (tasks.some(asksAboutRepeat)) {
        setAsk({ kind: "shift", taskIds: tasks.map((t) => t.id), shift, alsoUndo, skipped });
        return;
      }
      runShift(tasks, shift, "one", alsoUndo, skipped);
    },
    [runShift],
  );
  shiftRef.current = shiftWith;
  const shiftTasks = useCallback(
    (tasks: readonly Task[], shift: number, skipped = 0) =>
      shiftWith(tasks, shift, undefined, skipped),
    [shiftWith],
  );

  const placeTask = useCallback(
    (taskId: string, day: number) => {
      const task = taskOf(taskId);
      if (!task) return;
      const key = keyOfDay(day);
      if (dueKeyOf(task) === key) return;
      if (asksAboutRepeat(task)) {
        setAsk({ kind: "day", taskId, day: key });
        return;
      }
      runDay(task, key, "one");
    },
    [taskOf, runDay],
  );

  const sectionNamed = useCallback((id: string): Section | null => {
    return latest.current.read().sections.find((s) => s.id === id) ?? null;
  }, []);

  const projectName = useCallback((id: string): string => {
    const a = latest.current.read();
    return (
      a.buckets.find((b) => b.id === id)?.name ??
      a.archivedBuckets.find((b) => b.id === id)?.name ??
      "Project"
    );
  }, []);

  const sectionEnds = useCallback(
    (sectionId: string, day: number) => {
      const name = sectionNamed(sectionId)?.name ?? "";
      void latest.current.commands.setSectionDates(
        sectionId,
        { startsOn: null, endsOn: keyOfDay(day) },
        milestoneWords(name, day),
      );
    },
    [sectionNamed],
  );

  const sectionSpan = useCallback(
    (sectionId: string, span: DaySpan) => {
      const name = sectionNamed(sectionId)?.name || "Untitled section";
      void latest.current.commands.setSectionDates(
        sectionId,
        { startsOn: keyOfDay(span.start), endsOn: keyOfDay(span.end) },
        `${name} · ${spanWords(span.start, span.end)}`,
      );
    },
    [sectionNamed],
  );

  const projectSpan = useCallback(
    (projectId: string, span: DaySpan) => {
      void latest.current.commands.setProjectDates(
        projectId,
        { startsOn: keyOfDay(span.start), targetOn: keyOfDay(span.end) },
        `${projectName(projectId)} · ${spanWords(span.start, span.end)}`,
      );
    },
    [projectName],
  );

  const commit = useCallback(
    (c: CanvasCommit) => {
      switch (c.kind) {
        case "points": {
          const tasks = c.taskIds.map(taskOf).filter((t): t is Task => !!t);
          shiftTasks(tasks, c.delta);
          return;
        }
        case "diamond":
          sectionEnds(c.sectionId, c.day);
          return;
        case "band":
          sectionSpan(c.sectionId, c.span);
          return;
        case "bar":
          projectSpan(c.projectId, c.span);
          return;
        case "draw": {
          const { target, span } = c;
          if (target.kind === "task") {
            placeTask(target.taskId, span.end);
            return;
          }
          if (target.kind === "section") {
            if (span.start === span.end) sectionEnds(target.sectionId, span.end);
            else sectionSpan(target.sectionId, span);
            return;
          }
          projectSpan(
            target.projectId,
            c.clicked ? newBarSpan(span.start, latest.current.zoom) : span,
          );
          return;
        }
      }
    },
    [taskOf, shiftTasks, sectionEnds, sectionSpan, projectSpan, placeTask],
  );

  const shiftRow = useCallback(
    (row: TimelineRow, shift: number): boolean => {
      if (row.kind === "section" && row.section) {
        if (row.band) sectionSpan(row.section.id, moveSpan(row.band, "move", shift));
        else if (row.milestone !== null) sectionEnds(row.section.id, row.milestone + shift);
        else return false;
        return true;
      }
      if (row.kind === "project" && row.bar) {
        projectSpan(row.project.id, moveSpan(row.bar, "move", shift));
        return true;
      }
      return false;
    },
    [sectionSpan, sectionEnds, projectSpan],
  );

  const clearDue = useCallback((tasks: readonly Task[], skipped = 0) => {
    const dated = tasks.filter((t) => dueKeyOf(t));
    if (dated.length === 0) return;
    void latest.current.commands.bulkWrite(
      dated.map((t) => ({ taskId: t.id, dueDate: null })),
      {
        label: (n) =>
          withSkipped(
            n === 1 ? "Due date cleared" : `Cleared the due date of ${tasksWord(n)}`,
            skipped,
          ),
      },
    );
  }, []);

  // ── The repeat question ────────────────────────────────────────────────
  const askTasks =
    ask?.kind === "shift"
      ? ask.taskIds.map(taskOf).filter((t): t is Task => !!t)
      : ask?.kind === "day"
        ? [taskOf(ask.taskId)].filter((t): t is Task => !!t)
        : [];
  const dayLabel =
    ask?.kind === "shift"
      ? shiftWords(ask.shift)
      : ask?.kind === "day"
        ? dayWordOf(ask.day, new Date())
        : "";
  const dialog = (
    <RepeatMoveDialog
      open={ask !== null && askTasks.length > 0}
      tasks={askTasks}
      dayLabel={dayLabel}
      onChoose={(choice) => {
        const current = ask;
        setAsk(null);
        if (current?.kind === "shift") {
          runShift(askTasks, current.shift, choice, current.alsoUndo, current.skipped);
        } else if (current?.kind === "day" && askTasks[0]) runDay(askTasks[0], current.day, choice);
      }}
      onClose={() => {
        const current = ask;
        setAsk(null);
        // A cancelled "Also move…": the first move keeps its Undo (its toast
        // closed when the link was used).
        if (current?.kind === "shift" && current.alsoUndo) {
          undoToast("Moved", {
            description: "The ones that wait on it stay where they are.",
            onUndo: current.alsoUndo,
          });
        }
      }}
    />
  );

  return { commit, shiftTasks, shiftRow, placeTask, clearDue, dialog };
}
