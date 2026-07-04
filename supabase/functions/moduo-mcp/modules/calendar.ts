/**
 * Calendar — module #4 on the Moduo MCP connector (docs/moduo-mcp-connector.md;
 * block CAL-7, AC14).
 *
 * Connector-side mirror of the app's calendar manifest (src/features/calendar/
 * ops-manifest.ts — keep descriptions in sync). Reads expose events in a range
 * and the composed day (events + task blocks + the unfinished-from-earlier
 * strip); writes are native-event CRUD plus the loop verbs, which ride the
 * shipped Tasks ops (the lens model: a task block IS the task row). Workspace
 * scoping comes from the key, never from tool args. Reads run as service_role
 * (RLS bypassed), so every query MUST filter on ctx.key.workspaceId.
 *
 * External (mirrored) events are structurally read-only — there is no
 * update/delete path for them (the ops reject them); the connector only exposes
 * native-event writes.
 */

import type { ConnectorModule, ToolContext } from "../registry.ts";

type Row = Record<string, any>;

function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

function bool(args: Row, name: string): boolean {
  return args?.[name] === true || args?.[name] === "true";
}

function clampLimit(args: Row, fallback: number, max: number): number {
  const v = Number(args?.limit);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), max);
}

async function rows(
  query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Call an op RPC (workspace-scoped) and return its raw result row. */
async function callOp(ctx: ToolContext, fn: string, args: Row): Promise<Row | null> {
  const { data, error } = await ctx.db.rpc(fn, { p_workspace_id: ctx.key.workspaceId, ...args });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data[0] ?? null) : data;
}

/** Compact event shape for agents — the calendar_events legacy columns mapped. */
function shapeEvent(e: Row): Row {
  return {
    id: e.id,
    title: e.title,
    starts_at: e.start_time,
    ends_at: e.end_time,
    all_day: Boolean(e.all_day),
    recurrence: e.recurrence_rule ?? null,
    status: e.status ?? "confirmed",
    calendar_id: e.calendar_id,
    external: e.source_account_id !== null,
    source_account_id: e.source_account_id ?? null,
    description: e.description ?? "",
  };
}

/** A scheduled task rendered as a block (the lens) — its own row, no copy. */
function shapeBlock(t: Row): Row {
  return {
    task_id: t.id,
    title: t.title,
    scheduled_at: t.scheduled_at,
    duration_minutes: t.duration_minutes ?? 30,
    status: t.status,
  };
}

const OPEN_STATUSES = ["todo", "in_progress"];

/** Resolve a YYYY-MM-DD (or server-today) to UTC day bounds. */
function dayBounds(date: string | null): { startIso: string; endIso: string; startMs: number } {
  const base = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : new Date();
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const end = new Date(start.getTime() + 86_400_000);
  return { startIso: start.toISOString(), endIso: end.toISOString(), startMs: start.getTime() };
}

export const calendarConnectorModule: ConnectorModule = {
  module: "calendar",
  tools: [
    // ── reads (view scope) ───────────────────────────────────────────────────
    {
      name: "calendar_list_events",
      description:
        "Events in a date range — both native Moduo events and mirrored-external ones (read-only, source-attributed). Times are ISO 8601.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          from: { type: "string", description: "Range start instant (ISO 8601)." },
          to: { type: "string", description: "Range end instant (ISO 8601)." },
          limit: { type: "number", description: "Max events (default 200, max 500)." },
        },
        required: ["from", "to"],
      },
      handler: async (args, ctx) => {
        const from = str(args, "from");
        const to = str(args, "to");
        const data = await rows(
          ctx.db
            .from("calendar_events")
            .select("*")
            .eq("workspace_id", ctx.key.workspaceId)
            .is("deleted_at", null)
            .lt("start_time", to)
            .gte("end_time", from)
            .order("start_time")
            .limit(clampLimit(args, 200, 500)),
        );
        return data.map(shapeEvent);
      },
    },
    {
      name: "calendar_day",
      description:
        "The composed day: native + external events, scheduled task blocks, and the 'unfinished from earlier' strip (open tasks whose scheduled time passed). Pass `date` (YYYY-MM-DD, UTC) or omit for today.",
      access: "view",
      inputSchema: {
        type: "object",
        properties: {
          date: { type: "string", description: "The day to compose (YYYY-MM-DD, UTC). Defaults to today." },
        },
      },
      handler: async (args, ctx) => {
        const { startIso, endIso, startMs } = dayBounds(str(args, "date", false) || null);
        const nowIso = new Date().toISOString();
        const [events, blocks, strip] = await Promise.all([
          rows(
            ctx.db
              .from("calendar_events")
              .select("*")
              .eq("workspace_id", ctx.key.workspaceId)
              .is("deleted_at", null)
              .lt("start_time", endIso)
              .gte("end_time", startIso)
              .order("start_time"),
          ),
          rows(
            ctx.db
              .from("tasks")
              .select("id, title, scheduled_at, duration_minutes, status")
              .eq("workspace_id", ctx.key.workspaceId)
              .is("deleted_at", null)
              .gte("scheduled_at", startIso)
              .lt("scheduled_at", endIso)
              .order("scheduled_at"),
          ),
          // The strip: open tasks scheduled in the past 7 days whose time passed.
          rows(
            ctx.db
              .from("tasks")
              .select("id, title, scheduled_at, duration_minutes, status")
              .eq("workspace_id", ctx.key.workspaceId)
              .is("deleted_at", null)
              .in("status", OPEN_STATUSES)
              .gte("scheduled_at", new Date(startMs - 7 * 86_400_000).toISOString())
              .lt("scheduled_at", nowIso)
              .order("scheduled_at"),
          ),
        ]);
        // Match the app's strip semantics: unfinished = the block's END passed
        // (start + duration <= now), so an in-progress block isn't "unfinished".
        const nowMsLocal = Date.parse(nowIso);
        const stripEnded = strip.filter((t) => {
          const start = Date.parse(t.scheduled_at);
          const durMs = (Number(t.duration_minutes) > 0 ? Number(t.duration_minutes) : 30) * 60_000;
          return Number.isFinite(start) && start + durMs <= nowMsLocal;
        });
        return {
          date: startIso.slice(0, 10),
          events: events.map(shapeEvent),
          blocks: blocks.map(shapeBlock),
          strip: stripEnded.map(shapeBlock),
        };
      },
    },

    // ── writes (edit scope) ──────────────────────────────────────────────────
    {
      name: "calendar_create_event",
      description: "Create a native Moduo event. Times ISO 8601; `rrule` an optional RFC-5545 rule.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "Event title." },
          starts_at: { type: "string", description: "Start instant (ISO 8601)." },
          ends_at: { type: "string", description: "End instant (ISO 8601)." },
          all_day: { type: "boolean", description: "All-day event (default false)." },
          rrule: { type: "string", description: "Optional RFC-5545 RRULE for a repeat." },
          description: { type: "string", description: "Optional notes." },
        },
        required: ["title", "starts_at", "ends_at"],
      },
      handler: async (args, ctx) => {
        const event = await callOp(ctx, "calendar_op_event_create", {
          p_title: str(args, "title"),
          p_starts_at: str(args, "starts_at"),
          p_ends_at: str(args, "ends_at"),
          p_all_day: bool(args, "all_day"),
          p_rrule: str(args, "rrule", false) || null,
          p_description: str(args, "description", false),
        });
        return event ? shapeEvent(event) : null;
      },
    },
    {
      name: "calendar_update_event",
      description: "Edit a native event (only the fields you pass change). External events are rejected.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          event_id: { type: "string", description: "The event uuid." },
          title: { type: "string", description: "New title." },
          starts_at: { type: "string", description: "New start (ISO 8601)." },
          ends_at: { type: "string", description: "New end (ISO 8601)." },
          all_day: { type: "boolean", description: "All-day toggle." },
          rrule: { type: "string", description: "New RRULE, or empty to clear the repeat." },
          description: { type: "string", description: "New notes." },
        },
        required: ["event_id"],
      },
      handler: async (args, ctx) => {
        // The op takes a camelCase jsonb patch of only-present keys.
        const patch: Row = {};
        if ("title" in args) patch.title = str(args, "title", false);
        if ("starts_at" in args) patch.startsAt = str(args, "starts_at");
        if ("ends_at" in args) patch.endsAt = str(args, "ends_at");
        if ("all_day" in args) patch.allDay = bool(args, "all_day");
        if ("rrule" in args) patch.rrule = str(args, "rrule", false) || null;
        if ("description" in args) patch.description = str(args, "description", false);
        const event = await callOp(ctx, "calendar_op_event_update", {
          p_event_id: str(args, "event_id"),
          p_patch: patch,
        });
        return event ? shapeEvent(event) : null;
      },
    },
    {
      name: "calendar_delete_event",
      description: "Delete a native event (tombstoned; spine links cascade). External events are rejected.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { event_id: { type: "string", description: "The event uuid." } },
        required: ["event_id"],
      },
      handler: async (args, ctx) => {
        await callOp(ctx, "calendar_op_event_delete", { p_event_id: str(args, "event_id") });
        return { ok: true };
      },
    },
    {
      name: "calendar_schedule_task",
      description: "Place a task on the calendar at a clock time — it becomes a task block (the lens).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task uuid." },
          scheduled_at: { type: "string", description: "The block's start instant (ISO 8601)." },
        },
        required: ["task_id", "scheduled_at"],
      },
      handler: async (args, ctx) => {
        const task = await callOp(ctx, "tasks_op_reschedule", {
          p_task_id: str(args, "task_id"),
          p_scheduled_at: str(args, "scheduled_at"),
          p_days: null,
        });
        return task ? { task_id: task.id, scheduled_at: task.scheduled_at } : null;
      },
    },
    {
      name: "calendar_move_block",
      description: "Move an already-scheduled task block to a new time (duration preserved).",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: {
          task_id: { type: "string", description: "The task uuid." },
          scheduled_at: { type: "string", description: "New start instant (ISO 8601)." },
        },
        required: ["task_id", "scheduled_at"],
      },
      handler: async (args, ctx) => {
        const task = await callOp(ctx, "tasks_op_reschedule", {
          p_task_id: str(args, "task_id"),
          p_scheduled_at: str(args, "scheduled_at"),
          p_days: null,
        });
        return task ? { task_id: task.id, scheduled_at: task.scheduled_at } : null;
      },
    },
    {
      name: "calendar_complete_block",
      description: "Complete a task from its block (recurrence advances) — same as completing in Tasks.",
      access: "edit",
      inputSchema: {
        type: "object",
        properties: { task_id: { type: "string", description: "The task uuid." } },
        required: ["task_id"],
      },
      handler: async (args, ctx) => {
        const task = await callOp(ctx, "tasks_op_set_status", {
          p_task_id: str(args, "task_id"),
          p_status: "done",
          p_recurrence: null,
          p_position: null,
        });
        return task ? { task_id: task.id, status: task.status } : null;
      },
    },
    {
      name: "calendar_roll_forward",
      description:
        "The strip's Move-to-today: reschedule every open task whose scheduled time passed (last 7 days) onto today, preserving each task's clock time. Returns the moved task ids.",
      access: "edit",
      inputSchema: { type: "object", properties: {} },
      handler: async (_args, ctx) => {
        const now = new Date();
        const drifted = await rows(
          ctx.db
            .from("tasks")
            .select("id, scheduled_at, duration_minutes")
            .eq("workspace_id", ctx.key.workspaceId)
            .is("deleted_at", null)
            .in("status", OPEN_STATUSES)
            .gte("scheduled_at", new Date(now.getTime() - 7 * 86_400_000).toISOString())
            .lt("scheduled_at", now.toISOString()),
        );
        // Unfinished = the block's END passed (the app's strip semantics) — an
        // in-progress block is not rolled out from under the user.
        const ended = drifted.filter((t) => {
          const start = Date.parse(t.scheduled_at);
          const durMs = (Number(t.duration_minutes) > 0 ? Number(t.duration_minutes) : 30) * 60_000;
          return Number.isFinite(start) && start + durMs <= now.getTime();
        });
        const moved: string[] = [];
        // First placement candidate: never in the past — the next 15-min
        // boundary after now (a rolled task landing behind now would be
        // instantly "unfinished" again). Slots then stack sequentially.
        const STEP = 15 * 60_000;
        let cursor = Math.ceil(now.getTime() / STEP) * STEP;
        for (const t of ended) {
          // Keep the original clock time when it's still ahead today (UTC);
          // otherwise take the next free sequential slot after now.
          const orig = new Date(t.scheduled_at);
          const sameClock = Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            orig.getUTCHours(),
            orig.getUTCMinutes(),
          );
          let targetMs: number;
          if (sameClock > now.getTime()) {
            targetMs = sameClock;
          } else {
            targetMs = cursor;
            const durMs =
              (Number(t.duration_minutes) > 0 ? Number(t.duration_minutes) : 30) * 60_000;
            cursor = Math.ceil((cursor + durMs) / STEP) * STEP;
          }
          const task = await callOp(ctx, "tasks_op_reschedule", {
            p_task_id: t.id,
            p_scheduled_at: new Date(targetMs).toISOString(),
            p_days: null,
          });
          if (task?.id) moved.push(task.id);
        }
        return { moved: moved.length, task_ids: moved };
      },
    },
  ],
};
