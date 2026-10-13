/**
 * MCP tool argument schemas. Runtime parsers and (where used) JSON Schema
 * listings share this catalog (zod-enum-foundation task 6).
 */

import { z } from "zod";

import { parseOrStructured } from "./errors.ts";
import {
  energyLevelSchema,
  priorityLevelSchema,
  relationKindSchema,
  taskStatusSchema,
} from "./vocabularies.ts";

const nonempty = z.string().trim().min(1);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
const iso = z.string().trim().min(1);
const limit = z.coerce.number().int().min(1).max(200).optional();
const wideLimit = z.coerce.number().int().min(1).max(500).optional();
const listStatusSchema = z.union([z.literal("open"), taskStatusSchema]);

export const TOOL_ARG_SCHEMAS: Record<string, z.ZodType<Record<string, unknown>>> = {
  tasks_list_buckets: z.object({ include_archived: z.boolean().optional() }),
  tasks_list: z.object({
    bucket_id: nonempty.optional(),
    status: listStatusSchema.optional(),
    assignee: z.enum(["me", "anyone"]).optional(),
    top_level: z.boolean().optional(),
    include_archived: z.boolean().optional(),
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
  tasks_set_status: z.object({ task_id: nonempty, status: taskStatusSchema }),
  tasks_reschedule: z.object({ task_id: nonempty, scheduled_at: iso }),
  tasks_unschedule: z.object({ task_id: nonempty }),
  tasks_skip_occurrence: z.object({ task_id: nonempty }),
  // TV-D1: who can be assigned, and assigning (null unassigns; "me" = the key's creator).
  tasks_list_assignees: z.object({}),
  tasks_assign: z.object({ task_id: nonempty, assignee_id: z.union([nonempty, z.null()]) }),
  // TV-D8: creates and edits through tasks_op_create / tasks_op_update.
  tasks_create: z.object({
    title: nonempty,
    bucket_id: nonempty.optional(),
    parent_id: nonempty.optional(),
    description: z.string().optional(),
    due_date: z.union([iso, z.null()]).optional(),
    scheduled_at: z.union([iso, z.null()]).optional(),
    duration_minutes: z.union([z.coerce.number().int().min(0).max(100000), z.null()]).optional(),
    priority: z.union([priorityLevelSchema, z.null()]).optional(),
    energy_level: z.union([energyLevelSchema, z.null()]).optional(),
    assignee_id: z.union([nonempty, z.null()]).optional(),
  }),
  tasks_update: z.object({
    task_id: nonempty,
    title: nonempty.optional(),
    bucket_id: nonempty.optional(),
    parent_id: z.union([nonempty, z.null()]).optional(),
    description: z.string().optional(),
    due_date: z.union([iso, z.null()]).optional(),
    scheduled_at: z.union([iso, z.null()]).optional(),
    duration_minutes: z.union([z.coerce.number().int().min(0).max(100000), z.null()]).optional(),
    priority: z.union([priorityLevelSchema, z.null()]).optional(),
    energy_level: z.union([energyLevelSchema, z.null()]).optional(),
  }),

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

  // Chat (specs/chat.md §Agents) — public channels only; channel = name or id.
  chat_list_channels: z.object({}),
  chat_read: z.object({ channel: nonempty, thread_id: nonempty.optional(), limit }),
  chat_search: z.object({ query: nonempty, limit }),
  chat_post: z.object({
    channel: nonempty,
    text: z.string().trim().min(1).max(8000),
    thread_id: nonempty.optional(),
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
