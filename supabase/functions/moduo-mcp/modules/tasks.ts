/**
 * Tasks — module #1 on the Moduo MCP connector (docs/moduo-mcp-connector.md).
 *
 * Read tools mirror the manifest's resources (src/features/tasks/
 * ops-manifest.ts — keep the descriptions in sync); write tools are the
 * agent-meaningful intent ops, calling the same tasks_op_* RPCs the app uses
 * (docs/moduo-module-contract.md). Where an op needs occurrence math the
 * connector runs the engine port (../recurrence.ts) first — agents are never
 * asked to compute rrule pointers. `tasks.catch_up` is deliberately not
 * exposed: it is an app-lifecycle batch pass, not an agent intent.
 *
 * Workspace scoping comes from the key, never from tool args. Reads run as
 * service_role (RLS bypassed), so every query here MUST filter on
 * ctx.key.workspaceId.
 */

import { ATTACHMENTS_BUCKET, ATTACHMENT_LINK_TTL_SECONDS } from "../../_shared/contracts/attachments.ts";
import {
  ENERGY_LEVELS,
  PRIORITY_LEVELS,
  TASK_STATUSES,
  isClosedTask,
  isOpenTask,
  isTaskStatus,
} from "../../_shared/contracts/vocabularies.ts";
import { assigneeCandidates, resolveAssigneeArg } from "../../_shared/task-people.ts";
import {
  MAX_PAGE,
  filterByAssignee,
  focusSettingsFrom,
  isDrifted,
  orderByBucket,
  rowTaskState,
  pageOf,
  parseAssignee,
  readAllPages,
  queueTaskIds,
  shapeTask,
  subtaskCounts,
  topLevelOnly,
} from "../../_shared/tasks-connector.ts";
import type { ConnectorModule, ToolContext } from "../registry.ts";
import { assertReach, visibleIds } from "../share.ts";
import {
  pointerOnStatusChange,
  skipOccurrenceTargets,
  type RecurringTaskRow,
} from "../recurrence.ts";

type Row = Record<string, any>;

// The creator's "completed" notification (TV-D1). The trail already says so
// through tasks.set_status, so agents don't get it twice (like the app's
// isTrailEntry).
const NOTIFICATION_ONLY_OP = "tasks.completed";

function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

function isoOrThrow(value: string, name: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${name} must be an ISO 8601 datetime.`);
  return d.toISOString();
}

function dayOrThrow(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD.`);
  return value;
}

function clampLimit(args: Row, fallback: number, max: number): number {
  const v = Number(args?.limit);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), max);
}

/** Projects archived in the app (TV-U6): they and their tasks stay out of every
 *  tool unless one asks for them (`include_archived`), and search finds them,
 *  labelled `project_archived` (REPLAN 78). */
function archivedBucketIds(buckets: Row[]): Set<string> {
  return new Set(buckets.filter((b) => b.archived_at && !b.is_system).map((b) => b.id));
}

async function rows(query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Tasks + the cross-row context needed for computed state, one fetch. The
 * big reads go page by page: PostgREST stops at 1,000 rows a request, and a
 * list past that used to lose tasks silently (TV-D8, AC1.13). */
async function loadWorkspace(ctx: ToolContext) {
  const ws = ctx.key.workspaceId;
  const visible = await visibleIds(ctx, "task");
  const [allTasks, relations, tags, tagLinks, members, queueRows, taskKey, bucketRows] = await Promise.all([
    readAllPages<Row>((from, to) =>
      ctx.db.from("tasks").select("*").eq("workspace_id", ws).is("deleted_at", null)
        .order("id").range(from, to)),
    readAllPages<Row>((from, to) =>
      ctx.db.from("task_relations").select("*").eq("workspace_id", ws).order("id").range(from, to)),
    rows(ctx.db.from("tags").select("id, name, color").eq("workspace_id", ws).is("deleted_at", null)),
    readAllPages<Row>((from, to) =>
      ctx.db.from("tag_links").select("id, tag_id, entity_type, entity_id").eq("workspace_id", ws)
        .eq("entity_type", "task").order("id").range(from, to)),
    workspaceMembers(ctx),
    myQueueRows(ctx),
    workspaceTaskKey(ctx),
    // select("*"): a database without TV-U6's archived_at still answers.
    rows(ctx.db.from("buckets").select("*").eq("workspace_id", ws).is("deleted_at", null)),
  ]);
  // TV-U6: an archived project's tasks are out of every list and queue; only
  // search and `include_archived` reach them (labelled).
  const archived = archivedBucketIds(bucketRows);
  const tasks = allTasks.filter((t) => visible.has(t.id) && !archived.has(t.bucket_id));
  const archivedTasks = allTasks.filter((t) => visible.has(t.id) && archived.has(t.bucket_id));
  // TV-D2: the key creator's own queue, in order (live, visible tasks only).
  const queue = queueTaskIds(queueRows as { id: string; task_id: string; position: string }[],
    new Set(tasks.map((t) => t.id)));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const open = (id: string) => {
    const t = byId.get(id);
    // A backlog blocker still blocks (TV-D9): only finished ones don't.
    return !!t && !isClosedTask(rowTaskState(t));
  };
  const blockedIds = new Set(
    relations.filter((r) => open(r.blocker_task_id) && byId.has(r.blocked_task_id))
      .map((r) => r.blocked_task_id),
  );
  // Assignees and creators by name; someone no longer a member reads "Former member".
  const names = new Map(members.map((m) => [m.user_id, m.name]));
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const taskTags = new Map<string, string[]>();
  for (const link of tagLinks) {
    const name = tagName.get(link.tag_id);
    if (!name) continue;
    const list = taskTags.get(link.entity_id) ?? [];
    list.push(name);
    taskTags.set(link.entity_id, list);
  }
  // names: shapeTask's assignee/creator (TV-D1); subtaskCounts: MCC-1's subtask_count;
  // queue/queuedByMe: the key creator's queue (TV-D2).
  return {
    tasks, relations, tags, byId, blockedIds, taskTags, names,
    subtaskCounts: subtaskCounts(tasks),
    queue,
    queuedByMe: new Set(queue),
    taskKey,
    archivedTasks,
  };
}

/** The workspace's task key (TV-D8), or null before that migration. */
async function workspaceTaskKey(ctx: ToolContext): Promise<string | null> {
  const { data, error } = await ctx.db.from("workspaces").select("task_key")
    .eq("id", ctx.key.workspaceId).maybeSingle();
  if (error) return null;
  return typeof data?.task_key === "string" ? data.task_key : null;
}

/** The fields tasks_create / tasks_update take, as the ops want them. */
function taskFieldsFromArgs(args: Row): Row {
  const fields: Row = {};
  if (typeof args.title === "string") fields.title = str(args, "title");
  if (typeof args.description === "string") fields.description = args.description;
  for (const name of ["due_date", "scheduled_at"]) {
    if (!(name in args)) continue;
    // TV-D9: a due date given as a date alone is that date for everyone.
    if (name === "due_date" && typeof args[name] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(args[name] as string)) {
      fields.due_on = args[name];
      continue;
    }
    fields[name] = args[name] === null ? null : isoOrThrow(str(args, name), name);
  }
  if ("duration_minutes" in args) fields.duration_minutes = args.duration_minutes ?? null;
  if ("priority" in args) fields.priority = args.priority ?? null;
  if ("energy_level" in args) fields.energy_level = args.energy_level ?? null;
  return fields;
}

/** The key creator's queue rows here (TV-D2). Before the migration: none. */
async function myQueueRows(ctx: ToolContext): Promise<Row[]> {
  const { data, error } = await ctx.db.from("task_queue")
    .select("id, task_id, position")
    .eq("workspace_id", ctx.key.workspaceId).eq("user_id", ctx.key.createdBy);
  if (error) {
    // PostgREST's "no such table" (PGRST205) or Postgres's (42P01): the
    // migration isn't there yet. Anything else is a real failure.
    const code = (error as { code?: string }).code;
    if ((code === "PGRST205" || code === "42P01") && /task_queue/.test(error.message ?? "")) return [];
    throw new Error(error.message);
  }
  return data ?? [];
}

/** The key creator's queue, shaped, in order. */
async function shapedQueue(ctx: ToolContext): Promise<Row[]> {
  const data = await loadWorkspace(ctx);
  const now = new Date();
  return data.queue.map((id) => shapeTask(data.byId.get(id)!, data, now));
}

/** Call a tasks_op_queue_* RPC (acts on the key creator's queue), then read it back. */
async function callQueueOp(ctx: ToolContext, fn: string, args: Row): Promise<{ queue: Row[] }> {
  const { error } = await ctx.db.rpc(fn, { p_workspace_id: ctx.key.workspaceId, ...args });
  if (error) throw new Error(error.message);
  return { queue: await shapedQueue(ctx) };
}

/** The workspace's members (the owner is one too), with names and permissions. */
async function workspaceMembers(
  ctx: ToolContext,
): Promise<{ user_id: string; perms: string[] | null; name: string }[]> {
  const found = await rows(
    ctx.db.from("workspace_members")
      .select("user_id, perms, profiles(display_name)")
      .eq("workspace_id", ctx.key.workspaceId),
  );
  return found.map((m) => ({
    user_id: m.user_id as string,
    perms: (m.perms as string[] | null) ?? null,
    name: ((m.profiles?.display_name as string | null) ?? "").trim() || "Member",
  }));
}

async function fetchTask(ctx: ToolContext, taskId: string): Promise<Row> {
  const found = await rows(
    ctx.db.from("tasks").select("*")
      .eq("workspace_id", ctx.key.workspaceId).eq("id", taskId).is("deleted_at", null),
  );
  // Service role sees every row: only tasks shared with the key's creator exist.
  if (!found.length || !(await visibleIds(ctx, "task")).has(found[0].id)) {
    throw new Error("Task not found in this workspace.");
  }
  return found[0];
}

/** Call a tasks_op_* RPC and return the updated row, shaped. */
async function callOp(ctx: ToolContext, fn: string, args: Row): Promise<Row> {
  const { data, error } = await ctx.db.rpc(fn, {
    p_workspace_id: ctx.key.workspaceId,
    ...args,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The operation returned nothing.");
  const ws = await loadWorkspace(ctx);
  return shapeTask(row, ws, new Date(), true);
}

const taskIdSchema = {
  type: "object",
  properties: { task_id: { type: "string", description: "Task uuid." } },
  required: ["task_id"],
} as const;

export const tasksConnectorModule: ConnectorModule = {
  module: "tasks",
  tools: [
    // ── reads (view scope) ───────────────────────────────────────────────
    {
      name: "tasks_list_buckets",
      description:
        "The workspace's projects (\"buckets\"; exclusive task categories; the reserved Inbox is is_system). Optional group labels form sidebar areas; color is the sidebar dot's label hue. Archived projects (and their tasks) are left out unless include_archived is true; then they carry archived: true.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          include_archived: {
            type: "boolean",
            description: "Also list archived projects, marked archived: true. Default false.",
          },
        },
      },
      handler: async (args, ctx) => {
        // select("*"): a database without TV-U6's columns still answers.
        const buckets = await rows(
          ctx.db.from("buckets")
            .select("*")
            .eq("workspace_id", ctx.key.workspaceId).is("deleted_at", null)
            .order("position"),
        );
        const visible = await visibleIds(ctx, "bucket");
        const archived = archivedBucketIds(buckets);
        const withArchived = args?.include_archived === true;
        return buckets
          .filter((b) => visible.has(b.id) && (withArchived || !archived.has(b.id)))
          .map((b) => ({
            id: b.id,
            name: b.name,
            is_system: b.is_system,
            ...(b.group_label ? { group: b.group_label } : {}),
            ...(b.color ? { color: b.color } : {}),
            ...(archived.has(b.id) ? { archived: true } : {}),
          }));
      },
    },
    {
      name: "tasks_list",
      description:
        "Tasks with computed drift/blocked state, subtasks (parent_id, subtask_count), assignee and assignee_id (null = Unassigned) and creator, tags and recurrence. Defaults to open tasks (todo + in_progress), ordered by bucket then position. Pages with offset.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          bucket_id: { type: "string", description: "Only this bucket." },
          status: {
            type: "string",
            enum: ["open", ...TASK_STATUSES],
            description: "Filter by status; 'open' = todo + in_progress (default).",
          },
          assignee: {
            type: "string",
            enum: ["me", "anyone"],
            description: "'me' = tasks assigned to the key's creator (not ones they only created; Unassigned tasks are nobody's); 'anyone' (default) = every task you can see.",
          },
          top_level: {
            type: "boolean",
            description: "Only top-level tasks (no parent in the result); subtasks are summarised in subtask_count. Default false.",
          },
          include_archived: {
            type: "boolean",
            description: "Also tasks in archived projects, marked project_archived: true. Default false.",
          },
          limit: { type: "number", description: `Max tasks per page (default 100, max ${MAX_PAGE}).` },
          offset: { type: "number", description: "Skip this many tasks (default 0). A page shorter than limit is the last." },
        },
      },
      handler: async (args, ctx) => {
        const data = await loadWorkspace(ctx);
        const now = new Date();
        const status = typeof args.status === "string" ? args.status : "open";
        const bucketId = str(args, "bucket_id", false);
        const archivedIds = new Set(data.archivedTasks.map((t) => t.id));
        const pool = args.include_archived === true ? [...data.tasks, ...data.archivedTasks] : data.tasks;
        let list = filterByAssignee(pool, parseAssignee(args.assignee), ctx.key.createdBy);
        if (bucketId) list = list.filter((t) => t.bucket_id === bucketId);
        // Open = To do or In progress (TV-D9's one rule: Backlog is parked).
        if (status === "open") list = list.filter((t) => isOpenTask(rowTaskState(t)));
        else if (isTaskStatus(status)) list = list.filter((t) => t.status === status);
        if (args.top_level === true) list = topLevelOnly(list, new Set(list.map((t) => t.id)));
        const buckets = await rows(
          ctx.db.from("buckets").select("id, position, is_system, group_label")
            .eq("workspace_id", ctx.key.workspaceId).is("deleted_at", null),
        );
        list = pageOf(orderByBucket(list, buckets), args.offset, clampLimit(args, 100, MAX_PAGE));
        return list.map((t) => ({
          ...shapeTask(t, data, now),
          ...(archivedIds.has(t.id) ? { project_archived: true } : {}),
        }));
      },
    },
    {
      name: "tasks_focus_settings",
      description:
        "The key creator's Focus (pomodoro) settings from Moduo, with the app's defaults filled in: work/break lengths in minutes, long-break rhythm, auto-start and chime.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const found = await rows(
          ctx.db.from("user_preferences").select("focus").eq("user_id", ctx.key.createdBy),
        );
        return focusSettingsFrom(found[0]?.focus);
      },
    },
    {
      name: "tasks_queue",
      description:
        "Your queue: the tasks the key's creator lined up to do next, in order. It's personal (other people's queues are theirs) and not tied to a date; completing, archiving or deleting a task takes it out.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => ({ queue: await shapedQueue(ctx) }),
    },
    {
      name: "tasks_today",
      description:
        "Older name for tasks_queue, kept for existing agents: the key creator's queue. The queue isn't tied to a day any more, so date is accepted but doesn't filter.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { date: { type: "string", description: "Ignored (YYYY-MM-DD; echoed back). Default: today, UTC." } },
      },
      handler: async (args, ctx) => {
        const date = args.date
          ? dayOrThrow(str(args, "date"), "date")
          : new Date().toISOString().slice(0, 10);
        return { date, queue: await shapedQueue(ctx) };
      },
    },
    {
      name: "tasks_drift",
      description:
        "Open tasks whose scheduled time has passed (ambient drift — factual, never an 'overdue' wall). Sorted oldest first.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const data = await loadWorkspace(ctx);
        const now = new Date();
        return data.tasks
          .filter((t) => isDrifted(t, now))
          .sort((a, b) => new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime())
          .map((t) => shapeTask(t, data, now));
      },
    },
    {
      name: "tasks_list_tags",
      description: "Workspace-level tags with task usage counts (tags are shared across modules).",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const data = await loadWorkspace(ctx);
        const counts = new Map<string, number>();
        for (const names of data.taskTags.values()) {
          for (const n of names) counts.set(n, (counts.get(n) ?? 0) + 1);
        }
        return data.tags.map((t) => ({ id: t.id, name: t.name, color: t.color, task_count: counts.get(t.name) ?? 0 }));
      },
    },
    {
      name: "tasks_search",
      description:
        "Search tasks by title and description (case-insensitive substring). Tasks in archived projects are found too, marked project_archived: true.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          q: { type: "string", description: "Search text." },
          limit: { type: "number", description: "Max results (default 25, max 100)." },
        },
        required: ["q"],
      },
      handler: async (args, ctx) => {
        const q = str(args, "q").replace(/[%_\\]/g, (m) => `\\${m}`);
        const data = await loadWorkspace(ctx);
        const now = new Date();
        const matches = await rows(
          ctx.db.from("tasks").select("id")
            .eq("workspace_id", ctx.key.workspaceId).is("deleted_at", null)
            .or(`title.ilike.%${q}%,description.ilike.%${q}%`)
            .limit(clampLimit(args, 25, 100)),
        );
        const ids = new Set(matches.map((m) => m.id));
        return [
          ...data.tasks.filter((t) => ids.has(t.id)).map((t) => shapeTask(t, data, now)),
          ...data.archivedTasks
            .filter((t) => ids.has(t.id))
            .map((t) => ({ ...shapeTask(t, data, now), project_archived: true })),
        ];
      },
    },
    {
      name: "tasks_get",
      description:
        "One task in full: properties, tags, dependency edges (blockers and blocked), subtasks, and its recent attributed activity trail.",
      access: "view",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const taskId = str(args, "task_id");
        const task = await fetchTask(ctx, taskId);
        const data = await loadWorkspace(ctx);
        const now = new Date();
        const titled = (id: string) => {
          const t = data.byId.get(id);
          return t ? { id, title: t.title, status: t.status } : null;
        };
        const activity = await rows(
          ctx.db.from("module_activity")
            .select("op, actor_type, actor_label, payload, created_at")
            .eq("workspace_id", ctx.key.workspaceId).eq("module", "tasks")
            .eq("entity_type", "task").eq("entity_id", taskId)
            .neq("op", NOTIFICATION_ONLY_OP)
            .order("created_at", { ascending: false }).limit(10),
        );
        return {
          ...shapeTask(task, data, now, true),
          blockers: data.relations
            .filter((r) => r.blocked_task_id === taskId).map((r) => titled(r.blocker_task_id))
            .filter(Boolean),
          blocking: data.relations
            .filter((r) => r.blocker_task_id === taskId).map((r) => titled(r.blocked_task_id))
            .filter(Boolean),
          subtasks: data.tasks
            .filter((t) => t.parent_id === taskId)
            .map((t) => ({ id: t.id, title: t.title, status: t.status })),
          activity,
        };
      },
    },
    {
      name: "tasks_attachments_list",
      description:
        "A task's files (AT-1): name, type, size, when added, and a download link that works for 5 minutes. Links are made for the key's creator; ask again for fresh ones.",
      access: "view",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const taskId = str(args, "task_id");
        await fetchTask(ctx, taskId);
        const files = await rows(
          ctx.db.from("attachments")
            .select("id, file_name, mime, size_bytes, width, height, created_at, object_path")
            .eq("workspace_id", ctx.key.workspaceId).eq("entity_type", "task")
            .eq("entity_id", taskId).eq("status", "ready").is("deleted_at", null)
            .order("created_at", { ascending: true }),
        );
        const urls = new Map<string, string>();
        if (files.length) {
          const { data, error } = await ctx.db.storage
            .from(ATTACHMENTS_BUCKET)
            .createSignedUrls(files.map((f) => f.object_path as string), ATTACHMENT_LINK_TTL_SECONDS.mcp);
          if (error) throw new Error(error.message);
          for (const link of data ?? []) {
            if (link.path && link.signedUrl) urls.set(link.path, link.signedUrl);
          }
        }
        return {
          task_id: taskId,
          link_lifetime_seconds: ATTACHMENT_LINK_TTL_SECONDS.mcp,
          attachments: files.map((f) => ({
            id: f.id,
            name: f.file_name,
            mime: f.mime,
            size_bytes: Number(f.size_bytes),
            width: f.width ?? null,
            height: f.height ?? null,
            added_at: f.created_at,
            url: urls.get(f.object_path) ?? null,
          })),
        };
      },
    },
    {
      name: "tasks_activity",
      description:
        "The attributed intent-op trail (who did what, including agents and API keys): one task's trail, or the workspace's most recent activity.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Limit to one task (optional)." },
          limit: { type: "number", description: "Max entries (default 25, max 100)." },
        },
      },
      handler: async (args, ctx) => {
        let query = ctx.db.from("module_activity")
          .select("entity_type, entity_id, op, actor_type, actor_label, payload, created_at")
          .eq("workspace_id", ctx.key.workspaceId).eq("module", "tasks")
          .neq("op", NOTIFICATION_ONLY_OP)
          .order("created_at", { ascending: false });
        const taskId = str(args, "task_id", false);
        if (taskId) {
          await fetchTask(ctx, taskId); // not shared with you → not found
          query = query.eq("entity_type", "task").eq("entity_id", taskId);
        }
        // Over-fetch, then keep only trail rows about things you can see
        // (titles live in the payloads).
        const limit = clampLimit(args, 25, 100);
        const [fetched, tasks, buckets] = await Promise.all([
          rows(query.limit(limit * 4)),
          visibleIds(ctx, "task"),
          visibleIds(ctx, "bucket"),
        ]);
        return fetched
          .filter((r) => tasks.has(r.entity_id) || buckets.has(r.entity_id))
          .slice(0, limit)
          .map(({ entity_type: _type, ...rest }) => rest);
      },
    },

    {
      name: "tasks_list_assignees",
      description:
        "Who a task can be assigned to: the workspace's members with is_me for the key's creator. Only people with can_be_assigned (they can work on tasks) are accepted by tasks_assign.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const [members, workspace] = await Promise.all([
          workspaceMembers(ctx),
          rows(ctx.db.from("workspaces").select("owner_id").eq("id", ctx.key.workspaceId)),
        ]);
        return assigneeCandidates({
          members,
          ownerId: (workspace[0]?.owner_id as string | undefined) ?? null,
          names: new Map(members.map((m) => [m.user_id, m.name])),
          me: ctx.key.createdBy,
        });
      },
    },

    // ── writes (edit scope) — Session 8 intent ops, never raw row writes ──
    {
      name: "tasks_queue_add",
      description:
        "Add a task to your queue (the key creator's): at the end, or at the top. A task already queued stays where it is unless you ask for the top. Done and archived tasks can't be queued. Returns your queue.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task uuid." },
          at: { type: "string", enum: ["end", "top"], description: "Where it goes: 'end' (default) or 'top'." },
        },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callQueueOp(ctx, "tasks_op_queue_add", {
          p_task_id: task.id,
          p_at: args.at === "top" ? "top" : "end",
        });
      },
    },
    {
      name: "tasks_queue_remove",
      description: "Take a task out of your queue. Doing it twice is fine. Returns your queue.",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callQueueOp(ctx, "tasks_op_queue_remove", { p_task_id: task.id });
      },
    },
    {
      name: "tasks_queue_reorder",
      description:
        "Move a task that's in your queue: to the top, to the end, or right after another task in your queue. Moving never counts as a reschedule. Returns your queue.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task uuid (must be in your queue)." },
          position: {
            type: "string",
            enum: ["top", "end", "after"],
            description: "'top', 'end', or 'after' (then give after_task_id).",
          },
          after_task_id: {
            type: "string",
            description: "With position 'after': the queued task it should follow.",
          },
        },
        required: ["task_id", "position"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const position = str(args, "position");
        if (position === "end") {
          return callQueueOp(ctx, "tasks_op_queue_move_to_end", { p_task_id: task.id });
        }
        if (position === "top") {
          return callQueueOp(ctx, "tasks_op_queue_reorder", { p_task_id: task.id, p_after_task_id: null });
        }
        if (position !== "after") throw new Error("position must be 'top', 'end' or 'after'.");
        const after = await fetchTask(ctx, str(args, "after_task_id"));
        return callQueueOp(ctx, "tasks_op_queue_reorder", { p_task_id: task.id, p_after_task_id: after.id });
      },
    },
    {
      name: "tasks_commit",
      description:
        "Older name for tasks_queue_add, kept for existing agents: puts the task at the end of your queue (again: moves it there) and marks it for the day in app versions from before personal queues.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task uuid." },
          for_date: { type: "string", description: "Queue date YYYY-MM-DD (default: today, UTC)." },
        },
        required: ["task_id"],
      },
      handler: (args, ctx) =>
        callOp(ctx, "tasks_op_commit", {
          p_task_id: str(args, "task_id"),
          p_for: args.for_date
            ? dayOrThrow(str(args, "for_date"), "for_date")
            : new Date().toISOString().slice(0, 10),
        }),
    },
    {
      name: "tasks_uncommit",
      description:
        "Older name for tasks_queue_remove, kept for existing agents: takes the task out of your queue (and off the day in older app versions). Doing it twice is fine.",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: (args, ctx) =>
        callOp(ctx, "tasks_op_uncommit", { p_task_id: str(args, "task_id") }),
    },
    {
      name: "tasks_skip_today",
      description:
        "Older name, kept for existing agents: takes the task out of your queue (and off the day in older app versions). It no longer counts as a reschedule.",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: (args, ctx) =>
        callOp(ctx, "tasks_op_skip_today", { p_task_id: str(args, "task_id") }),
    },
    {
      name: "tasks_create",
      description:
        "Create a task. It goes into the project you name (bucket_id, see tasks_list_buckets) or the key creator's Inbox, assigned to the key's creator unless you pass assignee_id (a member, \"me\", or null for Unassigned). It gets its handle (e.g. MOD-142), shows in search at once, and the trail reads \"via\" this key.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "What the task is." },
          bucket_id: { type: "string", description: "Project (bucket) uuid. Default: the key creator's Inbox." },
          parent_id: { type: "string", description: "Make it a subtask of this task (one level only)." },
          description: { type: "string", description: "Longer notes (plain text or Markdown)." },
          due_date: { type: ["string", "null"], description: "When it's due, ISO 8601." },
          scheduled_at: { type: ["string", "null"], description: "When to work on it, ISO 8601." },
          duration_minutes: { type: ["number", "null"], description: "Estimate in minutes." },
          priority: { type: ["string", "null"], enum: [...PRIORITY_LEVELS, null], description: "Priority." },
          energy_level: { type: ["string", "null"], enum: [...ENERGY_LEVELS, null], description: "Energy it takes." },
          assignee_id: { type: ["string", "null"], description: "Member uuid (see tasks_list_assignees), \"me\", or null." },
        },
        required: ["title"],
      },
      handler: async (args, ctx) => {
        const input: Row = { ...taskFieldsFromArgs(args) };
        const bucketId = str(args, "bucket_id", false);
        if (bucketId) {
          await assertReach(ctx, "bucket", bucketId);
          input.bucket_id = bucketId;
        }
        const parentId = str(args, "parent_id", false);
        if (parentId) input.parent_id = (await fetchTask(ctx, parentId)).id;
        if ("assignee_id" in args) {
          input.assignee_id = resolveAssigneeArg(args.assignee_id, ctx.key.createdBy);
        }
        return callOp(ctx, "tasks_op_create", { p_task: input });
      },
    },
    {
      name: "tasks_update",
      description:
        "Edit a task's fields: title, description, project (bucket_id; its subtasks move with it), parent, due date, scheduled time, estimate, priority, energy. Pass only what changes; null clears a date, the estimate, the priority, the energy or the parent. Status and assignee have their own tools (tasks_set_status, tasks_assign).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task uuid." },
          title: { type: "string", description: "New title." },
          bucket_id: { type: "string", description: "Move to this project (bucket) uuid." },
          parent_id: { type: ["string", "null"], description: "Parent task uuid, or null for top level." },
          description: { type: "string", description: "New description." },
          due_date: { type: ["string", "null"], description: "ISO 8601, or null to clear." },
          scheduled_at: { type: ["string", "null"], description: "ISO 8601, or null to clear." },
          duration_minutes: { type: ["number", "null"], description: "Estimate in minutes, or null." },
          priority: { type: ["string", "null"], enum: [...PRIORITY_LEVELS, null], description: "Priority, or null." },
          energy_level: { type: ["string", "null"], enum: [...ENERGY_LEVELS, null], description: "Energy, or null." },
        },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const patch: Row = taskFieldsFromArgs(args);
        const bucketId = str(args, "bucket_id", false);
        if (bucketId) {
          await assertReach(ctx, "bucket", bucketId);
          patch.bucket_id = bucketId;
        }
        if ("parent_id" in args) {
          patch.parent_id = args.parent_id === null ? null : (await fetchTask(ctx, str(args, "parent_id"))).id;
        }
        if (Object.keys(patch).length === 0) throw new Error("Nothing to change.");
        return callOp(ctx, "tasks_op_update", { p_task_id: task.id, p_patch: patch });
      },
    },
    {
      name: "tasks_set_status",
      description:
        "Change a task's status (todo / in_progress / done / archived). On recurring tasks, completing advances the recurrence pointer (missed occurrences don't exist).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task uuid." },
          status: { type: "string", enum: [...TASK_STATUSES], description: "The new status." },
        },
        required: ["task_id", "status"],
      },
      handler: async (args, ctx) => {
        const status = str(args, "status");
        if (!isTaskStatus(status)) throw new Error("Unknown task status.");
        const task = await fetchTask(ctx, str(args, "task_id"));
        const recurrence = pointerOnStatusChange(task as RecurringTaskRow, status, new Date());
        return callOp(ctx, "tasks_op_set_status", {
          p_task_id: task.id,
          p_status: status,
          p_recurrence: recurrence,
          p_position: null,
        });
      },
    },
    {
      name: "tasks_reschedule",
      description:
        "Move a scheduled task's time (drift triage). Does not touch the reschedule counter.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task uuid." },
          scheduled_at: { type: "string", description: "New scheduled datetime, ISO 8601." },
        },
        required: ["task_id", "scheduled_at"],
      },
      handler: (args, ctx) =>
        callOp(ctx, "tasks_op_reschedule", {
          p_task_id: str(args, "task_id"),
          p_scheduled_at: isoOrThrow(str(args, "scheduled_at"), "scheduled_at"),
          p_days: null,
        }),
    },
    {
      name: "tasks_unschedule",
      description:
        "Clear a task's stale scheduled time, keeping the task (drift-triage Ignore).",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: (args, ctx) =>
        callOp(ctx, "tasks_op_unschedule", { p_task_id: str(args, "task_id") }),
    },
    {
      name: "tasks_assign",
      description:
        "Assign a task to a member who can work on tasks, or unassign it with null. \"me\" is the key's creator. Someone else being assigned gets one \"assigned to you\" notification.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "Task uuid." },
          assignee_id: {
            type: ["string", "null"],
            description: "Member uuid (see tasks_list_assignees), \"me\", or null to unassign.",
          },
        },
        required: ["task_id", "assignee_id"],
      },
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        return callOp(ctx, "tasks_op_assign", {
          p_task_id: task.id,
          p_assignee_id: resolveAssigneeArg(args.assignee_id, ctx.key.createdBy),
        });
      },
    },
    {
      name: "tasks_skip_occurrence",
      description:
        "Jump an open recurring task past its pending occurrence without done-credit. Forward-only; the connector computes the next occurrence from the task's rule.",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: async (args, ctx) => {
        const task = await fetchTask(ctx, str(args, "task_id"));
        const targets = skipOccurrenceTargets(task as RecurringTaskRow, new Date());
        if (!targets) {
          throw new Error("Nothing to skip to — the task must be open and recurring with a next occurrence.");
        }
        return callOp(ctx, "tasks_op_skip_occurrence", {
          p_task_id: task.id,
          p_scheduled_at: targets.scheduledAt,
          p_recurrence: targets.recurrence,
          p_release_commit: targets.releaseCommit,
        });
      },
    },
  ],
};
