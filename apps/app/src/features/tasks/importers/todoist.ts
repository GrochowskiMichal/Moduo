// Todoist's project CSV (TV-U18; "Export as CSV" on a project): one row per
// item, TYPE `task` · `section` · `note` (a comment on the task above), INDENT
// 1–4 for subtasks, labels written into the title as "@label", PRIORITY 1
// (p1, the highest) to 4 (none), DATE in words ("every monday",
// "Oct 27 2026 17:00"), DURATION in minutes, DEADLINE a date. The file is
// one project, named after the file. Todoist writes no task ids, so a task's
// key is a hash of where it sits and what it's called (a re-run of the same
// file finds it again).

import { csvColumns, headerHas, parseCsv } from "./csv";
import { wordsDue } from "./dates";
import {
  addSection,
  bump,
  cleanTags,
  clipDescription,
  emptyPlan,
  hashText,
  type ImportPlan,
  keepComments,
  personFrom,
  type PlanTask,
  planTask,
  projectNamed,
  shapeProjectTasks,
} from "./plan";

export const TODOIST_COLUMNS = ["TYPE", "CONTENT", "PRIORITY", "INDENT"] as const;

export function looksLikeTodoist(header: string[]): boolean {
  return headerHas(header, TODOIST_COLUMNS);
}

const TODOIST_PRIORITY = { "1": "high", "2": "medium", "3": "low" } as const;

/** "Read chapter 1 @reading @week1" → title and labels. */
export function splitLabels(content: string): { title: string; labels: string[] } {
  const labels: string[] = [];
  const title = content
    .replace(/(^|\s)@([\p{L}\p{N}_\-./]+)/gu, (_m, lead: string, name: string) => {
      labels.push(name);
      return lead;
    })
    .replace(/\s+/g, " ")
    .trim();
  return { title, labels };
}

export function readTodoist(text: string, fileName: string, now: Date = new Date()): ImportPlan {
  const projectName =
    fileName
      .replace(/\.csv$/i, "")
      .replace(/\s*\(\d+\)$/, "")
      .replace(/[_]+/g, " ")
      .trim() || "Todoist";
  const plan = emptyPlan("todoist", projectName);
  const { header, rows } = parseCsv(text);
  const col = csvColumns(header);
  const project = projectNamed(plan, projectName);
  let section: string | null = null;
  // The open task at each indent (1-based), for subtasks and notes.
  const stack: PlanTask[] = [];
  let last: PlanTask | null = null;
  const seen = new Map<string, number>();
  const projectNotes: string[] = [];

  for (const row of rows) {
    const type = col.get(row, "TYPE").toLowerCase();
    const content = col.get(row, "CONTENT");
    if (type === "section") {
      section = addSection(project, content);
      stack.length = 0;
      last = null;
      continue;
    }
    if (type === "note") {
      if (!content) continue;
      const author = col.get(row, "AUTHOR").replace(/\s*\(\d+\)\s*$/, "") || null;
      if (last) last.comments.push({ author, on: null, text: content });
      else projectNotes.push(content);
      continue;
    }
    if (type !== "task") continue;

    const { title, labels } = splitLabels(content);
    if (!title) {
      bump(plan.skipped, "untitled");
      continue;
    }
    const indent = Math.max(
      1,
      Math.min(4, Number.parseInt(col.get(row, "INDENT") || "1", 10) || 1),
    );
    const parent = indent > 1 ? (stack[indent - 2] ?? null) : null;
    // The file is one project, so its name (which a re-download renames,
    // "CS 201 (1).csv") stays out of the key.
    const where = [section ?? "", parent?.title ?? "", title].join("␟");
    const nth = (seen.get(where) ?? 0) + 1;
    seen.set(where, nth);

    const description: string[] = [];
    const desc = col.get(row, "DESCRIPTION");
    if (desc) description.push(desc);
    let dueOn: string | null = null;
    let dueTime: string | null = null;
    let recurrence: PlanTask["recurrence"] = null;
    const dateWords = col.get(row, "DATE");
    if (dateWords) {
      const due = wordsDue(dateWords, now);
      if (due.kind === "date") {
        dueOn = due.due.dueOn;
        dueTime = due.due.dueTime;
        recurrence = due.recurrence;
      } else if (due.kind === "text") {
        description.push(`${due.repeat ? "Repeats in Todoist" : "Date in Todoist"}: ${dateWords}`);
        bump(plan.notes, due.repeat ? "repeat_as_text" : "date_as_text");
      }
    }
    const deadline = col.get(row, "DEADLINE");
    if (deadline) {
      const due = wordsDue(deadline, now);
      if (due.kind === "date" && !due.recurrence && !dueOn) dueOn = due.due.dueOn;
      else description.push(`Deadline in Todoist: ${deadline}`);
    }
    const priority =
      TODOIST_PRIORITY[col.get(row, "PRIORITY") as keyof typeof TODOIST_PRIORITY] ?? null;
    const responsible = col.get(row, "RESPONSIBLE");
    const minutes = Number.parseInt(col.get(row, "DURATION"), 10);
    const perDay = col.get(row, "DURATION_UNIT").toLowerCase() === "day";

    const task = planTask({
      key: `todoist-${hashText(`${where}␟${nth}`)}`,
      parentKey: parent?.key ?? null,
      title,
      description: clipDescription(description.join("\n\n")),
      section,
      dueOn,
      dueTime,
      recurrence,
      priority,
      // A day of work counts as eight hours.
      estimateMinutes: minutes > 0 ? (perDay ? minutes * 480 : minutes) : null,
      tags: cleanTags(labels),
      // "Alex Kim (51882011)": the name, without Todoist's user id.
      assignee: personFrom(responsible.replace(/\s*\(\d+\)\s*$/, "")),
    });
    project.tasks.push(task);
    stack.length = indent - 1;
    stack[indent - 1] = task;
    last = task;
  }

  for (const t of project.tasks) t.comments = keepComments(plan, t.comments);
  if (projectNotes.length) project.description = clipDescription(projectNotes.join("\n\n"));
  shapeProjectTasks(plan, project);
  if (project.tasks.length === 0) plan.projects = [];
  return plan;
}
