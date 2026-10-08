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

import { TASK_STATUSES, isTaskStatus } from "../../_shared/contracts/vocabularies.ts";
import {
  assigneeCandidates,
  resolveAssigneeArg,
  taskPeople,
} from "../../_shared/task-people.ts";
import type { ConnectorModule, ToolContext } from "../registry.ts";
import { visibleIds } from "../share.ts";
import {
  pointerOnStatusChange,
  skipOccurrenceTargets,
  type RecurringTaskRow,
} from "../recurrence.ts";

type Row = Record<string, any>;

const OPEN_STATUSES = ["todo", "in_progress"] as const;

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

async function rows(query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Tasks + the cross-row context needed for computed state, one fetch. */
async function loadWorkspace(ctx: ToolContext) {
  const ws = ctx.key.workspaceId;
  const visible = await visibleIds(ctx, "task");
  const [allTasks, relations, tags, tagLinks, members] = await Promise.all([
    rows(ctx.db.from("tasks").select("*").eq("workspace_id", ws).is("deleted_at", null)),
    rows(ctx.db.from("task_relations").select("*").eq("workspace_id", ws)),
    rows(ctx.db.from("tags").select("id, name, color").eq("workspace_id", ws).is("deleted_at", null)),
    rows(ctx.db.from("tag_links").select("tag_id, entity_type, entity_id").eq("workspace_id", ws).eq("entity_type", "task")),
    workspaceMembers(ctx),
  ]);
  const tasks = allTasks.filter((t) => visible.has(t.id));
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const open = (id: string) => {
    const t = byId.get(id);
    return !!t && OPEN_STATUSES.includes(t.status);
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
  return { tasks, relations, tags, byId, blockedIds, taskTags, names };
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

type WorkspaceData = Awaited<ReturnType<typeof loadWorkspace>>;

function isDrifted(t: Row, now: Date): boolean {
  if (t.status === "done" || t.status === "archived") return false;
  return !!t.scheduled_at && new Date(t.scheduled_at).getTime() < now.getTime();
}

/** Quiet, compact task shape for agents — full row noise stays out. */
function shapeTask(t: Row, data: WorkspaceData, now: Date, full = false): Row {
  const out: Row = {
    id: t.id,
    title: t.title,
    bucket_id: t.bucket_id,
    status: t.status,
    drifted: isDrifted(t, now),
    blocked: data.blockedIds.has(t.id),
    // TV-D1: who it's assigned to (null = Unassigned) and, when known, who made it.
    ...taskPeople(t, data.names),
  };
  const description = (t.description ?? "").trim();
  if (description) out.description = full ? description : description.slice(0, 280);
  if (t.parent_id && data.byId.has(t.parent_id)) out.parent_id = t.parent_id;
  if (t.due_date) out.due_date = t.due_date;
  if (t.scheduled_at) out.scheduled_at = t.scheduled_at;
  if (t.duration_minutes != null) out.duration_minutes = t.duration_minutes;
  if (t.energy_level) out.energy_level = t.energy_level;
  if (t.priority) out.priority = t.priority;
  if (t.committed_for) {
    out.committed_for = t.committed_for;
    out.commit_order = t.commit_order;
  }
  if (t.reschedule_count) out.reschedule_count = t.reschedule_count;
  if (t.recurrence) {
    out.recurrence = { rrule: t.recurrence.rrule, next_occurrence: t.recurrence.nextOccurrence ?? null };
  }
  const tags = data.taskTags.get(t.id);
  if (tags?.length) out.tags = tags;
  if (full) {
    out.created_at = t.created_at;
    out.updated_at = t.updated_at;
  }
  return out;
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
        "The workspace's buckets (exclusive task categories; the reserved Inbox is is_system). Optional group labels form rail sections.",
      access: "view",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const buckets = await rows(
          ctx.db.from("buckets")
            .select("id, name, is_system, group_label, position")
            .eq("workspace_id", ctx.key.workspaceId).is("deleted_at", null)
            .order("position"),
        );
        const visible = await visibleIds(ctx, "bucket");
        return buckets.filter((b) => visible.has(b.id)).map((b) => ({
          id: b.id,
          name: b.name,
          is_system: b.is_system,
          ...(b.group_label ? { group: b.group_label } : {}),
        }));
      },
    },
    {
      name: "tasks_list",
      description:
        "Tasks with computed drift/blocked state, subtasks (parent_id), tags and recurrence. Defaults to open tasks (todo + in_progress).",
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
          limit: { type: "number", description: "Max tasks (default 100, max 200)." },
        },
      },
      handler: async (args, ctx) => {
        const data = await loadWorkspace(ctx);
        const now = new Date();
        const status = typeof args.status === "string" ? args.status : "open";
        const bucketId = str(args, "bucket_id", false);
        let list = data.tasks;
        if (bucketId) list = list.filter((t) => t.bucket_id === bucketId);
        if (status === "open") list = list.filter((t) => OPEN_STATUSES.includes(t.status));
        else if (isTaskStatus(status)) list = list.filter((t) => t.status === status);
        list = list.slice(0, clampLimit(args, 100, 200));
        return list.map((t) => shapeTask(t, data, now));
      },
    },
    {
      name: "tasks_today",
      description:
        "The day's ordered commit queue — what the user decided to do that day ('commit' is queue membership, not a promise of completion).",
      access: "view",
      inputSchema: {
        type: "object",
        properties: { date: { type: "string", description: "Queue date YYYY-MM-DD (default: today, UTC)." } },
      },
      handler: async (args, ctx) => {
        const date = args.date
          ? dayOrThrow(str(args, "date"), "date")
          : new Date().toISOString().slice(0, 10);
        const data = await loadWorkspace(ctx);
        const now = new Date();
        const queue = data.tasks
          .filter((t) => t.committed_for === date)
          .sort((a, b) => (a.commit_order ?? 0) - (b.commit_order ?? 0));
        return { date, queue: queue.map((t) => shapeTask(t, data, now)) };
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
      description: "Search tasks by title and description (case-insensitive substring).",
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
        return data.tasks.filter((t) => ids.has(t.id)).map((t) => shapeTask(t, data, now));
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
      name: "tasks_commit",
      description:
        "Add a task to a day's commit queue ('doing this today'); recommitting moves it to the end of the queue.",
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
      description: "Remove a task from its commit queue. Idempotent, never intercepted.",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: (args, ctx) =>
        callOp(ctx, "tasks_op_uncommit", { p_task_id: str(args, "task_id") }),
    },
    {
      name: "tasks_skip_today",
      description:
        "Skip a committed task out of the day's queue; atomically increments the ambient reschedule counter.",
      access: "edit",
      inputSchema: taskIdSchema,
      handler: (args, ctx) =>
        callOp(ctx, "tasks_op_skip_today", { p_task_id: str(args, "task_id") }),
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
