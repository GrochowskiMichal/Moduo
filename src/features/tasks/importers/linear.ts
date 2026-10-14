// Linear's issue CSV (TV-U18; a view's ⋯ → Export as CSV): one row per
// issue. An issue's key is its ID ("ENG-123", findable after import, AC3.6);
// its Linear project is the Moduo project (issues without one go to a project
// named after their team), its project milestone the section, its workflow
// state a status of the project with the category the state's own columns
// say (Completed → Done, Canceled → Won't do, Started → In progress, else by
// the name). "Parent issue" makes subtasks; estimates are points, which
// Moduo doesn't keep.

import type { TaskStatusCategory } from "@contracts/vocabularies";
import { csvColumns, headerHas, parseCsv } from "./csv";
import { isoDay } from "./dates";
import {
  addSection,
  addStatus,
  bump,
  categoryFromName,
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

export const LINEAR_COLUMNS = ["ID", "Team", "Title", "Status"] as const;

export function looksLikeLinear(header: string[]): boolean {
  return headerHas(header, LINEAR_COLUMNS) && headerHas(header, ["Parent issue"]);
}

export function readLinear(text: string, fileName: string): ImportPlan {
  const plan = emptyPlan("linear", fileName.replace(/\.csv$/i, ""));
  const { header, rows } = parseCsv(text);
  const col = csvColumns(header);
  for (const row of rows) {
    const id = col.get(row, "ID");
    const title = col.get(row, "Title");
    if (!id) continue;
    if (!title) {
      bump(plan.skipped, "untitled");
      continue;
    }
    if (col.get(row, "Archived")) {
      bump(plan.skipped, "archived");
      continue;
    }
    const project = projectNamed(plan, col.get(row, "Project") || col.get(row, "Team") || "Linear");
    const stateName = col.get(row, "Status") || "Todo";
    const category: TaskStatusCategory = col.get(row, "Canceled")
      ? "wont_do"
      : col.get(row, "Completed")
        ? "done"
        : (categoryFromName(stateName) ?? (col.get(row, "Started") ? "in_progress" : "todo"));
    const status = addStatus(project, stateName, category);
    const section = addSection(project, col.get(row, "Project Milestone"));
    const { priority, tag } = priorityOf(col.get(row, "Priority"));
    const labels = col
      .get(row, "Labels")
      .split(",")
      .map((l) => l.trim());
    if (col.get(row, "Estimate")) bump(plan.notes, "estimate_dropped");
    const assignee = col.get(row, "Assignee");
    const due = dueOrText(
      plan,
      col.get(row, "Due Date"),
      isoDay,
      clipDescription(col.get(row, "Description")),
    );
    project.tasks.push(
      planTask({
        key: id,
        parentKey: col.get(row, "Parent issue") || null,
        title,
        description: due.description,
        section,
        status,
        category,
        dueOn: due.dueOn,
        priority,
        tags: cleanTags(tag ? [...labels, tag] : labels),
        assignee: personFrom(assignee),
      }),
    );
  }
  moveSubtasksToParents(plan);
  for (const project of plan.projects) shapeProjectTasks(plan, project);
  plan.projects = plan.projects.filter((p) => p.tasks.length > 0);
  return plan;
}
