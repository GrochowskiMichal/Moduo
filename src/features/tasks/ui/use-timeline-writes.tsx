// What the Timeline saves (Tasks v3 TV-TL2, REPLAN 70): a drag's result, a
// click on an undated row, a ⌥←/→, the dependency mark's fix and a drop from
// the No date view. Every change is one store write with one Undo:
//   - tasks (one or a selection) through the bulk engine (`api.bulkWrite`,
//     TV-U12), which also moves a hollow point's session and a repeat's
//     occurrence;
//   - a section's dates through `api.setSectionDates`, a project's through
//     `api.setProjectDates`.
// A repeat asks first ("Just this one" or "Change the pattern", TV-U15's
// dialog). Moving a task later offers "Also move the 3 that wait on this" in
// the toast; nothing moves by itself.

import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";

import { dayWordOf, dueDayOf as dueKeyOf, tasksWord } from "../bulk";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Section, Task } from "../model";
import { engineZone } from "../recurrence-engine";
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
  | { kind: "shift"; taskIds: readonly string[]; shift: number }
  | { kind: "day"; taskId: string; day: string };

export type TimelineWrites = {
  commit: (commit: CanvasCommit) => void;
  /** Move tasks' dates by days (⌥←/→ on one, or a selection). */
  shiftTasks: (tasks: readonly Task[], shift: number) => void;
  /** Move a section's or a project's dates by days (⌥←/→ on its row). */
  shiftRow: (row: TimelineRow, shift: number) => boolean;
  /** Make a task due on a day (the dependency mark's fix, a drop from No date). */
  placeTask: (taskId: string, day: number) => void;
  /** ⇧D: clear tasks' due dates (one, or a selection). */
  clearDue: (tasks: readonly Task[]) => void;
  /** The repeat question, for the view to mount. */
  dialog: ReactNode;
};

function shiftWords(shift: number): string {
  const size = Math.abs(shift);
  const by = size === 1 ? "a day" : size === 7 ? "a week" : `${size} days`;
  return `${by} ${shift < 0 ? "earlier" : "later"}`;
}

export function useTimelineWrites(api: TasksModuleApi, zoom: TimelineZoom): TimelineWrites {
  // The newest of everything: writes run from dialogs and toasts, later.
  const latest = useRef({ api, zoom });
  useLayoutEffect(() => {
    latest.current = { api, zoom };
  });
  const [ask, setAsk] = useState<Ask | null>(null);

  const taskOf = useCallback(
    (id: string) => latest.current.api.tasks.find((t) => t.id === id) ?? null,
    [],
  );

  /** Save a plan of task moves; a move later offers the ones that wait on them. */
  const run = useRef<(plan: TaskMovePlan, shift: number) => void>(() => undefined);
  run.current = (plan, shift) => {
    const a = latest.current.api;
    if (plan.writes.length === 0) return;
    void a.bulkWrite(plan.writes, {
      label: (main) => plan.label(main),
      followUp:
        shift > 0
          ? (changed) => {
              const now = latest.current.api;
              const byId = new Map(now.tasks.map((t) => [t.id, t]));
              const waiting = waitingOn(new Set(changed), now.taskRelations ?? [], byId);
              if (waiting.length === 0) return null;
              return {
                label: waitingWords(waiting.length, changed.length),
                onClick: () =>
                  run.current(planShift(waiting, shift, "one", engineZone(), new Date()), shift),
              };
            }
          : undefined,
    });
  };

  const runShift = useCallback((tasks: readonly Task[], shift: number, choice: RepeatChoice) => {
    run.current(planShift(tasks, shift, choice, engineZone(), new Date()), shift);
  }, []);

  const runDay = useCallback((task: Task, day: string, choice: RepeatChoice) => {
    const from = dueKeyOf(task);
    const was = dayNumOfKey(from);
    const to = dayNumOfKey(day);
    const shift = was !== null && to !== null ? to - was : 0;
    run.current(planDay(task, day, choice, engineZone(), new Date()), shift);
  }, []);

  const shiftTasks = useCallback(
    (tasks: readonly Task[], shift: number) => {
      if (shift === 0 || tasks.length === 0) return;
      if (tasks.some(asksAboutRepeat)) {
        setAsk({ kind: "shift", taskIds: tasks.map((t) => t.id), shift });
        return;
      }
      runShift(tasks, shift, "one");
    },
    [runShift],
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
    return latest.current.api.sections.find((s) => s.id === id) ?? null;
  }, []);

  const projectName = useCallback((id: string): string => {
    const { api: a } = latest.current;
    return (
      a.buckets.find((b) => b.id === id)?.name ??
      a.archivedBuckets.find((b) => b.id === id)?.name ??
      "Project"
    );
  }, []);

  const sectionEnds = useCallback(
    (sectionId: string, day: number) => {
      const name = sectionNamed(sectionId)?.name ?? "";
      void latest.current.api.setSectionDates(
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
      void latest.current.api.setSectionDates(
        sectionId,
        { startsOn: keyOfDay(span.start), endsOn: keyOfDay(span.end) },
        `${name} · ${spanWords(span.start, span.end)}`,
      );
    },
    [sectionNamed],
  );

  const projectSpan = useCallback(
    (projectId: string, span: DaySpan) => {
      void latest.current.api.setProjectDates(
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

  const clearDue = useCallback((tasks: readonly Task[]) => {
    const dated = tasks.filter((t) => dueKeyOf(t));
    if (dated.length === 0) return;
    void latest.current.api.bulkWrite(
      dated.map((t) => ({ taskId: t.id, dueDate: null })),
      { label: (n) => (n === 1 ? "Due date cleared" : `Cleared the due date of ${tasksWord(n)}`) },
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
        if (current?.kind === "shift") runShift(askTasks, current.shift, choice);
        else if (current?.kind === "day" && askTasks[0]) runDay(askTasks[0], current.day, choice);
      }}
      onClose={() => setAsk(null)}
    />
  );

  return { commit, shiftTasks, shiftRow, placeTask, clearDue, dialog };
}
