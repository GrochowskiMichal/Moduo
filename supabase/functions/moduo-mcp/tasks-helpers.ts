/**
 * Shared reads and argument helpers for the Tasks connector module
 * (modules/tasks.ts). They live outside modules/ so the drift gate that
 * collects tool names reads only tool definitions.
 *
 * Workspace scoping comes from the key, never from tool args. Reads run as
 * service_role (RLS bypassed), so every query here filters on
 * ctx.key.workspaceId and every task or project passes the creator's gate
 * (share_visible_ids / perm_can_see_entity). Something the key's person can't
 * see reads exactly like something that isn't there.
 */

import { isClosedTask, isOpenTask, pickTagColor } from "../_shared/contracts/vocabularies.ts";
import {
  queueTaskIds,
  readAllPages,
  rowTaskState,
  shapeTask,
  subtaskCounts,
} from "../_shared/tasks-connector.ts";
import type { ToolContext } from "./registry.ts";
import { visibleIds } from "./share.ts";
import { resolveTaskRef, TASK_NOT_FOUND, workspaceTaskKey } from "./task-ref.ts";

// Handles live in task-ref.ts (share.ts resolves them too); the Tasks tools
// keep importing them from here.
export { HANDLE, resolveTaskRef, TASK_NOT_FOUND, workspaceTaskKey } from "./task-ref.ts";

// deno-lint-ignore no-explicit-any
export type Row = Record<string, any>;

/** The same as TASK_NOT_FOUND (task-ref.ts), for a project. */
export const PROJECT_NOT_FOUND = "That project isn't in this workspace.";

// The creator's "completed" notification (TV-D1). The trail already says so
// through tasks.set_status, so agents don't get it twice (like the app's
// isTrailEntry).
export const NOTIFICATION_ONLY_OP = "tasks.completed";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function str(args: Row, name: string, required = true): string {
  const v = args?.[name];
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (!required) return "";
  throw new Error(`Missing required argument: ${name}`);
}

export function isoOrThrow(value: string, name: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`${name} must be an ISO 8601 datetime.`);
  return d.toISOString();
}

export function dayOrThrow(value: string, name: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${name} must be YYYY-MM-DD.`);
  return value;
}

export function clampLimit(args: Row, fallback: number, max: number): number {
  const v = Number(args?.limit);
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.min(Math.floor(v), max);
}

/** Projects archived in the app (TV-U6): they and their tasks stay out of every
 *  tool unless one asks for them (`include_archived`), and search finds them,
 *  labelled `project_archived` (REPLAN 78). */
export function archivedBucketIds(buckets: Row[]): Set<string> {
  return new Set(buckets.filter((b) => b.archived_at && !b.is_system).map((b) => b.id));
}

export async function rows(
  query: PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** An RPC's data, or its error's message thrown. */
export async function unwrap<T = unknown>(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data as T;
}

/** The key creator's queue rows here (TV-D2). Before the migration: none. */
export async function myQueueRows(ctx: ToolContext): Promise<Row[]> {
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

/** The workspace's members (the owner is one too), with names and permissions. */
export async function workspaceMembers(
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

/** Tasks + the cross-row context needed for computed state, one fetch. The
 * big reads go page by page: PostgREST stops at 1,000 rows a request, and a
 * list past that used to lose tasks silently (TV-D8, AC1.13). */
export async function loadWorkspace(ctx: ToolContext) {
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
  // Tags on the tasks the key's person can see, and nothing else: a count over
  // every task would tell about hidden ones (TV-D16).
  const seen = new Set([...tasks, ...archivedTasks].map((t) => t.id));
  const taskTags = new Map<string, string[]>();
  for (const link of tagLinks) {
    const name = tagName.get(link.tag_id);
    if (!name || !seen.has(link.entity_id)) continue;
    const list = taskTags.get(link.entity_id) ?? [];
    list.push(name);
    taskTags.set(link.entity_id, list);
  }
  return {
    tasks, relations, tags, byId, blockedIds, taskTags, names,
    subtaskCounts: subtaskCounts(tasks),
    queue,
    queuedByMe: new Set(queue),
    taskKey,
    archivedTasks,
  };
}

export type WorkspaceData = Awaited<ReturnType<typeof loadWorkspace>>;

/** The key creator's queue, shaped, in order. */
export async function shapedQueue(ctx: ToolContext): Promise<Row[]> {
  const data = await loadWorkspace(ctx);
  const now = new Date();
  return data.queue.map((id) => shapeTask(data.byId.get(id)!, data, now));
}

/** One live task the key's person can see (by uuid or handle), or not found. */
export async function fetchTask(ctx: ToolContext, ref: string): Promise<Row> {
  const id = await resolveTaskRef(ctx, ref);
  const { data, error } = await ctx.db.from("tasks").select("*")
    .eq("workspace_id", ctx.key.workspaceId).eq("id", id).is("deleted_at", null);
  // Not an id Postgres reads (22P02): there's no such task.
  if (error && (error as { code?: string }).code === "22P02") throw new Error(TASK_NOT_FOUND);
  if (error) throw new Error(error.message);
  const found = (data ?? []) as Row[];
  // Service role sees every row: only tasks shared with the key's creator exist.
  if (!found.length || !(await visibleIds(ctx, "task")).has(found[0]!.id)) {
    throw new Error(TASK_NOT_FOUND);
  }
  return found[0]!;
}

/** A live project the key's person can see, or not found. */
export async function fetchProject(ctx: ToolContext, id: string): Promise<Row> {
  if (!UUID.test(id)) throw new Error(PROJECT_NOT_FOUND);
  const found = await rows(
    ctx.db.from("buckets").select("*")
      .eq("workspace_id", ctx.key.workspaceId).eq("id", id).is("deleted_at", null),
  );
  if (!found.length || !(await visibleIds(ctx, "bucket")).has(found[0]!.id)) {
    throw new Error(PROJECT_NOT_FOUND);
  }
  return found[0]!;
}

/** Call a tasks_op_* RPC that answers with a task (or tasks), and shape it. */
export async function callOp(ctx: ToolContext, fn: string, args: Row): Promise<Row> {
  const { data, error } = await ctx.db.rpc(fn, {
    p_workspace_id: ctx.key.workspaceId,
    ...args,
  });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The operation returned nothing.");
  return shapeOne(ctx, row);
}

/** A task row as agents see it, with the workspace's context. A row the key's
 *  person can't see any more (a hand-over into someone else's Inbox) comes
 *  back as its handle and id only. */
export async function shapeOne(ctx: ToolContext, row: Row): Promise<Row> {
  const ws = await loadWorkspace(ctx);
  if (!ws.byId.has(row.id) && !ws.archivedTasks.some((t) => t.id === row.id)) {
    return {
      ...(ws.taskKey && row.number != null ? { handle: `${ws.taskKey}-${row.number}` } : {}),
      id: row.id,
      note: "Handed on: it's no longer in your view.",
    };
  }
  return shapeTask(row, ws, new Date(), true);
}

/** At most this many tags get a colour in one call (the first call after this
 *  shipped may find many made before it). */
export const COLOUR_TAGS_PER_CALL = 50;

/**
 * MOD-93: give every live tag without a colour the hue the app would have
 * given it. The ops make a tag from a name alone (tasks_op_tag, a template's
 * tags), while the app picks a colour when it makes one (pickTagColor), so a
 * tag an agent made used to stay colourless. Tags are coloured oldest first,
 * each counting the ones before it, so the hues spread as in the app; that
 * also colours the ones made before this fix. Nobody ever chooses "no colour"
 * (a recolour always names a hue), so a null is only ever a missing pick.
 * Colouring a tag is editing it, so it happens only for someone who may edit
 * the workspace's tags (perm_can_tag, the check the tags policy makes for the
 * app), at most COLOUR_TAGS_PER_CALL a call. Best effort: the call that made
 * the tag has already succeeded, and an uncoloured tag still shows in the
 * default hue.
 */
export async function colourBareTags(ctx: ToolContext): Promise<void> {
  const ws = ctx.key.workspaceId;
  try {
    const may = await ctx.db.rpc("perm_can_tag", { p_workspace_id: ws });
    if (may.error || may.data !== true) return;
    const tags = await rows(
      ctx.db.from("tags").select("id, color, created_at").eq("workspace_id", ws).is("deleted_at", null),
    );
    const bare = tags
      .filter((t) => !t.color)
      .sort((a, b) =>
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")) || String(a.id).localeCompare(String(b.id)));
    if (!bare.length) return;
    const coloured: { color: string | null }[] = tags.filter((t) => t.color).map((t) => ({ color: t.color }));
    for (const tag of bare.slice(0, COLOUR_TAGS_PER_CALL)) {
      const color = pickTagColor(coloured);
      // Only while it's still bare: a person may have just picked one.
      const { data, error } = await ctx.db.from("tags").update({ color })
        .eq("workspace_id", ws).eq("id", tag.id).is("color", null).select("id");
      if (error) return;
      // A hue someone picked meanwhile isn't known here, so it isn't counted.
      if (data?.length) coloured.push({ color });
    }
  } catch {
    // Reading the tags failed: they keep the default hue until the next call.
  }
}

/** Open, not closed: the one rule (TV-D9). */
export function isRowOpen(t: Row): boolean {
  return isOpenTask(rowTaskState(t));
}
export function isRowClosed(t: Row): boolean {
  return isClosedTask(rowTaskState(t));
}

/** The repeat an agent sends: an RRULE string, or {rrule, mode}, or null. */
export function recurrenceFromArg(value: unknown): Row | null {
  if (value === null) return null;
  if (typeof value === "string") {
    const rule = value.trim().replace(/^RRULE:/i, "");
    if (!rule) throw new Error("repeat must be an RRULE like FREQ=WEEKLY;BYDAY=TU.");
    return { rrule: rule };
  }
  if (value && typeof value === "object") {
    const v = value as Row;
    const rule = typeof v.rrule === "string" ? v.rrule.trim().replace(/^RRULE:/i, "") : "";
    if (!rule) throw new Error("repeat must be an RRULE like FREQ=WEEKLY;BYDAY=TU.");
    return v.mode ? { rrule: rule, mode: v.mode } : { rrule: rule };
  }
  throw new Error("repeat must be an RRULE like FREQ=WEEKLY;BYDAY=TU.");
}
