/**
 * MCP tool argument schemas. Runtime parsers and (where used) JSON Schema
 * listings share this catalog (zod-enum-foundation task 6).
 */

import { z } from "zod";

import { parseOrStructured } from "./errors.ts";
import {
  agentSessionStateSchema,
  energyLevelSchema,
  priorityLevelSchema,
  projectStateSchema,
  recurrenceModeSchema,
  relationKindSchema,
  taskReminderKindSchema,
  taskStatusCategorySchema,
  taskStatusSchema,
  templateKindSchema,
} from "./vocabularies.ts";

const nonempty = z.string().trim().min(1);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const hhmm = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "must be HH:MM");
const iso = z.string().trim().min(1);
const limit = z.coerce.number().int().min(1).max(200).optional();
const wideLimit = z.coerce.number().int().min(1).max(500).optional();
const listStatusSchema = z.union([z.literal("open"), taskStatusSchema]);
/** tasks_list's category: one category, open (to do + in progress) or closed. */
const listCategorySchema = z.union([z.literal("open"), z.literal("closed"), taskStatusCategorySchema]);
const minutes = z.coerce.number().int().min(0).max(100000);
const tagName = z.string().trim().min(1).max(50);
const projectDescription = z.string().max(20000);
/** A repeat: an RRULE string, or {rrule, mode}. */
const repeatSchema = z.union([
  z.string().trim().min(1).max(500),
  z.object({ rrule: z.string().trim().min(1).max(500), mode: recurrenceModeSchema.optional() }).strict(),
]);
/** Where an import brought a task from: an open source name and its key there. */
const importedFromSchema = z
  .object({ source: z.string().trim().min(1).max(40), key: z.string().trim().min(1).max(200) })
  .strict();

// What a call keeps: `parseToolArgs` strips any key a schema here lacks, even one the tool's
// `inputSchema` promises (MOD-92). Add a field to both; moduo-mcp/tool-schemas.test.ts checks they
// agree, and handler tests should call through `parseToolArgs` (tasks-v3.test.ts's `call`).
export const TOOL_ARG_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
  // ── Tasks (TV-D16: v3 surface; tasks take a handle or a uuid) ───────────
  projects_list: z.object({ include_archived: z.boolean().optional() }),
  tasks_list_buckets: z.object({ include_archived: z.boolean().optional() }),
  areas_list: z.object({}),
  sections_list: z.object({ project_id: nonempty }),
  statuses_list: z.object({ project_id: nonempty.optional() }),
  teams_list: z.object({}),
  templates_list: z.object({ kind: templateKindSchema.optional() }),
  tasks_list: z.object({
    project_id: nonempty.optional(),
    bucket_id: nonempty.optional(),
    section_id: nonempty.optional(),
    area_id: nonempty.optional(),
    team_id: nonempty.optional(),
    category: listCategorySchema.optional(),
    status: listStatusSchema.optional(),
    assignee: z.enum(["me", "anyone"]).optional(),
    completed_from: ymd.optional(),
    completed_to: ymd.optional(),
    top_level: z.boolean().optional(),
    include_archived: z.boolean().optional(),
    // MOD-113: the short row (default) or each task's full shape.
    fields: z.enum(["summary", "full"]).optional(),
    limit,
    offset: z.coerce.number().int().min(0).optional(),
  }),
  tasks_focus_settings: z.object({}),
  tasks_queue: z.object({}),
  tasks_today: z.object({ date: ymd.optional() }),
  tasks_drift: z.object({}),
  tasks_list_tags: z.object({}),
  tasks_search: z.object({ q: nonempty, limit }),
  tasks_get: z.object({ task_id: nonempty }),
  tasks_history: z.object({ task_id: nonempty }),
  tasks_time_report: z.object({
    from: ymd,
    to: ymd,
    project_id: nonempty.optional(),
    by: z.enum(["task", "day"]).optional(),
  }),
  tasks_attachments_list: z.object({ task_id: nonempty }),
  tasks_activity: z.object({ task_id: nonempty.optional(), limit }),
  tasks_queue_add: z.object({ task_id: nonempty, at: z.enum(["end", "top"]).optional() }),
  tasks_queue_remove: z.object({ task_id: nonempty }),
  tasks_queue_reorder: z
    .object({
      task_id: nonempty,
      position: z.enum(["top", "end", "after"]),
      after_task_id: nonempty.optional(),
    })
    .refine((a) => a.position !== "after" || !!a.after_task_id, {
      message: "after_task_id is required with position 'after'",
      path: ["after_task_id"],
    }),
  tasks_commit: z.object({ task_id: nonempty, for_date: ymd.optional() }),
  tasks_uncommit: z.object({ task_id: nonempty }),
  tasks_skip_today: z.object({ task_id: nonempty }),
  // A category word, the project's status name or its id (TV-D9 / D16).
  tasks_set_status: z.object({ task_id: nonempty, status: z.string().trim().min(1).max(120) }),
  tasks_reschedule: z.object({ task_id: nonempty, scheduled_at: iso }),
  tasks_unschedule: z.object({ task_id: nonempty }),
  tasks_skip_occurrence: z.object({ task_id: nonempty }),
  tasks_move_occurrence: z.object({ task_id: nonempty, due_on: ymd.optional(), starts_at: iso.optional() }),
  // TV-D1: who can be assigned, and assigning (null unassigns; "me" = the key's creator).
  tasks_list_assignees: z.object({}),
  tasks_assign: z.object({ task_id: nonempty, assignee_id: z.union([nonempty, z.null()]) }),
  tasks_route_team: z.object({ task_id: nonempty, team_id: z.union([nonempty, z.null()]) }),
  tasks_claim: z.object({ task_id: nonempty }),
  tasks_handoff: z.object({
    task_id: nonempty,
    person_id: nonempty.optional(),
    label: z.string().trim().min(1).max(200).optional(),
  }),
  tasks_waiting_clear: z.object({ entry_id: nonempty }),
  tasks_comment: z.object({
    task_id: nonempty,
    body: z.string().trim().min(1).max(20000),
    mentioned_user_ids: z.array(nonempty).max(50).optional(),
  }),
  tasks_session_status: z.object({
    task_id: nonempty,
    state: agentSessionStateSchema,
    note: z.string().max(280).optional(),
    step: z.number().int().min(1).max(999).optional(),
    steps: z.number().int().min(1).max(999).optional(),
    links: z.array(z.union([nonempty, z.object({ url: nonempty, label: z.string().max(80).optional() })])).max(5).optional(),
    summary: z.string().max(4000).optional(),
    agent: z.string().trim().min(1).max(60).optional(),
  }),
  tasks_reminder_add: z.object({ task_id: nonempty, kind: taskReminderKindSchema.optional(), at: iso.optional() }),
  tasks_reminder_remove: z.object({ reminder_id: nonempty }),
  tasks_work_session_add: z.object({ task_id: nonempty, starts_at: iso, ends_at: iso, person_id: nonempty.optional() }),
  tasks_work_session_update: z.object({ session_id: nonempty, starts_at: iso.optional(), ends_at: iso.optional() }),
  tasks_work_session_remove: z.object({ session_id: nonempty }),
  // TV-D8 / D16: creates and edits through tasks_op_create_with / tasks_op_update_with.
  tasks_create: z.object({
    title: nonempty,
    project_id: nonempty.optional(),
    bucket_id: nonempty.optional(),
    section_id: z.union([nonempty, z.null()]).optional(),
    parent_id: nonempty.optional(),
    description: z.string().optional(),
    status: z.string().trim().min(1).max(120).optional(),
    assignee_id: z.union([nonempty, z.null()]).optional(),
    team_id: z.union([nonempty, z.null()]).optional(),
    due_on: z.union([ymd, z.null()]).optional(),
    due_time: z.union([hhmm, z.null()]).optional(),
    due_date: z.union([iso, z.null()]).optional(),
    scheduled_at: z.union([iso, z.null()]).optional(),
    duration_minutes: z.union([minutes, z.null()]).optional(),
    estimate_minutes: z.union([minutes, z.null()]).optional(),
    priority: z.union([priorityLevelSchema, z.null()]).optional(),
    energy_level: z.union([energyLevelSchema, z.null()]).optional(),
    repeat: z.union([repeatSchema, z.null()]).optional(),
    tags: z.array(tagName).max(20).optional(),
    reminders: z
      .array(z.object({ kind: taskReminderKindSchema.optional(), at: iso.optional() }).strict())
      .max(10)
      .optional(),
    sessions: z.array(z.object({ starts_at: iso, ends_at: iso }).strict()).max(10).optional(),
    imported_from: importedFromSchema.optional(),
    import_id: nonempty.optional(),
  }),
  tasks_update: z.object({
    task_id: nonempty,
    title: nonempty.optional(),
    project_id: nonempty.optional(),
    bucket_id: nonempty.optional(),
    section_id: z.union([nonempty, z.null()]).optional(),
    parent_id: z.union([nonempty, z.null()]).optional(),
    description: z.string().optional(),
    status: z.string().trim().min(1).max(120).optional(),
    team_id: z.union([nonempty, z.null()]).optional(),
    due_on: z.union([ymd, z.null()]).optional(),
    due_time: z.union([hhmm, z.null()]).optional(),
    due_date: z.union([iso, z.null()]).optional(),
    scheduled_at: z.union([iso, z.null()]).optional(),
    duration_minutes: z.union([minutes, z.null()]).optional(),
    estimate_minutes: z.union([minutes, z.null()]).optional(),
    priority: z.union([priorityLevelSchema, z.null()]).optional(),
    energy_level: z.union([energyLevelSchema, z.null()]).optional(),
    repeat: z.union([repeatSchema, z.null()]).optional(),
    tags_add: z.array(tagName).max(20).optional(),
    tags_remove: z.array(tagName).max(20).optional(),
  }),
  projects_create: z.object({
    name: z.string().trim().min(1).max(120),
    area_id: nonempty.optional(),
    status: projectStateSchema.optional(),
    starts_on: ymd.optional(),
    target_on: ymd.optional(),
    color: nonempty.optional(),
    lead_id: nonempty.optional(),
    // MOD-155: the client is a person or a company, never both.
    client_contact_id: nonempty.optional(),
    client_company_id: nonempty.optional(),
    // TV-U16's description, plain text ('' for none); the ops cap it at 20,000.
    description: projectDescription.optional(),
    import_id: nonempty.optional(),
  }),
  projects_update: z.object({
    project_id: nonempty,
    name: z.string().trim().min(1).max(120).optional(),
    status: projectStateSchema.optional(),
    area_id: z.union([nonempty, z.null()]).optional(),
    starts_on: z.union([ymd, z.null()]).optional(),
    target_on: z.union([ymd, z.null()]).optional(),
    color: z.union([nonempty, z.null()]).optional(),
    lead_id: z.union([nonempty, z.null()]).optional(),
    client_contact_id: z.union([nonempty, z.null()]).optional(),
    client_company_id: z.union([nonempty, z.null()]).optional(),
    description: z.union([projectDescription, z.null()]).optional(),
    archived: z.boolean().optional(),
  }),
  projects_duplicate: z.object({
    project_id: nonempty,
    name: z.string().trim().min(1).max(120).optional(),
    starts_on: ymd.optional(),
    area_id: nonempty.optional(),
  }),
  sections_create: z.object({
    project_id: nonempty,
    name: z.string().trim().min(1).max(120),
    starts_on: ymd.optional(),
    ends_on: ymd.optional(),
    after: z.union([nonempty, z.null()]).optional(),
    import_id: nonempty.optional(),
  }),
  areas_create: z.object({ name: z.string().trim().min(1).max(120), color: nonempty.optional() }),
  templates_apply: z.object({
    template_id: nonempty,
    kind: templateKindSchema,
    title: nonempty.optional(),
    project_id: nonempty.optional(),
    section_id: nonempty.optional(),
    date: ymd.optional(),
    name: nonempty.optional(),
    starts_on: ymd.optional(),
    area_id: nonempty.optional(),
  }),
  imports_begin: z.object({ source: z.string().trim().min(1).max(40), label: z.string().max(120).optional() }),
  imports_finish: z.object({ import_id: nonempty }),
  imports_undo: z.object({ import_id: nonempty }),

  calendar_list_events: z.object({ from: iso, to: iso, limit: wideLimit }),
  calendar_day: z.object({ date: ymd.optional() }),
  calendar_create_event: z.object({
    title: nonempty,
    starts_at: iso,
    ends_at: iso,
    description: z.string().optional(),
    all_day: z.boolean().optional(),
    rrule: z.string().optional(),
  }),
  calendar_update_event: z.object({
    event_id: nonempty,
    title: z.string().optional(),
    starts_at: iso.optional(),
    ends_at: iso.optional(),
    description: z.string().optional(),
    all_day: z.boolean().optional(),
    rrule: z.string().optional(),
  }),
  calendar_delete_event: z.object({ event_id: nonempty }),
  calendar_schedule_task: z.object({ task_id: nonempty, scheduled_at: iso }),
  calendar_move_block: z.object({ task_id: nonempty, scheduled_at: iso }),
  calendar_complete_block: z.object({ task_id: nonempty }),
  calendar_roll_forward: z.object({}),

  contacts_list: z.object({ limit: wideLimit }),
  contacts_get: z.object({ entity_id: nonempty, entity_type: nonempty.optional() }),
  contacts_search: z.object({ query: nonempty, limit }),
  contacts_create: z.object({
    name: nonempty,
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
    company_id: nonempty.optional(),
    status: z.string().optional(),
  }),
  contacts_update: z.object({
    contact_id: nonempty,
    name: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    title: z.string().optional(),
  }),
  contacts_set_status: z.object({ contact_id: nonempty, status: nonempty }),
  contacts_link: z.object({
    contact_type: z.enum(["contact", "company"]),
    contact_id: nonempty,
    target_type: nonempty,
    target_id: nonempty,
    relation_kind: relationKindSchema.optional(),
  }),
  contacts_unlink: z.object({ link_id: nonempty }),
  contacts_delete: z.object({ contact_id: nonempty }),
  contacts_import: z.object({
    rows: z.array(z.object({ name: nonempty }).catchall(z.unknown())).min(1),
  }),

  email_list: z.object({ limit }),
  email_get: z.object({ ref_id: nonempty }),
  email_search: z.object({ query: nonempty, limit }),
  email_snooze: z.object({ ref_id: nonempty, until: iso }),
  email_unsnooze: z.object({ ref_id: nonempty }),
  email_follow_up: z.object({ ref_id: nonempty, at: iso }),
  email_clear_follow_up: z.object({ ref_id: nonempty }),
  email_link: z.object({
    ref_id: nonempty,
    target_type: nonempty,
    target_id: nonempty,
    relation_kind: relationKindSchema.optional(),
  }),
  email_remove: z.object({ ref_id: nonempty }),

  // Chat (specs/chat-v2.md §14, CV-21) — what the key reads; channel = name as
  // shown or id; ids of messages are checked by the tool.
  chat_list_channels: z.object({}),
  chat_read: z.object({
    channel: nonempty,
    chain_id: nonempty.optional(),
    thread_id: nonempty.optional(),
    before: nonempty.optional(),
    limit,
  }),
  chat_search: z.object({ query: z.string().trim().min(1).max(256), channel: nonempty.optional(), limit }),
  chat_addressed_to_me: z.object({ limit }),
  chat_post: z.object({
    channel: nonempty,
    text: z.string().trim().min(1).max(8000),
    thread_id: nonempty.optional(),
  }),
  chat_reply: z.object({ message_id: nonempty, text: z.string().trim().min(1).max(8000) }),
  chat_react: z.object({ message_id: nonempty, emoji: z.string().trim().min(1).max(64), on: z.boolean().optional() }),
  chat_mark_decision: z.object({ message_id: nonempty, on: z.boolean().optional() }),
  chat_wrap_up: z.object({ chain_id: nonempty, settled_by: nonempty, mark_decision: z.boolean().optional() }),
  chat_create_channel: z.object({
    name: z.string().trim().min(1).max(80),
    topic: z.string().max(250).optional(),
    private: z.boolean().optional(),
  }),

  links_search_entities: z.object({
    query: nonempty.optional(),
    types: z.array(nonempty).optional(),
    limit,
  }),
  links_list: z.object({ entity_type: nonempty, entity_id: nonempty }),
  links_suggest: z.object({ entity_type: nonempty, entity_id: nonempty, limit }),
  links_create: z.object({
    source_type: nonempty,
    source_id: nonempty,
    target_type: nonempty,
    target_id: nonempty,
    relation_kind: relationKindSchema.optional(),
  }),
  links_set_kind: z.object({ link_id: nonempty, relation_kind: relationKindSchema }),
  links_delete: z.object({ link_id: nonempty }),
  comments_list: z.object({ entity_type: nonempty, entity_id: nonempty, limit }),
  comments_add: z.object({
    entity_type: nonempty,
    entity_id: nonempty,
    body: nonempty,
    mentioned_user_ids: z.array(nonempty).optional(),
  }),

  notes_list: z.object({ limit }),
  notes_get: z.object({ note_id: nonempty }),
  notes_search: z.object({ query: nonempty, limit }),
  notes_create: z.object({
    title: nonempty,
    markdown: z.string().optional(),
    parent_id: nonempty.optional(),
  }),
  notes_append: z.object({ note_id: nonempty, markdown: nonempty }),
  notes_update: z.object({ note_id: nonempty, markdown: nonempty, title: z.string().optional() }),
  notes_move: z.object({ note_id: nonempty, parent_id: nonempty.optional() }),
  notes_archive: z.object({ note_id: nonempty }),
  notes_trash: z.object({ note_id: nonempty }),
  notes_link: z.object({
    note_id: nonempty,
    target_type: nonempty,
    target_id: nonempty,
    relation_kind: relationKindSchema.optional(),
  }),

  // Global search (GS-7): a limit up to 500 is read as the cap (50), not refused.
  search: z.object({ query: nonempty, types: z.array(nonempty).optional(), limit: wideLimit }),
};

export function parseToolArgs(
  toolName: string,
  args: unknown,
): { success: true; data: Record<string, unknown> } | { success: false; message: string } {
  const schema = TOOL_ARG_SCHEMAS[toolName];
  if (!schema) {
    return { success: false, message: `unknown tool: ${toolName}` };
  }
  const parsed = parseOrStructured(schema, args ?? {});
  if (!parsed.success) {
    const first = parsed.errors[0];
    const path = first?.path.length ? first.path.join(".") : "arguments";
    return { success: false, message: `${path}: ${first?.message ?? "invalid arguments"}` };
  }
  return { success: true, data: parsed.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Collapse Zod's anyOf(const|enum) string unions into one MCP-friendly enum. */
function flattenStringChoices(node: unknown): unknown {
  if (!isRecord(node)) return node;
  if (Array.isArray(node.anyOf)) {
    const values: string[] = [];
    let allStrings = true;
    for (const branch of node.anyOf) {
      if (!isRecord(branch) || branch.type !== "string") {
        allStrings = false;
        break;
      }
      if (typeof branch.const === "string") values.push(branch.const);
      else if (Array.isArray(branch.enum) && branch.enum.every((v) => typeof v === "string")) {
        values.push(...(branch.enum as string[]));
      } else {
        allStrings = false;
        break;
      }
    }
    if (allStrings && values.length > 0) {
      return { type: "string", enum: values };
    }
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && isRecord(value)) {
      out[key] = Object.fromEntries(
        Object.entries(value).map(([prop, schema]) => [prop, flattenStringChoices(schema)]),
      );
    } else if (key === "items") {
      out[key] = flattenStringChoices(value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

function overlayDescriptions(
  generated: Record<string, unknown>,
  annotated?: Record<string, unknown>,
): Record<string, unknown> {
  if (!annotated || !isRecord(annotated.properties) || !isRecord(generated.properties)) {
    return generated;
  }
  const properties: Record<string, unknown> = { ...generated.properties };
  for (const [key, gen] of Object.entries(generated.properties)) {
    const desc = annotated.properties[key];
    if (isRecord(gen) && isRecord(desc) && typeof desc.description === "string") {
      properties[key] = { ...gen, description: desc.description };
    }
  }
  return { ...generated, properties };
}

/**
 * JSON Schema for MCP `tools/list`. Types and closed enums come from
 * TOOL_ARG_SCHEMAS; property descriptions stay on the module listing.
 */
export function listingJsonSchema(
  toolName: string,
  annotated?: Record<string, unknown>,
): Record<string, unknown> {
  const schema = TOOL_ARG_SCHEMAS[toolName];
  if (!schema) {
    return annotated ?? { type: "object", properties: {} };
  }
  const raw = z.toJSONSchema(schema, { target: "draft-7" }) as Record<string, unknown>;
  const { $schema: _schema, ...rest } = raw;
  return overlayDescriptions(flattenStringChoices(rest) as Record<string, unknown>, annotated);
}
