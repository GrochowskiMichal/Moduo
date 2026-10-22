// Jira's issue CSV (TV-U18; Filters → Export → "Export Excel CSV (all
// fields)"): one row per issue, with repeated columns for several values
// (Labels, Comment, Attachment). An issue's key is its issue key ("WEB-42");
// its Jira project is the Moduo project; an epic becomes a section named
// after it (its stories are the section's tasks), a sub-task a subtask; the
// status keeps its name, in the category Jira's "Status Category" column
// gives (a resolution like Won't Do makes it Won't do). Dates are the wall
// clock Jira wrote ("24/Oct/26 5:00 PM"). Original Estimate (seconds)
// becomes the estimate; story points and start dates aren't kept.

import type { TaskStatusCategory } from "@contracts/vocabularies";

import { csvColumns, headerHas, parseCsv } from "./csv";
import { jiraDue } from "./dates";
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
  keepComments,
  moveSubtasksToParents,
  personFrom,
  type PlanComment,
  planTask,
  priorityOf,
  projectNamed,
  shapeProjectTasks,
} from "./plan";

export const JIRA_COLUMNS = ["Summary", "Issue key", "Issue id", "Status"] as const;

export function looksLikeJira(header: string[]): boolean {
  return headerHas(header, JIRA_COLUMNS);
}

const STATUS_CATEGORY: Record<string, TaskStatusCategory> = {
  "to do": "todo",
  "in progress": "in_progress",
  done: "done",
};

const WONT_DO_RESOLUTIONS = new Set([
  "won't do",
  "won’t do",
  "wont do",
  "won't fix",
  "duplicate",
  "cannot reproduce",
  "declined",
  "rejected",
]);

/** "06/Oct/26 10:15 AM;<account id>;text": the text and its day (never the id). */
export function jiraComment(raw: string): PlanComment | null {
  const first = raw.indexOf(";");
  const second = first < 0 ? -1 : raw.indexOf(";", first + 1);
  if (second < 0) return raw.trim() ? { author: null, on: null, text: raw.trim() } : null;
  const text = raw.slice(second + 1).trim();
  if (!text) return null;
  return { author: null, on: jiraDue(raw.slice(0, first))?.dueOn ?? null, text };
}

export function readJira(text: string, fileName: string): ImportPlan {
  const plan = emptyPlan("jira", fileName.replace(/\.csv$/i, ""));
  const { header, rows } = parseCsv(text);
  const col = csvColumns(header);
  // Epics first: their issues file into a section named after them.
  const keyOfId = new Map<string, string>();
  const epics = new Map<string, string>();
  for (const row of rows) {
    const key = col.get(row, "Issue key");
    const id = col.get(row, "Issue id");
    if (key && id) keyOfId.set(id, key);
    if (key && col.get(row, "Issue Type").toLowerCase() === "epic") {
      epics.set(key, col.get(row, "Summary") || key);
    }
  }
  const parentKeyOf = (row: string[]): string | null => {
    const raw = col.get(row, "Parent key") || col.get(row, "Parent") || col.get(row, "Parent id");
    if (!raw) return null;
    return keyOfId.get(raw) ?? raw;
  };

  for (const row of rows) {
    const key = col.get(row, "Issue key");
    if (!key) continue;
    const project = projectNamed(
      plan,
      col.get(row, "Project name") || col.get(row, "Project key") || "Jira",
    );
    if (epics.has(key)) {
      addSection(project, epics.get(key)!);
      // The epic's own text and comments stay in Jira.
      bump(plan.notes, "epic_as_section");
      continue;
    }
    const title = col.get(row, "Summary");
    if (!title) {
      bump(plan.skipped, "untitled");
      continue;
    }
    const parent = parentKeyOf(row);
    const section = parent && epics.has(parent) ? addSection(project, epics.get(parent)!) : null;
    const stateName = col.get(row, "Status") || "To Do";
    const resolution = col.get(row, "Resolution").toLowerCase();
    let category: TaskStatusCategory =
      categoryFromName(stateName) ??
      STATUS_CATEGORY[col.get(row, "Status Category").toLowerCase()] ??
      (resolution ? "done" : "todo");
    if (category === "done" && WONT_DO_RESOLUTIONS.has(resolution)) category = "wont_do";
    const status = addStatus(project, stateName, category);
    const { priority, tag } = priorityOf(col.get(row, "Priority"));
    const labels = col.all(row, "Labels");
    const dueRaw = col.get(row, "Due Date");
    const due = jiraDue(dueRaw);
    const described = dueOrText(
      plan,
      dueRaw,
      (v) => jiraDue(v)?.dueOn ?? null,
      clipDescription(col.get(row, "Description")),
    );
    if (col.get(row, "Custom field (Start date)") || col.get(row, "Start date"))
      bump(plan.notes, "start_dropped");
    if (col.get(row, "Custom field (Story Points)") || col.get(row, "Story Points"))
      bump(plan.notes, "estimate_dropped");
    bump(plan.notes, "attachments_dropped", col.all(row, "Attachment").length);
    const seconds = Number.parseInt(col.get(row, "Original Estimate"), 10);
    const comments = col
      .all(row, "Comment")
      .map(jiraComment)
      .filter((c): c is PlanComment => c !== null);
    const assignee = col.get(row, "Assignee");
    project.tasks.push(
      planTask({
        key,
        parentKey: parent && !epics.has(parent) ? parent : null,
        title,
        description: described.description,
        section,
        status,
        category,
        dueOn: due?.dueOn ?? null,
        dueTime: due?.dueTime ?? null,
        priority,
        estimateMinutes: seconds > 0 ? Math.round(seconds / 60) : null,
        tags: cleanTags(tag ? [...labels, tag] : labels),
        assignee: personFrom(assignee),
        comments: keepComments(plan, comments),
      }),
    );
  }
  moveSubtasksToParents(plan);
  for (const project of plan.projects) shapeProjectTasks(plan, project);
  plan.projects = plan.projects.filter((p) => p.tasks.length > 0);
  return plan;
}
