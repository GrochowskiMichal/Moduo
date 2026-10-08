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
  MAX_PAGE,
  filterByAssignee,
  focusSettingsFrom,
  isDrifted,
  orderByBucket,
  pageOf,
  parseAssignee,
  shapeTask,
  subtaskCounts,
  topLevelOnly,
} from "../../_shared/tasks-connector.ts";
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
  const [allTasks, relations, tags, tagLinks] = await Promise.all([
    rows(ctx.db.from("tasks").select("*").eq("workspace_id", ws).is("deleted_at", null)),
    rows(ctx.db.from("task_relations").select("*").eq("workspace_id", ws)),
    rows(ctx.db.from("tags").select("id, name, color").eq("workspace_id", ws).is("deleted_at", null)),
    rows(ctx.db.from("tag_links").select("tag_id, entity_type, entity_id").eq("workspace_id", ws).eq("entity_type", "task")),
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
  const tagName = new Map(tags.map((t) => [t.id, t.name]));
  const taskTags = new Map<string, string[]>();
  for (const link of tagLinks) {
    const name = tagName.get(link.tag_id);
    if (!name) continue;
    const list = taskTags.get(link.entity_id) ?? [];
    list.push(name);
    taskTags.set(link.entity_id, list);
  }
  return { tasks, relations, tags, byId, blockedIds, taskTags, subtaskCounts: subtaskCounts(tasks) };
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
        "Tasks with computed drift/blocked state, subtasks (parent_id, subtask_count), assignee_id, tags and recurrence. Defaults to open tasks (todo + in_progress), ordered by bucket then position. Pages with offset.",
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
            description: "'me' = tasks owned by the key's creator; 'anyone' (default) = every task you can see.",
          },
          top_level: {
            type: "boolean",
            description: "Only top-level tasks (no parent in the result); subtasks are summarised in subtask_count. Default false.",
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
        let list = filterByAssignee(data.tasks, parseAssignee(args.assignee), ctx.key.createdBy);
        if (bucketId) list = list.filter((t) => t.bucket_id === bucketId);
        if (status === "open") list = list.filter((t) => OPEN_STATUSES.includes(t.status));
        else if (isTaskStatus(status)) list = list.filter((t) => t.status === status);
        if (args.top_level === true) list = topLevelOnly(list, new Set(list.map((t) => t.id)));
        const buckets = await rows(
          ctx.db.from("buckets").select("id, position, is_system, group_label")
            .eq("workspace_id", ctx.key.workspaceId).is("deleted_at", null),
        );
        list = pageOf(orderByBucket(list, buckets), args.offset, clampLimit(args, 100, MAX_PAGE));
        return list.map((t) => shapeTask(t, data, now));
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
