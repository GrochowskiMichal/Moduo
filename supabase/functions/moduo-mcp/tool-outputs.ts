/**
 * Output schemas for the connector's main reads (MCPO-6, specs/mcp-oauth.md
 * #12, AC12): what `tasks_list`, `tasks_get`, `tasks_search`, `tasks_today`
 * and `tasks_queue` answer, so a client that calls tools from code (code mode,
 * programmatic tool calling) can type their results from `outputSchema`.
 *
 * They describe the answers as they are (the shapers in
 * _shared/tasks-connector.ts and modules/tasks.ts), never the other way round.
 * Every object is open: a field added later doesn't break a client that
 * checks answers against these, and a field shown only when it applies is
 * optional. The text answer stays the JSON it always was; `structuredContent`
 * carries the same value (server.ts). tool-annotations.test.ts and every
 * connector test that calls these tools (through-sdk.ts) check real answers
 * against them.
 */

import { z } from "zod";

import {
  energyLevelSchema,
  priorityLevelSchema,
  taskStatusCategorySchema,
} from "../_shared/contracts/vocabularies.ts";

const person = z.looseObject({ id: z.string(), name: z.string() }).describe("A member: id and name (\"Former member\" once they've left).");

/** shapeTask: one task's full shape (tasks_get adds more). */
const task = z.looseObject({
  handle: z.string().optional().describe("The task's handle, e.g. MOD-142, when its workspace has a task key."),
  id: z.string(),
  title: z.string(),
  bucket_id: z.string().nullable().describe("Its project's id."),
  status: z.string().nullable().describe("The legacy status word; status_category is the one to read."),
  status_category: taskStatusCategorySchema.optional(),
  drifted: z.boolean().describe("Open and its scheduled time has passed."),
  blocked: z.boolean().describe("An open task blocks it."),
  assignee_id: z.string().nullable().describe("null = Unassigned."),
  assignee: person.nullable().describe("null = Unassigned."),
  creator: person.optional(),
  subtask_count: z.number().optional(),
  description: z.string().optional().describe("Markdown; an excerpt in lists, in full from tasks_get."),
  parent_id: z.string().optional(),
  due_on: z.string().optional().describe("Due date, YYYY-MM-DD (the same for everyone)."),
  due_time: z.string().optional().describe("Due time, HH:MM[:SS] (the assignee's clock)."),
  due_date: z.string().optional().describe("Older due field: due_on's noon-UTC instant."),
  scheduled_at: z.string().optional(),
  duration_minutes: z.number().optional(),
  section_id: z.string().optional(),
  team_id: z.string().optional(),
  estimate_minutes: z.number().optional(),
  completed_at: z.string().optional(),
  imported_from: z.looseObject({ source: z.string().optional(), key: z.string().optional() }).optional(),
  energy_level: energyLevelSchema.optional(),
  priority: priorityLevelSchema.optional(),
  queued_by_me: z.boolean().optional().describe("In the key creator's queue."),
  committed_for: z.string().optional().describe("Older shared day list, until TV-D7."),
  commit_order: z.number().nullable().optional(),
  reschedule_count: z.number().optional(),
  recurrence: z
    .looseObject({ rrule: z.string().optional(), next_occurrence: z.string().nullable().optional() })
    .optional(),
  tags: z.array(z.string()).optional(),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  project_archived: z.boolean().optional().describe("Its project is archived."),
});

/** shapeTaskSummary: tasks_list's default short row. */
const taskSummary = z.looseObject({
  handle: z.string().optional(),
  id: z.string(),
  title: z.string(),
  status: taskStatusCategorySchema.describe("The status's category."),
  status_name: z.string().optional().describe("The project's own name for the status, when it differs."),
  priority: priorityLevelSchema.optional(),
  assignee: z.string().optional().describe("The assignee's name; absent = Unassigned."),
  project: z.string().optional().describe("The project's name, when the list spans projects."),
  section: z.string().optional(),
  tags: z.array(z.string()).optional(),
  due: z.string().optional().describe("YYYY-MM-DD, with HH:MM when timed."),
  blocked: z.boolean().optional(),
  drifted: z.boolean().optional(),
  queued_by_me: z.boolean().optional(),
  subtasks: z.number().optional().describe("How many subtasks."),
  parent: z.string().optional().describe("The parent's handle (or id)."),
  project_archived: z.boolean().optional(),
});

const titledTask = z.looseObject({ id: z.string(), title: z.string(), status: z.string().nullable() });

const taskInFull = task.extend({
  blockers: z.array(titledTask).describe("Tasks blocking this one."),
  blocking: z.array(titledTask).describe("Tasks this one blocks."),
  subtasks: z.array(titledTask.extend({ status_category: taskStatusCategorySchema.nullable().optional() })),
  work_sessions: z.array(
    z.looseObject({ id: z.string(), person, starts_at: z.string(), ends_at: z.string() }),
  ),
  my_reminders: z.array(z.looseObject({ id: z.string(), kind: z.string() })).describe("The key's person's own reminders."),
  waiting_on: z.array(
    z.looseObject({
      id: z.string(),
      kind: z.string(),
      person: person.optional(),
      label: z.string().optional(),
      since: z.string().nullable(),
    }),
  ),
  agent_sessions: z.array(z.looseObject({})).describe("Agent sessions on it the key's person can see."),
  comments: z
    .array(
      z.looseObject({
        id: z.string(),
        author: z.string(),
        at: z.string(),
        edited: z.boolean().optional(),
        body: z.string(),
      }),
    )
    .optional()
    .describe("The latest comments, newest last; only with Links: View."),
  earlier_comments: z.number().optional().describe("How many older comments comments_list reads."),
  activity: z.array(z.looseObject({ op: z.string(), created_at: z.string() })).describe("The recent attributed trail, newest first."),
});

const queue = z.array(task).describe("The key creator's queue, in order.");

/** Each main read's answer, by tool name. */
export const TOOL_OUTPUT_SCHEMAS: Record<string, z.ZodType> = {
  tasks_list: z
    .array(z.union([taskSummary, task]))
    .describe("A page of tasks: short rows by default, each task's full shape with fields: full."),
  tasks_search: z.array(task).describe("The matching tasks, full shape."),
  tasks_get: taskInFull,
  tasks_queue: z.looseObject({ queue }),
  tasks_today: z.looseObject({ date: z.string().describe("The date asked for, echoed (YYYY-MM-DD)."), queue }),
};

const listings = new Map<string, Record<string, unknown>>();

/** A tool's output schema as JSON Schema (draft-7, as its arguments are listed), or none. */
export function outputJsonSchema(toolName: string): Record<string, unknown> | undefined {
  const schema = TOOL_OUTPUT_SCHEMAS[toolName];
  if (!schema) return undefined;
  let listing = listings.get(toolName);
  if (!listing) {
    const raw = z.toJSONSchema(schema, { target: "draft-7", io: "output" }) as Record<string, unknown>;
    const { $schema: _schema, ...rest } = raw;
    listing = rest;
    listings.set(toolName, listing);
  }
  return listing;
}
