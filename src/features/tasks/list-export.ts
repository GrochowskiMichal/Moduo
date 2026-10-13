// Getting a list out (TV-D14, default f): "Copy as text" on a view or a
// project overview pastes cleanly into email or Slack; "Export view as CSV"
// gives the same tasks to a spreadsheet; the view's print layout reads the
// same lines. Pure.

import { isClosedTask, taskCategoryOf } from "@contracts/vocabularies";

import { formatDate } from "../../lib/time-format";
import { estimateOf, type Task } from "./model";
import { formatMinutes } from "./time-format";
import { csvLine, decimalHours } from "./time-report";

const CATEGORY_WORDS: Record<string, string> = {
  backlog: "Backlog",
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
  wont_do: "Won’t do",
  archived: "Won’t do",
};

export type ListExportContext = {
  /** The project's name as the reader may see it ("Private project" otherwise). */
  projectName: (projectId: string) => string;
  /** The assignee's name, or null when unassigned. */
  assigneeName: (userId: string | null) => string | null;
  /** The task's status name (the project's own), falling back to its category. */
  statusName?: (task: Task) => string | null;
  /** "MOD-142", or null. */
  handleOf?: (task: Task) => string | null;
  now?: Date;
};

function statusOf(task: Task, ctx: ListExportContext): string {
  return ctx.statusName?.(task) ?? CATEGORY_WORDS[taskCategoryOf(task)] ?? "To do";
}

function dueOf(task: Task, now: Date): string | null {
  return task.dueDate ? formatDate(task.dueDate, now) : null;
}

/** Tasks in the list's order, each subtask right under its parent when the
 *  parent is in the list too. */
function nested(tasks: readonly Task[]): Array<{ task: Task; depth: number }> {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string, Task[]>();
  for (const t of tasks) {
    if (t.parentId && ids.has(t.parentId)) {
      const list = children.get(t.parentId) ?? [];
      list.push(t);
      children.set(t.parentId, list);
    }
  }
  const out: Array<{ task: Task; depth: number }> = [];
  const walk = (t: Task, depth: number) => {
    out.push({ task: t, depth });
    for (const c of children.get(t.id) ?? []) walk(c, depth + 1);
  };
  for (const t of tasks) if (!t.parentId || !ids.has(t.parentId)) walk(t, 0);
  return out;
}

/**
 * "Copy as text": a title, then one line per task.
 *   - [ ] Send the Acme quote · due Oct 16 · Anna
 *     - [x] Draft the numbers
 */
export function tasksAsText(
  tasks: readonly Task[],
  ctx: ListExportContext,
  title?: string | null,
): string {
  const now = ctx.now ?? new Date();
  const lines: string[] = [];
  if (title) lines.push(title, "");
  for (const { task, depth } of nested(tasks)) {
    const box = isClosedTask(task) ? "[x]" : "[ ]";
    const handle = ctx.handleOf?.(task);
    const due = dueOf(task, now);
    const who = ctx.assigneeName(task.assigneeId ?? null);
    const extra = [due ? `due ${due}` : null, who].filter(Boolean).join(" · ");
    const name = `${task.title || "Untitled"}${handle ? ` (${handle})` : ""}`;
    lines.push(`${"  ".repeat(depth)}- ${box} ${name}${extra ? ` · ${extra}` : ""}`);
  }
  return lines.join("\n");
}

/**
 * "Copy as text" on a project's overview: its name, state and dates, how far
 * along it is, then its open tasks.
 */
export function projectOverviewText(
  project: {
    name: string;
    status?: string | null;
    startsOn?: string | null;
    targetOn?: string | null;
  },
  facts: { done: number; total: number; open: number },
  openTasks: readonly Task[],
  ctx: ListExportContext,
): string {
  const now = ctx.now ?? new Date();
  const day = (d: string | null | undefined) => (d ? formatDate(`${d}T12:00:00`, now) : null);
  const dates =
    project.startsOn || project.targetOn
      ? `${day(project.startsOn) ?? "…"} → ${day(project.targetOn) ?? "…"}`
      : null;
  const state = { active: "Active", on_hold: "On hold", done: "Done" }[project.status ?? "active"];
  const head = [project.name, [state, dates].filter(Boolean).join(" · ")].filter(Boolean);
  head.push(`${facts.done} of ${facts.total} done · ${facts.open} open`);
  const list = tasksAsText(openTasks, ctx);
  return list ? `${head.join("\n")}\n\n${list}` : head.join("\n");
}

/** "Export view as CSV": the tasks the view shows, one row each. */
export function tasksAsCsv(tasks: readonly Task[], ctx: ListExportContext): string {
  const out = [
    csvLine([
      "ID",
      "Title",
      "Status",
      "Project",
      "Parent",
      "Assignee",
      "Due",
      "Priority",
      "Estimate",
      "Tracked hours",
      "Created",
      "Completed",
    ]),
  ];
  const titleById = new Map(tasks.map((t) => [t.id, t.title || "Untitled"]));
  for (const { task } of nested(tasks)) {
    const estimate = estimateOf(task);
    out.push(
      csvLine([
        ctx.handleOf?.(task) ?? task.id,
        task.title || "Untitled",
        statusOf(task, ctx),
        ctx.projectName(task.bucketId),
        task.parentId ? (titleById.get(task.parentId) ?? "") : "",
        ctx.assigneeName(task.assigneeId ?? null) ?? "",
        task.dueOn ?? (task.dueDate ? task.dueDate.slice(0, 10) : ""),
        task.priority ?? "",
        estimate ? formatMinutes(estimate) : "",
        task.timeSpentSeconds > 0 ? decimalHours(task.timeSpentSeconds) : "",
        task.createdAt ? task.createdAt.slice(0, 10) : "",
        task.completedAt ? task.completedAt.slice(0, 10) : "",
      ]),
    );
  }
  return `${out.join("\r\n")}\r\n`;
}
