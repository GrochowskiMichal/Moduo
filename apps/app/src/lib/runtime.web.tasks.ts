import {
  activityRowSchema,
  mapKnownRows,
  requireRow,
  taskRelationRowSchema,
} from "@contracts/rows";
import { normalizeAccessChangeResource } from "@contracts/vocabularies";

import type {
  ActivityEntry,
  Bucket,
  ProjectStatus,
  Task,
  TaskQueueEntry,
  TaskRelation,
} from "../features/tasks/model";
import { type TaskView, taskViewFromRow } from "../features/tasks/view-row";
import {
  collectTruncations,
  PGRST_MAX_ROWS,
  READ_CAPS,
  readPaged,
  TAG_LINKS_SCOPE,
  type Truncation,
} from "./paged-select";
import { DbError, type Json, runQuery, runRpc, untypedDb } from "./runtime.db";
import type { TasksRuntime } from "./runtime.types";
import { createTasksAgents } from "./runtime.web.agents";
import { supabaseClient } from "./runtime.web.client";
import { getAuthedUser, selectCapped, type SelectOpts } from "./runtime.web.shared";
import { createTasksStructure } from "./runtime.web.structure";
import { createTasksTemplates, type TemplateApplyResult } from "./runtime.web.templates";
import { createTasksViews } from "./runtime.web.views";
import { deltaCursor, keysetAfter, newestStamp } from "./sync/kernel/delta";
import type {
  AccessChange,
  SyncAccessResult,
  SyncIdsResult,
  SyncReadInput,
  SyncReadResult,
  SyncRows,
  SyncTableName,
  TaskSearchResult,
} from "./sync/types";
import {
  agentSessionRowToModel,
  areaRowToModel,
  attachmentMarkRowToModel,
  bucketRowToModel,
  commentMarkRowToModel,
  editableTaskFields,
  projectStatusRowToModel,
  sectionRowToModel,
  sortQueueEntries,
  tagLinkRowToModel,
  tagRowToModel,
  taskCompletionRowToModel,
  taskCreateOpInput,
  taskCyclesFromJson,
  type TaskFieldPatch,
  taskPatchToOpFields,
  taskQueueRowToModel,
  taskReminderRowToModel,
  taskRowToModel,
  taskSessionRowToModel,
  taskTimeAnswerToModel,
  taskTimeEntryRowToModel,
  taskTimeTotalsRowToModel,
  taskWaitingRowToModel,
  teamMemberRowToModel,
  teamRowToModel,
  timeReportRowToModel,
  trackTimeExtras,
} from "./task-rows";

// ── Runtime implementation ────────────────────────────────────────────────────

/** TV-D10's structure reads and ops (runtime.web.structure.ts). */
const tasksStructure = createTasksStructure(supabaseClient, {
  userId: async () => (await getAuthedUser())?.id ?? null,
});

/** TV-D16's agent work and import runs (runtime.web.agents.ts). */
const tasksAgents = createTasksAgents(supabaseClient, {
  userId: async () => (await getAuthedUser())?.id ?? null,
});

/** TV-D15's templates and "Duplicate project…" (runtime.web.templates.ts). */
const tasksTemplates = createTasksTemplates(supabaseClient, {
  mapAnswer: (raw) => templateAnswerToModels(raw),
});

/** TV-U8's saved views (runtime.web.views.ts). */
const tasksViews = createTasksViews(supabaseClient);

// ── Tasks module: Inbox seeding + row<->model mappers ─────────────────────────

/** Call a single-task intent-op RPC and map the returned row. */
async function taskOpRpc(fn: string, args: Record<string, unknown>): Promise<Task> {
  const data = await runRpc(untypedDb(supabaseClient).rpc(fn, args));
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("The operation returned nothing.");
  return taskRowToModel(row);
}

/** How long a time write may take before it counts as failed. */
const TIME_WRITE_TIMEOUT_MS = 30_000;
/** Your own entries listed on one task (TV-D14): the newest this many. */
const MY_TIME_ENTRIES_CAP = 200;
/** Entries one time report reads (TV-D14); a longer one says it was cut. */
const TIME_REPORT_CAP = 20_000;

/** Call a tasks_op_queue_* RPC: each returns the caller's queue, in order. */
async function queueOpRpc(fn: string, args: Record<string, unknown>): Promise<TaskQueueEntry[]> {
  const data = await runRpc(untypedDb(supabaseClient).rpc(fn, args));
  return sortQueueEntries(mapKnownRows(Array.isArray(data) ? data : [], taskQueueRowToModel));
}

function activityRowToModel(raw: unknown): ActivityEntry {
  const r = requireRow(activityRowSchema, raw, "activity");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    module: r.module,
    entityType: r.entity_type,
    entityId: r.entity_id,
    op: r.op,
    actorType: r.actor_type ?? "user",
    actorId: r.actor_id ?? null,
    actorLabel: r.actor_label ?? null,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    createdAt: r.created_at,
  };
}

/** Ensure the workspace has its reserved Inbox bucket (idempotent). */
async function ensureWebInbox(workspaceId: string): Promise<Bucket> {
  const user = await getAuthedUser();
  const find = () =>
    supabaseClient
      .from("buckets")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("is_system", true)
      .eq("owner_id", user?.id ?? "")
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
  const { data: existing, error: findError } = await find();
  if (findError) throw new DbError(findError);
  if (existing) return bucketRowToModel(existing);
  const now = new Date().toISOString();
  const { data, error } = await supabaseClient
    .from("buckets")
    .insert({
      workspace_id: workspaceId,
      owner_id: user?.id ?? null,
      name: "Inbox",
      is_system: true,
      position: "a0", // low lexorank anchor — sorts first
      created_at: now,
      updated_at: now,
    })
    .select()
    .single();
  if (error) {
    // Lost a create race (unique partial index) — re-read the winner.
    const { data: again } = await find();
    if (again) return bucketRowToModel(again);
    throw new DbError(error);
  }
  return bucketRowToModel(data);
}

/** The pre-TV-D10 project save (also the "bucket" alias). */
async function upsertBucketRow(bucket: Bucket): Promise<Bucket> {
  const id = bucket.id?.trim() || crypto.randomUUID();
  const user = await getAuthedUser();
  const now = new Date().toISOString();
  const { data: prev } = await supabaseClient
    .from("buckets")
    .select("id")
    .eq("id", id)
    .maybeSingle();
  // A saved project's owner, workspace and Inbox flag never change (the
  // server refuses it), so a re-save writes its editable fields only.
  const editable = {
    name: bucket.name,
    group_label: bucket.group ?? null,
    position: bucket.position ?? "",
    updated_at: now,
    deleted_at: bucket.deletedAt ?? null,
  };
  const { data, error } = prev
    ? await supabaseClient.from("buckets").update(editable).eq("id", id).select().single()
    : await supabaseClient
        .from("buckets")
        .insert({
          ...editable,
          id,
          workspace_id: bucket.workspaceId,
          owner_id: bucket.ownerId || user?.id || null,
          // is_system is owned by the seeding path (ensureWebInbox) only.
          is_system: false,
          created_at: bucket.createdAt || now,
        })
        .select()
        .single();
  if (error) throw new DbError(error);
  return bucketRowToModel(data);
}

/**
 * Every status the reader can see in a workspace (TV-D9): the default set and
 * each visible project's. Empty on a database before TV-D9.
 */
async function listWorkspaceStatuses(
  workspaceId: string,
): Promise<{ statuses: ProjectStatus[]; truncation: Truncation | null }> {
  const res = await selectCapped<any>({
    scope: "statuses",
    cap: READ_CAPS.projectStatuses,
    build: (opts?: SelectOpts) =>
      supabaseClient
        .from("project_statuses")
        .select("*", opts)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null),
    order: (q) => q.order("position").order("id"),
  });
  if (res.error) throw new DbError(res.error);
  return { statuses: mapKnownRows(res.rows, projectStatusRowToModel), truncation: res.truncation };
}

// ── The shared store's reads (TV-D11a) ─────────────────────────────────────────
// One table at a time: its live rows on a first load, or every row changed
// since a server stamp (soft-deleted ones included, so a delete reaches the
// device copy). Paged by key, never by offset: an offset page shifts when a
// row is saved mid-read, and the row that slid past the page edge would be
// lost for good. The queue, tag links and relations delete for real: since
// TV-D11b's migration they carry `updated_at` and each delete leaves a row in
// `sync_tombstones`, so they delta too; a database without it answers whole.

type SyncSource = {
  table: string;
  select: string;
  map: (raw: unknown) => unknown;
  cap: number;
  /** Has `updated_at` (and soft deletes, or tombstones): read as a delta. */
  delta: boolean;
  /** Deletes are hard and leave a `sync_tombstones` row (TV-D11b), not `deleted_at`. */
  tombstones?: boolean;
  scope: string;
  /** Extra filters every read of it carries. */
  filter?: (q: any) => any;
  /** Order for a whole-table read (must end in `id`). */
  order?: (q: any) => any;
};

/** A saved view row, or a throw the reader drops (TV-U8). */
function taskViewRowToModel(raw: unknown): TaskView {
  const view = taskViewFromRow(raw);
  if (!view) throw new Error("An unreadable saved view.");
  return view;
}

const SYNC_SOURCES: Record<SyncTableName, SyncSource> = {
  tasks: {
    table: "tasks",
    select: "*",
    map: taskRowToModel,
    cap: READ_CAPS.tasks,
    delta: true,
    scope: "tasks",
  },
  buckets: {
    table: "buckets",
    select: "*",
    map: bucketRowToModel,
    cap: READ_CAPS.buckets,
    delta: true,
    scope: "buckets",
  },
  statuses: {
    table: "project_statuses",
    select: "*",
    map: projectStatusRowToModel,
    cap: READ_CAPS.projectStatuses,
    delta: true,
    scope: "statuses",
  },
  completions: {
    table: "task_completions",
    select: "*",
    map: taskCompletionRowToModel,
    cap: READ_CAPS.taskCompletions,
    delta: true,
    scope: "completions",
  },
  tags: {
    table: "tags",
    select: "*",
    map: tagRowToModel,
    cap: READ_CAPS.tags,
    delta: true,
    scope: "tags",
  },
  comments: {
    table: "comments",
    select: "id,entity_id,updated_at,deleted_at",
    map: commentMarkRowToModel,
    cap: READ_CAPS.taskComments,
    delta: true,
    scope: "comments",
    filter: (q) => q.eq("entity_type", "task"),
  },
  queue: {
    table: "task_queue",
    select: "*",
    map: taskQueueRowToModel,
    cap: READ_CAPS.taskQueue,
    delta: true,
    tombstones: true,
    scope: "queued tasks",
  },
  tagLinks: {
    table: "tag_links",
    select: "*",
    map: tagLinkRowToModel,
    cap: READ_CAPS.tagLinks,
    delta: true,
    tombstones: true,
    scope: TAG_LINKS_SCOPE,
  },
  relations: {
    table: "task_relations",
    select: "*",
    map: taskRelationRowToModel,
    cap: READ_CAPS.taskRelations,
    delta: true,
    tombstones: true,
    scope: "task dependencies",
  },
  // TV-D10. Plain selects under each table's RLS, which goes through the
  // access helpers (`areas__visible`, `projects__visible`, `can_access`).
  areas: {
    table: "areas",
    select: "*",
    map: areaRowToModel,
    cap: READ_CAPS.areas,
    delta: true,
    scope: "areas",
  },
  sections: {
    table: "sections",
    select: "*",
    map: sectionRowToModel,
    cap: READ_CAPS.sections,
    delta: true,
    scope: "sections",
  },
  teams: {
    table: "teams",
    select: "*",
    map: teamRowToModel,
    cap: READ_CAPS.teams,
    delta: true,
    scope: "teams",
  },
  teamMembers: {
    table: "team_members",
    select: "*",
    map: teamMemberRowToModel,
    cap: READ_CAPS.teamMembers,
    delta: true,
    scope: "team members",
  },
  sessions: {
    table: "task_sessions",
    select: "*",
    map: taskSessionRowToModel,
    cap: READ_CAPS.taskSessions,
    delta: true,
    scope: "work sessions",
  },
  reminders: {
    table: "task_reminders",
    select: "*",
    map: taskReminderRowToModel,
    cap: READ_CAPS.taskReminders,
    delta: true,
    scope: "reminders",
  },
  waiting: {
    table: "task_waiting",
    select: "*",
    map: taskWaitingRowToModel,
    cap: READ_CAPS.taskWaiting,
    delta: true,
    scope: "waiting entries",
  },
  // TV-U8: read whole every sync (SYNC_TABLES); RLS returns your views and
  // the shared ones you may see, never a deleted one.
  views: {
    table: "task_views",
    select: "*",
    map: taskViewRowToModel,
    cap: READ_CAPS.taskViews,
    delta: true,
    scope: "saved views",
  },
  // TV-D16: agent sessions, under RLS (yours, and teammates' they share).
  agentSessions: {
    table: "agent_sessions",
    select: "*",
    map: agentSessionRowToModel,
    cap: READ_CAPS.agentSessions,
    delta: true,
    scope: "agent sessions",
  },
  // AT-3: finished files on tasks, for the 📎 counts and an open strip's
  // refresh. Under RLS (the item gate: a file shows only to people who can see
  // its task); never a name, path or size. A finished file never goes back to
  // pending, and a trashed one keeps `ready`, so the delta sees every change.
  attachments: {
    table: "attachments",
    select: "id,entity_id,status,updated_at,deleted_at",
    map: attachmentMarkRowToModel,
    cap: READ_CAPS.attachmentMarks,
    delta: true,
    scope: "attachments",
    filter: (q) => q.eq("entity_type", "task").eq("status", "ready"),
  },
};

/** How many ids one `id=in.(…)` read carries (a URL stays well under its limit). */
const IDS_PER_READ = 150;

/**
 * Page a query by key up to `cap` rows: by `id` (a first load), or by
 * (`updated_at`, `id`) (a delta). `build` makes the filtered query afresh each
 * page (a builder is single-use).
 */
async function readByKey(args: {
  build: () => any;
  by: "id" | "updated_at";
  cap: number;
  scope: string;
  /** The stamp and key columns (`sync_tombstones` pages by `deleted_at`, `row_id`). */
  stampColumn?: string;
  keyColumn?: string;
}): Promise<{ rows: any[]; error: any; truncation: Truncation | null }> {
  const stamp = args.stampColumn ?? "updated_at";
  const key = args.keyColumn ?? "id";
  const rows: any[] = [];
  let last: { id: string; updatedAt: string } | null = null;
  // One past the cap tells "there is more" without a count.
  while (rows.length <= args.cap) {
    const want = Math.min(PGRST_MAX_ROWS, args.cap + 1 - rows.length);
    let q = args.build();
    if (args.by === "id") {
      if (last) q = q.gt(key, last.id);
      q = q.order(key);
    } else {
      // Keyset: the page after the last (stamp, key) read (kernel/delta.ts).
      if (last) q = q.or(keysetAfter(stamp, key, { stamp: last.updatedAt, key: last.id }));
      q = q.order(stamp).order(key);
    }
    const { data, error } = await q.limit(want);
    if (error) return { rows, error, truncation: null };
    const batch = (data ?? []) as any[];
    rows.push(...batch);
    if (batch.length < want) break;
    const tail = batch[batch.length - 1];
    last = { id: String(tail?.[key]), updatedAt: String(tail?.[stamp] ?? "") };
  }
  if (rows.length <= args.cap) return { rows, error: null, truncation: null };
  return {
    rows: rows.slice(0, args.cap),
    error: null,
    truncation: { scope: args.scope, shown: args.cap, total: null },
  };
}

/** The open categories (TV-D9): what the store reads first. */
const OPEN_CATEGORIES = ["todo", "in_progress"] as const;

async function syncReadTable(input: SyncReadInput): Promise<SyncReadResult<unknown>> {
  const source = SYNC_SOURCES[input.table];
  const empty: SyncReadResult<unknown> = {
    rows: [],
    deleted: [],
    maxUpdatedAt: null,
    truncated: null,
  };
  // No client retries: the store tries again itself, and a lost network must
  // read as "Offline" at once rather than after seconds of backoff.
  // `source.table` is picked at run time, so these reads are untyped (runtime.db.ts).
  const base = () => {
    let q = untypedDb(supabaseClient)
      .from(source.table)
      .select(source.select)
      .eq("workspace_id", input.workspaceId)
      .retry(false);
    if (source.filter) q = source.filter(q);
    return q;
  };

  if (!source.delta) {
    const res = await selectCapped<any>({
      scope: source.scope,
      cap: source.cap,
      build: (opts?: SelectOpts) => {
        let q = untypedDb(supabaseClient)
          .from(source.table)
          .select(source.select, opts)
          .eq("workspace_id", input.workspaceId)
          .retry(false);
        if (source.filter) q = source.filter(q);
        return q;
      },
      order: source.order ?? ((q) => q.order("id")),
    });
    if (res.error) throw new DbError(res.error);
    return { ...empty, rows: mapKnownRows(res.rows, source.map), truncated: res.truncation };
  }

  /** Live rows only: soft-deleted ones are skipped; a tombstoned table has none. */
  const live = (q: any) => (source.tombstones ? q : q.is("deleted_at", null));

  // A hard-delete table's changes: rows stamped since, plus its tombstones.
  if (source.tombstones && input.since && !input.ids) {
    return readTombstonedChanges(source, input.workspaceId, input.since);
  }

  // Rows the access check found you can see now (shared with you since):
  // read by id, live ones only.
  if (input.ids) {
    const rows: any[] = [];
    for (let i = 0; i < input.ids.length; i += IDS_PER_READ) {
      const chunk = input.ids.slice(i, i + IDS_PER_READ);
      const { data, error } = await live(base().in("id", chunk)).limit(PGRST_MAX_ROWS);
      if (error) throw new DbError(error);
      rows.push(...((data ?? []) as any[]));
    }
    return { ...empty, rows: mapKnownRows(rows, source.map) };
  }

  // Tasks' first load comes in two parts (open first).
  const partFilter = (q: any) => {
    if (input.table !== "tasks" || !input.part || input.since) return q;
    const col = "status_category";
    const open = `(${OPEN_CATEGORIES.join(",")})`;
    return input.part === "open"
      ? q.in(col, [...OPEN_CATEGORIES])
      : q.or(`${col}.is.null,${col}.not.in.${open}`);
  };
  const res = await readByKey({
    by: input.since && !source.tombstones ? "updated_at" : "id",
    cap: input.since
      ? Math.max(source.cap, READ_CAPS.syncDelta)
      : input.table === "tasks" && input.part === "rest"
        ? READ_CAPS.closedTasks
        : source.cap,
    scope: source.scope,
    build: () => {
      const q =
        input.since && !source.tombstones ? base().gte("updated_at", input.since) : live(base());
      return partFilter(q);
    },
  });
  if (res.error) throw new DbError(res.error);
  const liveRows: unknown[] = [];
  const deleted: string[] = [];
  const maxUpdatedAt = newestStamp(res.rows, (row) => row?.updated_at);
  for (const row of res.rows) {
    if (row?.deleted_at) {
      if (typeof row.id === "string") deleted.push(row.id);
    } else {
      liveRows.push(row);
    }
  }
  return {
    rows: mapKnownRows(liveRows, source.map),
    deleted,
    maxUpdatedAt,
    truncated: res.truncation,
  };
}

async function syncIdsOf(workspaceId: string, table: SyncTableName): Promise<SyncIdsResult> {
  const source = SYNC_SOURCES[table];
  if (!source.delta) return { ids: [], complete: false };
  const res = await readByKey({
    by: "id",
    cap: READ_CAPS.syncIds,
    scope: source.scope,
    build: () => {
      let q = untypedDb(supabaseClient)
        .from(source.table)
        .select("id")
        .eq("workspace_id", workspaceId);
      if (!source.tombstones) q = q.is("deleted_at", null);
      if (source.filter) q = source.filter(q);
      return q;
    },
  });
  if (res.error) throw new DbError(res.error);
  return { ids: res.rows.map((r) => String(r.id)), complete: res.truncation === null };
}

/**
 * Changes of a hard-delete table (TV-D11b): rows stamped since `since`, keyset
 * paged, plus the ids its deletes left in `sync_tombstones`.
 */
async function readTombstonedChanges(
  source: SyncSource,
  workspaceId: string,
  since: string,
): Promise<SyncReadResult<unknown>> {
  const rows = await readByKey({
    by: "updated_at",
    cap: Math.max(source.cap, READ_CAPS.syncDelta),
    scope: source.scope,
    build: () => {
      let q = untypedDb(supabaseClient)
        .from(source.table)
        .select(source.select)
        .eq("workspace_id", workspaceId)
        .gte("updated_at", since)
        .retry(false);
      if (source.filter) q = source.filter(q);
      return q;
    },
  });
  if (rows.error) throw new DbError(rows.error);
  const graves = await readByKey({
    by: "updated_at",
    stampColumn: "deleted_at",
    keyColumn: "row_id",
    cap: READ_CAPS.syncDelta,
    scope: source.scope,
    build: () =>
      supabaseClient
        .from("sync_tombstones")
        .select("row_id,deleted_at")
        .eq("workspace_id", workspaceId)
        .eq("table_name", source.table)
        .gte("deleted_at", since)
        .retry(false),
  });
  if (graves.error) throw new DbError(graves.error);
  // Where the next read starts: a stream cut at its ceiling holds it back.
  const maxUpdatedAt = deltaCursor(
    { stamps: rows.rows.map((r) => r?.updated_at), cut: rows.truncation !== null },
    { stamps: graves.rows.map((g) => g?.deleted_at), cut: graves.truncation !== null },
  );
  // A row deleted and made again under the same id (never: ids are random)
  // would be both; the live row wins.
  const liveIds = new Set(rows.rows.map((r) => String(r?.id)));
  return {
    rows: mapKnownRows(rows.rows, source.map),
    deleted: graves.rows.map((g) => String(g?.row_id)).filter((id) => !liveIds.has(id)),
    maxUpdatedAt,
    truncated: rows.truncation ?? graves.truncation,
  };
}

/**
 * The grant feed (TV-D11b, `access_changes`): what changed in who sees which
 * project or task since `since`. With `since` null, only the newest stamp
 * (a session's starting point). RLS returns your rows and the workspace's.
 */
async function readAccessChanges(
  workspaceId: string,
  since: string | null,
): Promise<SyncAccessResult> {
  if (since === null) {
    const { data, error } = await supabaseClient
      .from("access_changes")
      .select("changed_at")
      .eq("workspace_id", workspaceId)
      .order("changed_at", { ascending: false })
      .limit(1)
      .retry(false);
    if (error) throw new DbError(error);
    const stamp = (data as Array<{ changed_at?: unknown }> | null)?.[0]?.changed_at;
    return {
      changes: [],
      maxChangedAt: typeof stamp === "string" ? stamp : null,
      supported: true,
    };
  }
  // Paged by (changed_at, id): a burst of changes (a bulk move) past one page
  // never makes every read answer the same first page.
  const res = await readByKey({
    by: "updated_at",
    stampColumn: "changed_at",
    keyColumn: "id",
    cap: READ_CAPS.syncDelta,
    scope: "access changes",
    build: () =>
      supabaseClient
        .from("access_changes")
        .select("id,resource_type,resource_id,changed_at")
        .eq("workspace_id", workspaceId)
        .gte("changed_at", since)
        .retry(false),
  });
  if (res.error) throw new DbError(res.error);
  const changes: AccessChange[] = [];
  let maxChangedAt: string | null = null;
  for (const row of res.rows as Array<Record<string, unknown>>) {
    if (typeof row.resource_type !== "string" || typeof row.resource_id !== "string") continue;
    const changedAt = typeof row.changed_at === "string" ? row.changed_at : "";
    changes.push({
      id: String(row.id),
      resourceType: normalizeAccessChangeResource(row.resource_type),
      resourceId: row.resource_id,
      changedAt,
    });
    if (changedAt) maxChangedAt = changedAt;
  }
  return { changes, maxChangedAt, supported: true };
}

/** `tasks_search` (TV-D11b, GS-4): ids of the tasks you can see whose words start with every word typed. */
async function searchTasksOnServer(
  workspaceId: string,
  query: string,
  limit = 200,
): Promise<TaskSearchResult> {
  const { data, error } = await supabaseClient
    .rpc("tasks_search", { p_workspace_id: workspaceId, p_query: query, p_limit: limit })
    .retry(false);
  if (error) throw new DbError(error);
  const ids = ((data ?? []) as Array<string | { id?: unknown }>)
    .map((row) => (typeof row === "string" ? row : typeof row?.id === "string" ? row.id : null))
    .filter((id): id is string => id !== null);
  return { ids, supported: true };
}

/**
 * A field-level task edit through `tasks_op_update` (TV-D8): only the changed
 * fields go, the server checks, writes, registers a rename and logs it, and
 * answers with the task, then any subtasks it carried along. Before the
 * migration it falls back to the direct update (remove in TV-D7).
 */
async function opUpdateTaskRows(
  workspaceId: string,
  taskId: string,
  patch: TaskFieldPatch,
): Promise<Task[]> {
  const data = await runRpc(
    supabaseClient.rpc("tasks_op_update", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_patch: taskPatchToOpFields(patch) as Json,
    }),
  );
  const rows = mapKnownRows(data, taskRowToModel);
  if (!rows.length) throw new Error("The task edit returned nothing.");
  return rows;
}

/**
 * Every task lives in exactly one bucket; an empty, unknown, deleted or
 * cross-workspace bucket falls back to the Inbox (spec §6/§7). A failed read
 * throws: it says nothing about the bucket, so it never files into the Inbox.
 */
async function liveBucketOrInbox(
  workspaceId: string,
  bucketId: string | null | undefined,
): Promise<string> {
  if (bucketId) {
    const { data: b, error } = await supabaseClient
      .from("buckets")
      .select("workspace_id, deleted_at")
      .eq("id", bucketId)
      .maybeSingle();
    if (error) throw new DbError(error);
    if (b && b.workspace_id === workspaceId && !b.deleted_at) return bucketId;
  }
  return (await ensureWebInbox(workspaceId)).id;
}

/**
 * Create a task under its own id. Every create is the server op (TV-D8): it
 * numbers the task, registers it for search and logs it; the client's id makes
 * a resend idempotent (a capture flushed twice from the offline queue is one
 * task, TV-D11a). No id: a new one.
 */
async function createTaskRow(task: Task): Promise<Task> {
  const now = new Date().toISOString();
  const created = {
    ...task,
    id: task.id?.trim() || crypto.randomUUID(),
    createdAt: task.createdAt || now,
    updatedAt: now,
  };
  const data = await runRpc(
    supabaseClient.rpc("tasks_op_create", {
      p_workspace_id: task.workspaceId,
      p_task: taskCreateOpInput(created) as Json,
    }),
  );
  return taskRowToModel(Array.isArray(data) ? data[0] : data);
}

/**
 * What a template apply or a duplicate answered (raw rows per store table,
 * `templates__bundle`) as the store's rows, through each table's own mapper.
 * A row this build can't read is left out; the next sync brings it.
 */
function templateAnswerToModels(raw: unknown): TemplateApplyResult {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rows = <T extends "buckets" | "statuses" | "sections" | "tasks" | "tagLinks" | "relations">(
    name: T,
  ): SyncRows[T][] => {
    const list = r[name];
    if (!Array.isArray(list)) return [];
    const map = SYNC_SOURCES[name].map as (row: unknown) => SyncRows[T];
    return list.flatMap((row) => {
      try {
        return [map(row)];
      } catch {
        return [];
      }
    });
  };
  return {
    buckets: rows("buckets"),
    statuses: rows("statuses"),
    sections: rows("sections"),
    tasks: rows("tasks"),
    tagLinks: rows("tagLinks"),
    relations: rows("relations"),
  };
}

function taskRelationRowToModel(raw: unknown): TaskRelation {
  const r = requireRow(taskRelationRowSchema, raw, "task relation");
  return {
    id: r.id,
    workspaceId: r.workspace_id,
    blockerTaskId: r.blocker_task_id,
    blockedTaskId: r.blocked_task_id,
    createdAt: r.created_at,
  };
}

// ── Tasks module ───────────────────────────────────────────────────────────
// Supabase-backed mirror of the desktop redb path. RLS scopes every row to the
// workspace; the Inbox bucket is seeded lazily here (no DB trigger). camelCase
// model fields map to snake_case columns via the helpers at the bottom of this
// file.
export const webTasks: TasksRuntime = {
  // TV-D10: areas, projects, sections, teams, sessions, reminders, waiting.
  ...tasksStructure,
  // TV-D15: templates and "Duplicate project…".
  ...tasksTemplates,
  // TV-U8: saved views.
  ...tasksViews,
  ...tasksAgents,
  async list(workspaceId) {
    // Best effort: a Viewer can't create their own Inbox (no tasks.create),
    // and that must not stop them reading the shared buckets.
    await ensureWebInbox(workspaceId).catch(() => null);
    const live = (table: string) => (opts?: SelectOpts) =>
      untypedDb(supabaseClient)
        .from(table)
        .select("*", opts)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
    const all = (table: string) => (opts?: SelectOpts) =>
      untypedDb(supabaseClient).from(table).select("*", opts).eq("workspace_id", workspaceId);
    const [bucketsRes, tasksRes, tagsRes, linksRes, relationsRes, statusesRes, structure] =
      await Promise.all([
        selectCapped<any>({
          scope: "buckets",
          cap: READ_CAPS.buckets,
          build: live("buckets"),
          order: (q) => q.order("position").order("id"),
        }),
        selectCapped<any>({
          scope: "tasks",
          cap: READ_CAPS.tasks,
          build: live("tasks"),
          order: (q) => q.order("position").order("id"),
        }),
        selectCapped<any>({
          scope: "tags",
          cap: READ_CAPS.tags,
          build: live("tags"),
          order: (q) => q.order("created_at").order("id"),
        }),
        selectCapped<any>({
          scope: TAG_LINKS_SCOPE,
          cap: READ_CAPS.tagLinks,
          build: all("tag_links"),
          order: (q) => q.order("id"),
        }),
        selectCapped<any>({
          scope: "task dependencies",
          cap: READ_CAPS.taskRelations,
          build: all("task_relations"),
          order: (q) => q.order("id"),
        }),
        listWorkspaceStatuses(workspaceId),
        // TV-D10: areas, sections, teams and their members.
        tasksStructure.listStructure(workspaceId),
      ]);
    const firstError =
      bucketsRes.error || tasksRes.error || tagsRes.error || linksRes.error || relationsRes.error;
    if (firstError) throw new DbError(firstError);
    return {
      // Archived projects come too: the shared store sets them apart (TV-U6).
      buckets: mapKnownRows(bucketsRes.rows, bucketRowToModel),
      tasks: mapKnownRows(tasksRes.rows, taskRowToModel),
      tags: mapKnownRows(tagsRes.rows, tagRowToModel),
      tagLinks: mapKnownRows(linksRes.rows, tagLinkRowToModel),
      taskRelations: mapKnownRows(relationsRes.rows, taskRelationRowToModel),
      statuses: statusesRes.statuses,
      areas: structure.areas,
      sections: structure.sections,
      teams: structure.teams,
      teamMembers: structure.teamMembers,
      truncated: [
        ...collectTruncations(
          bucketsRes.truncation,
          tasksRes.truncation,
          tagsRes.truncation,
          linksRes.truncation,
          relationsRes.truncation,
          statusesRes.truncation,
        ),
        ...structure.truncated,
      ],
    };
  },

  async syncRead<T extends SyncTableName>(
    input: SyncReadInput<T>,
  ): Promise<SyncReadResult<SyncRows[T]>> {
    return (await syncReadTable(input)) as SyncReadResult<SyncRows[T]>;
  },

  async syncIds({ workspaceId, table }) {
    return syncIdsOf(workspaceId, table);
  },

  async syncAccessChanges({ workspaceId, since }) {
    return readAccessChanges(workspaceId, since);
  },

  async searchTasks({ workspaceId, query, limit }) {
    return searchTasksOnServer(workspaceId, query, limit);
  },

  async createTask(task) {
    return createTaskRow(task);
  },

  async listStatuses(workspaceId) {
    const res = await listWorkspaceStatuses(workspaceId);
    return res.statuses;
  },

  async createStatus({ workspaceId, projectId, category, name }) {
    const data = await runRpc(
      supabaseClient.rpc("project_statuses_op_create", {
        p_workspace_id: workspaceId,
        p_project_id: projectId,
        p_category: category,
        p_name: name,
      }),
    );
    return mapKnownRows(data, projectStatusRowToModel);
  },

  async updateStatus({ workspaceId, statusId, patch }) {
    const data = await runRpc(
      supabaseClient.rpc("project_statuses_op_update", {
        p_workspace_id: workspaceId,
        p_status_id: statusId,
        p_patch: patch,
      }),
    );
    return mapKnownRows(data, projectStatusRowToModel);
  },

  async deleteStatus({ workspaceId, statusId }) {
    const data = await runRpc(
      supabaseClient.rpc("project_statuses_op_delete", {
        p_workspace_id: workspaceId,
        p_status_id: statusId,
      }),
    );
    const answer = (data ?? {}) as {
      moved?: unknown;
      moved_to?: unknown;
      moved_to_name?: unknown;
    };
    return {
      moved: typeof answer.moved === "number" ? answer.moved : 0,
      movedTo: typeof answer.moved_to === "string" ? answer.moved_to : null,
      movedToName: typeof answer.moved_to_name === "string" ? answer.moved_to_name : null,
    };
  },

  async seedInbox(workspaceId) {
    return ensureWebInbox(workspaceId);
  },

  // The pre-TV-D10 save, kept as the "bucket" alias: a raw insert or an
  // update of the editable columns (createProject / updateProject are the ops).
  async upsertBucket(bucket) {
    return upsertBucketRow(bucket);
  },

  async upsertTask(task) {
    const now = new Date().toISOString();
    const bucketId = await liveBucketOrInbox(task.workspaceId, task.bucketId);
    // Re-saving a task that already exists writes its editable fields only,
    // never its creator or assignee (TV-D1). A failed existence read throws:
    // the idempotent create path would return the stored row and drop the edit.
    if (task.id?.trim()) {
      const { data: prev, error } = await supabaseClient
        .from("tasks")
        .select("id")
        .eq("id", task.id)
        .maybeSingle();
      if (error) throw new DbError(error);
      if (prev) {
        const [saved] = await opUpdateTaskRows(task.workspaceId, task.id, {
          ...editableTaskFields(task),
          bucketId,
        });
        return saved;
      }
    }
    return createTaskRow({ ...task, bucketId, createdAt: task.createdAt || now });
  },

  async updateTask({ workspaceId, taskId, patch }) {
    const fields: TaskFieldPatch =
      patch.bucketId === undefined
        ? patch
        : { ...patch, bucketId: await liveBucketOrInbox(workspaceId, patch.bucketId) };
    const [saved] = await opUpdateTaskRows(workspaceId, taskId, fields);
    return saved;
  },

  async opUpdateTask({ workspaceId, taskId, patch }) {
    const fields: TaskFieldPatch =
      patch.bucketId === undefined
        ? patch
        : { ...patch, bucketId: await liveBucketOrInbox(workspaceId, patch.bucketId) };
    return opUpdateTaskRows(workspaceId, taskId, fields);
  },

  async listCompletions(workspaceId) {
    const res = await selectCapped<any>({
      scope: "completions",
      cap: READ_CAPS.taskCompletions,
      build: (opts?: SelectOpts) =>
        supabaseClient
          .from("task_completions")
          .select("*", opts)
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null),
      order: (q) => q.order("completed_at").order("id"),
    });
    if (res.error) throw new DbError(res.error);
    return {
      completions: mapKnownRows(res.rows, taskCompletionRowToModel),
      truncated: collectTruncations(res.truncation),
    };
  },

  async deleteTask({ workspaceId, taskId }) {
    // The edit op deletes and promotes the subtasks in one go (TV-D8).
    const data = await runRpc(
      supabaseClient.rpc("tasks_op_update", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
        p_patch: { deleted_at: new Date().toISOString() },
      }),
    );
    return taskRowToModel(Array.isArray(data) ? data[0] : data);
  },

  async upsertTag(tag) {
    const id = tag.id?.trim() || crypto.randomUUID();
    const user = await getAuthedUser();
    const now = new Date().toISOString();
    const { data: prev } = await supabaseClient
      .from("tags")
      .select("id")
      .eq("id", id)
      .maybeSingle();
    // A saved tag's owner and workspace never change (the server refuses
    // it), so a re-save writes its editable fields only.
    const editable = {
      name: tag.name,
      color: tag.color ?? null,
      updated_at: now,
      deleted_at: tag.deletedAt ?? null,
    };
    const { data, error } = prev
      ? await supabaseClient.from("tags").update(editable).eq("id", id).select().single()
      : await supabaseClient
          .from("tags")
          .insert({
            ...editable,
            id,
            workspace_id: tag.workspaceId,
            owner_id: tag.ownerId || user?.id || null,
            created_at: tag.createdAt || now,
          })
          .select()
          .single();
    if (error) throw new DbError(error);
    return tagRowToModel(data);
  },

  async deleteTag({ tagId }) {
    const now = new Date().toISOString();
    // Tags are deleted softly, and the server takes a deleted tag off
    // everything it was on, items this person can't edit included.
    const data = await runQuery(
      supabaseClient
        .from("tags")
        .update({ deleted_at: now, updated_at: now })
        .eq("id", tagId)
        .select("id"),
    );
    // An update the server's rules filter out matches no row and no error.
    if (!data?.length) throw new Error("You can't delete this tag.");
    // Already gone on a server with that rule; kept for one without it.
    await supabaseClient.from("tag_links").delete().eq("tag_id", tagId);
  },

  async attachTag({ workspaceId, tagId, entityType, entityId }) {
    const { data: existing } = await supabaseClient
      .from("tag_links")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("tag_id", tagId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId)
      .maybeSingle();
    if (existing) return tagLinkRowToModel(existing);
    const data = await runQuery(
      supabaseClient
        .from("tag_links")
        .insert({
          workspace_id: workspaceId,
          tag_id: tagId,
          entity_type: entityType,
          entity_id: entityId,
        })
        .select()
        .single(),
    );
    return tagLinkRowToModel(data);
  },

  async detachTag({ workspaceId, tagId, entityType, entityId }) {
    await runQuery(
      supabaseClient
        .from("tag_links")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("tag_id", tagId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId),
    );
  },

  async listEntityTags({ workspaceId, entityType, entityId }) {
    // The links half is one entity's rows (never near a page); the tags half
    // is workspace-wide, so it pages like every other list read (SCALE-1).
    const [tagsRes, linksRes] = await Promise.all([
      selectCapped<any>({
        scope: "tags",
        cap: READ_CAPS.tags,
        build: (opts) =>
          supabaseClient
            .from("tags")
            .select("*", opts)
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null),
        order: (q) => q.order("created_at").order("id"),
      }),
      // Only this entity's links. (A stray workspace-wide read here filtered
      // on `tag_links.deleted_at`, a column that doesn't exist, so the whole
      // read failed and every hub's tag row stayed empty until TV-T1.)
      supabaseClient
        .from("tag_links")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("entity_type", entityType)
        .eq("entity_id", entityId),
    ]);
    const firstError = tagsRes.error || linksRes.error;
    if (firstError) throw new DbError(firstError);
    return {
      tags: mapKnownRows(tagsRes.rows, tagRowToModel),
      links: mapKnownRows(linksRes.data, tagLinkRowToModel),
    };
  },

  async listTagLinks({ workspaceId, entityTypes }) {
    // This used to read `.limit(5000)` with a comment claiming it lifted
    // PostgREST's cap. It did NOT — max-rows is a hard per-request ceiling,
    // so the read silently stopped at 1000 anyway (SCALE-1). Page instead.
    const [tagsRes, linksRes] = await Promise.all([
      selectCapped<any>({
        scope: "tags",
        cap: READ_CAPS.tags,
        build: (opts) =>
          supabaseClient
            .from("tags")
            .select("*", opts)
            .eq("workspace_id", workspaceId)
            .is("deleted_at", null),
        order: (q) => q.order("created_at").order("id"),
      }),
      selectCapped<any>({
        scope: TAG_LINKS_SCOPE,
        cap: READ_CAPS.tagLinks,
        build: (opts) => {
          const q = supabaseClient
            .from("tag_links")
            .select("*", opts)
            .eq("workspace_id", workspaceId);
          return entityTypes && entityTypes.length > 0 ? q.in("entity_type", entityTypes) : q;
        },
        order: (q) => q.order("id"),
      }),
    ]);
    const firstError = tagsRes.error || linksRes.error;
    if (firstError) throw new DbError(firstError);
    return {
      tags: mapKnownRows(tagsRes.rows, tagRowToModel),
      links: mapKnownRows(linksRes.rows, tagLinkRowToModel),
      truncated: collectTruncations(tagsRes.truncation, linksRes.truncation),
    };
  },

  async createTaskRelation({ workspaceId, blockerTaskId, blockedTaskId }) {
    // Idempotent like attachTag — re-adding an existing edge returns it.
    const { data: existing } = await supabaseClient
      .from("task_relations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("blocker_task_id", blockerTaskId)
      .eq("blocked_task_id", blockedTaskId)
      .maybeSingle();
    if (existing) return taskRelationRowToModel(existing);
    const data = await runQuery(
      supabaseClient
        .from("task_relations")
        .insert({
          workspace_id: workspaceId,
          blocker_task_id: blockerTaskId,
          blocked_task_id: blockedTaskId,
        })
        .select()
        .single(),
    );
    return taskRelationRowToModel(data);
  },

  async deleteTaskRelation({ workspaceId, relationId }) {
    await runQuery(
      supabaseClient
        .from("task_relations")
        .delete()
        .eq("workspace_id", workspaceId)
        .eq("id", relationId),
    );
  },

  // Each person's own since TV-D10 (user_preferences.task_time_blocks); the
  // workspace table before it.
  async getTimeBlocks(workspaceId) {
    return tasksStructure.getTimeBlocks(workspaceId);
  },

  async setTimeBlocks({ workspaceId, blocks }) {
    return tasksStructure.setTimeBlocks(workspaceId, blocks);
  },

  // ── intent ops (docs/moduo-module-contract.md) ─────────────────────────
  // Each RPC checks permission, enforces invariants, writes, and logs an
  // attributed module_activity row in one transaction.
  async opCommit({ workspaceId, taskId, forDate }) {
    return taskOpRpc("tasks_op_commit", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_for: forDate,
    });
  },

  async opUncommit({ workspaceId, taskId }) {
    return taskOpRpc("tasks_op_uncommit", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
    });
  },

  async opSkipToday({ workspaceId, taskId }) {
    return taskOpRpc("tasks_op_skip_today", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
    });
  },

  // ── personal queues (TV-D2) ──────────────────────────────────────────
  async listQueue(workspaceId) {
    const res = await selectCapped<any>({
      scope: "queued tasks",
      cap: READ_CAPS.taskQueue,
      build: (opts?: SelectOpts) =>
        supabaseClient.from("task_queue").select("*", opts).eq("workspace_id", workspaceId),
      order: (q) => q.order("user_id").order("position").order("id"),
    });
    if (res.error) throw new DbError(res.error);
    return sortQueueEntries(mapKnownRows(res.rows, taskQueueRowToModel));
  },

  async opQueueAdd({ workspaceId, taskId, at }) {
    return queueOpRpc("tasks_op_queue_add", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_at: at ?? "end",
    });
  },

  async opQueueRemove({ workspaceId, taskId }) {
    return queueOpRpc("tasks_op_queue_remove", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
    });
  },

  async opQueueReorder({ workspaceId, taskId, afterTaskId }) {
    return queueOpRpc("tasks_op_queue_reorder", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_after_task_id: afterTaskId,
    });
  },

  async opQueueMoveToEnd({ workspaceId, taskId }) {
    return queueOpRpc("tasks_op_queue_move_to_end", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
    });
  },

  // ── tracked time (TV-D3) ─────────────────────────────────────────────
  async trackTime(input) {
    // A request that hangs fails after 30 s, so the task's next write isn't
    // stuck behind it; a Focus save is resent with its key, safely.
    const { data, error } = await supabaseClient
      .rpc("tasks_op_track_time", {
        p_workspace_id: input.workspaceId,
        p_task_id: input.taskId,
        p_action: input.action,
        p_seconds:
          input.action === "undo" || input.action === "remove" || input.seconds === undefined
            ? null
            : Math.round(input.seconds),
        p_ended_at: input.endedAt ?? null,
        p_client_key: input.key ?? null,
        p_entry_id: input.entryId ?? null,
        // TV-D14: sent only when used.
        ...trackTimeExtras(input),
      })
      .abortSignal(AbortSignal.timeout(TIME_WRITE_TIMEOUT_MS));
    if (error) throw new DbError(error);
    return taskTimeAnswerToModel(Array.isArray(data) ? data[0] : data);
  },

  async listTimeTotals(workspaceId, since) {
    const data = await runRpc(
      supabaseClient.rpc("tasks_time_totals", {
        p_workspace_id: workspaceId,
        p_since: since ?? null,
      }),
    );
    return mapKnownRows(Array.isArray(data) ? data : [], taskTimeTotalsRowToModel);
  },

  async listMyTimeEntries(workspaceId, taskId) {
    // RLS answers only your own entries, on a task you can see (TV-D14).
    const { data, error } = await supabaseClient
      .from("task_time_entries")
      .select(
        "id, task_id, kind, seconds, started_at, ended_at, entry_on, note, reason, run_id, created_at",
      )
      .eq("workspace_id", workspaceId)
      .eq("task_id", taskId)
      .neq("kind", "legacy")
      .order("created_at", { ascending: false })
      .order("id")
      .limit(MY_TIME_ENTRIES_CAP);
    if (error) throw new DbError(error);
    return mapKnownRows(Array.isArray(data) ? data : [], taskTimeEntryRowToModel);
  },

  async exportTimeEntries(workspaceId) {
    // Your own entries, on tasks you can still see (RLS), for the export.
    const build = (opts?: { count: "exact"; head: true }) =>
      supabaseClient
        .from("task_time_entries")
        .select(
          "id, task_id, kind, seconds, started_at, ended_at, entry_on, note, reason, run_id, created_at",
          opts,
        )
        .eq("workspace_id", workspaceId)
        .neq("kind", "legacy");
    const res = await readPaged<Record<string, unknown>, { message: string; code?: string }>({
      scope: "time entries",
      cap: TIME_REPORT_CAP,
      page: async (offset, limit) => {
        const { data, error } = await build()
          .order("created_at", { ascending: false })
          .order("id")
          .range(offset, offset + limit - 1);
        return { data: (data ?? null) as Record<string, unknown>[] | null, error };
      },
      countTotal: async () => {
        const { count, error } = await build({ count: "exact", head: true });
        return error ? null : (count ?? null);
      },
      keyOf: (row) => String(row.id),
    });
    if (res.error) throw new DbError(res.error);
    return {
      entries: mapKnownRows(res.rows, taskTimeEntryRowToModel),
      truncated: collectTruncations(res.truncation),
    };
  },

  async timeReport(query) {
    const res = await readPaged<Record<string, unknown>, { message: string; code?: string }>({
      scope: "time entries",
      cap: TIME_REPORT_CAP,
      page: async (offset, limit) => {
        // The function orders its rows totally (day, task, entry), so pages
        // never skip or repeat one.
        const { data, error } = await supabaseClient
          .rpc("tasks_time_report", {
            p_workspace_id: query.workspaceId,
            p_from: query.from,
            p_to: query.to,
            p_project_ids: query.projectIds ? [...query.projectIds] : null,
            p_client_contact_id: query.clientContactId ?? null,
            p_zone: query.zone ?? null,
            // The function stops at the end of this page (PostgREST slices after it).
            p_limit: offset + limit,
          })
          .range(offset, offset + limit - 1);
        return { data: (data ?? null) as Record<string, unknown>[] | null, error };
      },
      keyOf: (row) => String(row.entry_id),
    });
    if (res.error) throw new DbError(res.error);
    return {
      rows: mapKnownRows(res.rows, timeReportRowToModel),
      truncated: res.truncation !== null,
    };
  },

  async opSetStatus({ workspaceId, taskId, status, recurrence, position }) {
    return taskOpRpc("tasks_op_set_status", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_status: status,
      p_recurrence: recurrence ?? null,
      p_position: position ?? null,
    });
  },

  async opAssign({ workspaceId, taskId, assigneeId }) {
    return taskOpRpc("tasks_op_assign", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_assignee_id: assigneeId,
    });
  },

  opClaim({ workspaceId, taskId }) {
    return taskOpRpc("tasks_op_claim", { p_workspace_id: workspaceId, p_task_id: taskId });
  },

  async opReschedule({ workspaceId, taskId, scheduledAt, days }) {
    return taskOpRpc("tasks_op_reschedule", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_scheduled_at: scheduledAt,
      p_days: days ?? null,
    });
  },

  async opUnschedule({ workspaceId, taskId }) {
    return taskOpRpc("tasks_op_unschedule", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
    });
  },

  async opSkipOccurrence({ workspaceId, taskId, scheduledAt, recurrence, releaseCommit }) {
    return taskOpRpc("tasks_op_skip_occurrence", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_scheduled_at: scheduledAt,
      p_recurrence: recurrence,
      p_release_commit: releaseCommit,
    });
  },

  async opMoveOccurrence({ workspaceId, taskId, dueOn, startsAt }) {
    return taskOpRpc("tasks_op_move_occurrence", {
      p_workspace_id: workspaceId,
      p_task_id: taskId,
      p_due_on: dueOn ?? null,
      p_starts_at: startsAt ?? null,
    });
  },

  async taskHistory({ workspaceId, taskId }) {
    const data = await runRpc(
      supabaseClient.rpc("tasks_op_history", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
      }),
    );
    return taskCyclesFromJson(data);
  },

  async listAgentCaptures({ workspaceId, taskIds }) {
    // The trail's own read policy answers only tasks the caller can see, so a
    // key's name never reaches anyone else (TV-U13b). 100 ids per request
    // keeps the URL short.
    const out: Array<{ taskId: string; label: string }> = [];
    for (let i = 0; i < taskIds.length; i += 100) {
      const data = await runQuery(
        supabaseClient
          .from("module_activity")
          .select("entity_id, actor_label")
          .eq("workspace_id", workspaceId)
          .eq("module", "tasks")
          .eq("entity_type", "task")
          .eq("op", "tasks.create")
          .eq("actor_type", "api_key")
          .in("entity_id", taskIds.slice(i, i + 100)),
      );
      for (const row of (data ?? []) as Array<{
        entity_id: string;
        actor_label: string | null;
      }>) {
        if (row.actor_label?.trim()) out.push({ taskId: row.entity_id, label: row.actor_label });
      }
    }
    return out;
  },

  async mentionInTask({ workspaceId, taskId, userIds }) {
    if (userIds.length === 0) return 0;
    const data = await runRpc(
      supabaseClient.rpc("tasks_op_mention", {
        p_workspace_id: workspaceId,
        p_task_id: taskId,
        p_user_ids: userIds,
      }),
    );
    return typeof data === "number" ? data : 0;
  },

  async opCatchUp({ workspaceId, items }) {
    const data = await runRpc(
      supabaseClient.rpc("tasks_op_catch_up", {
        p_workspace_id: workspaceId,
        p_items: items.map((i) => ({
          task_id: i.taskId,
          kind: i.kind,
          status: i.status ?? null,
          scheduled_at: i.scheduledAt ?? null,
          recurrence: i.recurrence,
          clear_commit: i.clearCommit ?? false,
        })),
      }),
    );
    return mapKnownRows(data, taskRowToModel);
  },

  async listActivity({ workspaceId, entityType, entityId, limit, module }) {
    // `module` scopes the trail to one module (e.g. Tasks). Omit it to read the
    // entity's activity across ALL modules — what a spine entity (a contact /
    // company) wants, since its touches are logged under module='contacts' (and
    // links/comments on it under other modules), never 'tasks'.
    let q = supabaseClient
      .from("module_activity")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("entity_type", entityType)
      .eq("entity_id", entityId);
    if (module) q = q.eq("module", module);
    const data = await runQuery(q.order("created_at", { ascending: false }).limit(limit ?? 50));
    return mapKnownRows(data, activityRowToModel);
  },
};
