// Asana's project CSV (TV-U18; a project's ⌄ → Export/Print → CSV): one row
// per task, subtasks included ("Parent task" names the parent by its name).
// A task's key is its Task ID; the project is "Projects" (its first, when a
// task sits in several), else the file's name; "Section/Column" is the
// section; "Completed At" makes it done; "Assignee Email" finds the person.
// Start dates aren't kept.

import { csvColumns, headerHas, parseCsv } from "./csv";
import { isoDay, slashDue } from "./dates";
import {
  addSection,
  bump,
  cleanTags,
  clipDescription,
  dueOrText,
  emptyPlan,
  type ImportPlan,
  moveSubtasksToParents,
  personFrom,
  planTask,
  priorityOf,
  projectNamed,
  shapeProjectTasks,
} from "./plan";

export const ASANA_COLUMNS = ["Task ID", "Name", "Section/Column", "Completed At"] as const;

export function looksLikeAsana(header: string[]): boolean {
  return headerHas(header, ASANA_COLUMNS);
}

const dayOf = (v: string) => isoDay(v) ?? slashDue(v)?.dueOn ?? null;

export function readAsana(text: string, fileName: string): ImportPlan {
  const fallback = fileName.replace(/\.csv$/i, "") || "Asana";
  const plan = emptyPlan("asana", fallback);
  const { header, rows } = parseCsv(text);
  const col = csvColumns(header);
  // "Parent task" is a name: the first task of that name in the file.
  const idOfName = new Map<string, string>();
  for (const row of rows) {
    const name = col.get(row, "Name").toLowerCase();
    const id = col.get(row, "Task ID");
    if (name && id && !idOfName.has(name)) idOfName.set(name, id);
  }
  for (const row of rows) {
    const id = col.get(row, "Task ID");
    if (!id) continue;
    const title = col.get(row, "Name");
    if (!title) {
      bump(plan.skipped, "untitled");
      continue;
    }
    const projectName = col.get(row, "Projects").split(",")[0]?.trim() || fallback;
    const project = projectNamed(plan, projectName);
    const parentName = col.get(row, "Parent task");
    const parentKey = parentName ? (idOfName.get(parentName.toLowerCase()) ?? null) : null;
    const section = parentKey ? null : addSection(project, col.get(row, "Section/Column"));
    if (col.get(row, "Start Date")) bump(plan.notes, "start_dropped");
    const { priority, tag } = priorityOf(col.get(row, "Priority"));
    const tags = col
      .get(row, "Tags")
      .split(",")
      .map((t) => t.trim());
    const due = dueOrText(
      plan,
      col.get(row, "Due Date"),
      dayOf,
      clipDescription(col.get(row, "Notes")),
    );
    project.tasks.push(
      planTask({
        key: id,
        parentKey,
        title,
        description: due.description,
        section,
        category: col.get(row, "Completed At") ? "done" : "todo",
        dueOn: due.dueOn,
        priority,
        tags: cleanTags(tag ? [...tags, tag] : tags),
        assignee: personFrom(col.get(row, "Assignee"), col.get(row, "Assignee Email")),
      }),
    );
  }
  moveSubtasksToParents(plan);
  for (const project of plan.projects) shapeProjectTasks(plan, project);
  plan.projects = plan.projects.filter((p) => p.tasks.length > 0);
  return plan;
}
