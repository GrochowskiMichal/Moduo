// The Tasks structure around tasks (TV-D10, specs/tasks-v3.md block 10):
// areas, project fields, sections, teams, work sessions, reminders, Waiting
// on…, and each person's time blocks. Reads are plain selects under each
// table's row-level security; every write is an op (`*_op_*`), which checks,
// writes and answers in one transaction. Split out of runtime.web.ts so it
// stays testable with a fake client and so the shared store (TV-D11a) can
// read the same tables without touching the bundle load.
//
// A database before the TV-D10 migrations (the merge-before-apply window)
// reads as empty; the writes that existing pickers make (create, rename and
// group a project, time blocks) fall back to what that database has.

import type { ProjectState, TaskReminderKind, TaskWaitingKind } from "@contracts/vocabularies";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Area,
  Bucket,
  Section,
  TaskReminder,
  TaskSession,
  TaskWaitingEntry,
  Team,
  TeamMember,
  TimeBlockMap,
} from "../features/tasks/model";
import { sanitizeTimeBlocks } from "../features/tasks/model";
import { collectTruncations, READ_CAPS, readPaged, type Truncation } from "./paged-select";
import {
  areaRowToModel,
  bucketRowToModel,
  isMissingColumnError,
  isMissingFunctionError,
  isMissingTableError,
  sectionRowToModel,
  taskReminderRowToModel,
  taskSessionRowToModel,
  taskWaitingRowToModel,
  teamMemberRowToModel,
  teamRowToModel,
} from "./task-rows";

/** The project fields an op takes (TV-D10). Only the keys given are written. */
export type ProjectFields = {
  name?: string;
  status?: ProjectState;
  /** YYYY-MM-DD; null clears. */
  startsOn?: string | null;
  targetOn?: string | null;
  leadId?: string | null;
  clientContactId?: string | null;
  areaId?: string | null;
  position?: string;
};

export type SectionFields = {
  name?: string;
  /** YYYY-MM-DD; a section has an end date, or a start and an end. */
  startsOn?: string | null;
  endsOn?: string | null;
};

export type TeamFields = {
  name?: string;
  /** One or two letters; empty makes them from the name again. */
  mark?: string;
  color?: string | null;
  defaultProjectId?: string | null;
};

/** The structure the Tasks bundle carries: small, read with the tasks. */
export type TasksStructure = {
  areas: Area[];
  sections: Section[];
  teams: Team[];
  teamMembers: TeamMember[];
  truncated: Truncation[];
};

type Row = Record<string, unknown>;
type Answer = { data: unknown; error: { code?: string; message?: string } | null };

/** Rows of a list read, dropping any this build can't map. */
function mapRows<T>(rows: unknown, mapOne: (row: unknown) => T): T[] {
  if (!Array.isArray(rows)) return [];
  const out: T[] = [];
  for (const row of rows) {
    try {
      out.push(mapOne(row));
    } catch {
      /* a row this build can't read is left out, never thrown */
    }
  }
  return out;
}

function one<T>(data: unknown, mapOne: (row: unknown) => T): T {
  return mapOne(Array.isArray(data) ? data[0] : data);
}

function fail(error: { message?: string }): never {
  throw new Error(error.message ?? "That didn't save.");
}

const PROJECT_KEYS: Record<keyof ProjectFields, string> = {
  name: "name",
  status: "status",
  startsOn: "starts_on",
  targetOn: "target_on",
  leadId: "lead_id",
  clientContactId: "client_contact_id",
  areaId: "area_id",
  position: "position",
};

/** Project fields as the ops take them (snake_case, only the keys given). */
export function projectFieldsToOp(fields: ProjectFields): Row {
  const out: Row = {};
  for (const [key, column] of Object.entries(PROJECT_KEYS)) {
    const value = fields[key as keyof ProjectFields];
    if (value !== undefined) out[column] = value;
  }
  return out;
}

/** A delete flag as the ops take it: any time deletes, null restores. */
function deletedAtOf(deleted: boolean | undefined): Row {
  return deleted === undefined ? {} : { deleted_at: deleted ? new Date().toISOString() : null };
}

/** One table's list read: what it's called, its cap and its order. */
type LiveRead<T> = {
  table: string;
  scope: string;
  cap: number;
  order: string;
  map: (row: unknown) => T;
};

const READS = {
  areas: {
    table: "areas",
    scope: "areas",
    cap: READ_CAPS.areas,
    order: "position",
    map: areaRowToModel,
  },
  sections: {
    table: "sections",
    scope: "sections",
    cap: READ_CAPS.sections,
    order: "position",
    map: sectionRowToModel,
  },
  teams: {
    table: "teams",
    scope: "teams",
    cap: READ_CAPS.teams,
    order: "name",
    map: teamRowToModel,
  },
  teamMembers: {
    table: "team_members",
    scope: "team members",
    cap: READ_CAPS.teamMembers,
    order: "created_at",
    map: teamMemberRowToModel,
  },
  sessions: {
    table: "task_sessions",
    scope: "work sessions",
    cap: READ_CAPS.taskSessions,
    order: "starts_at",
    map: taskSessionRowToModel,
  },
  reminders: {
    table: "task_reminders",
    scope: "reminders",
    cap: READ_CAPS.taskReminders,
    order: "created_at",
    map: taskReminderRowToModel,
  },
  waiting: {
    table: "task_waiting",
    scope: "waiting entries",
    cap: READ_CAPS.taskWaiting,
    order: "since",
    map: taskWaitingRowToModel,
  },
} satisfies Record<string, LiveRead<unknown>>;

export function createTasksStructure(
  client: SupabaseClient,
  deps: {
    /** The signed-in user's id (time blocks are per person). */
    userId: () => Promise<string | null>;
    /** The pre-TV-D10 project save (raw), for a database before it. */
    upsertBucketLegacy: (bucket: Bucket) => Promise<Bucket>;
    /** The pre-TV-D10 workspace time blocks (raw), for a database before it. */
    getTimeBlocksLegacy: (workspaceId: string) => Promise<TimeBlockMap>;
    setTimeBlocksLegacy: (workspaceId: string, blocks: TimeBlockMap) => Promise<TimeBlockMap>;
  },
) {
  /** Every live row of a workspace table, up to its cap, in a stable order. */
  async function listLive<T>(
    read: LiveRead<T>,
    workspaceId: string,
  ): Promise<{ rows: T[]; truncation: Truncation | null }> {
    const build = (opts?: { count: "exact"; head: true }) =>
      client
        .from(read.table)
        .select("*", opts)
        .eq("workspace_id", workspaceId)
        .is("deleted_at", null);
    const res = await readPaged<Row, Answer["error"]>({
      scope: read.scope,
      cap: read.cap,
      page: async (offset, limit) => {
        const { data, error } = await build()
          .order(read.order)
          .order("id")
          .range(offset, offset + limit - 1);
        return { data: (data ?? null) as Row[] | null, error };
      },
      countTotal: async () => {
        const { count, error } = await build({ count: "exact", head: true });
        return error ? null : (count ?? null);
      },
      keyOf: (row) => String(row?.id),
    });
    if (res.error) {
      // A database before TV-D10 has no such table: nothing to show.
      if (isMissingTableError(res.error, read.table)) return { rows: [], truncation: null };
      fail(res.error);
    }
    return { rows: mapRows(res.rows, read.map), truncation: res.truncation };
  }

  async function rpc(fn: string, args: Row): Promise<Answer> {
    const { data, error } = await client.rpc(fn, args);
    return { data, error };
  }

  async function rpcRows<T>(fn: string, args: Row, map: (row: unknown) => T): Promise<T[]> {
    const res = await rpc(fn, args);
    if (res.error) fail(res.error);
    return mapRows(res.data, map);
  }

  async function rpcOne<T>(fn: string, args: Row, map: (row: unknown) => T): Promise<T> {
    const res = await rpc(fn, args);
    if (res.error) fail(res.error);
    return one(res.data, map);
  }

  const api = {
    // ── Reads ────────────────────────────────────────────────────────────────

    async listAreas(workspaceId: string): Promise<Area[]> {
      return (await listLive(READS.areas, workspaceId)).rows;
    },

    /** Every live section of every project the reader can see. */
    async listSections(workspaceId: string): Promise<Section[]> {
      return (await listLive(READS.sections, workspaceId)).rows;
    },

    async listTeams(workspaceId: string): Promise<{ teams: Team[]; members: TeamMember[] }> {
      const [teams, members] = await Promise.all([
        listLive(READS.teams, workspaceId),
        listLive(READS.teamMembers, workspaceId),
      ]);
      return { teams: teams.rows, members: members.rows };
    },

    /** Areas, sections, teams and members in one go (the Tasks bundle). */
    async listStructure(workspaceId: string): Promise<TasksStructure> {
      const [areas, sections, teams, members] = await Promise.all([
        listLive(READS.areas, workspaceId),
        listLive(READS.sections, workspaceId),
        listLive(READS.teams, workspaceId),
        listLive(READS.teamMembers, workspaceId),
      ]);
      return {
        areas: areas.rows,
        sections: sections.rows,
        teams: teams.rows,
        teamMembers: members.rows,
        truncated: collectTruncations(
          areas.truncation,
          sections.truncation,
          teams.truncation,
          members.truncation,
        ),
      };
    },

    /** Every live work session on a task the reader can see. */
    async listSessions(
      workspaceId: string,
    ): Promise<{ sessions: TaskSession[]; truncated: Truncation[] }> {
      const res = await listLive(READS.sessions, workspaceId);
      return { sessions: res.rows, truncated: collectTruncations(res.truncation) };
    },

    /** The reader's own live reminders (nobody reads anyone else's). */
    async listReminders(
      workspaceId: string,
    ): Promise<{ reminders: TaskReminder[]; truncated: Truncation[] }> {
      const res = await listLive(READS.reminders, workspaceId);
      return { reminders: res.rows, truncated: collectTruncations(res.truncation) };
    },

    /** Every live Waiting on… entry on a task the reader can see. */
    async listWaiting(
      workspaceId: string,
    ): Promise<{ waiting: TaskWaitingEntry[]; truncated: Truncation[] }> {
      const res = await listLive(READS.waiting, workspaceId);
      return { waiting: res.rows, truncated: collectTruncations(res.truncation) };
    },

    // ── Areas ────────────────────────────────────────────────────────────────

    /** Add an area at the end of the sidebar; answers with every area you can see. */
    createArea(input: { workspaceId: string; name: string; color?: string | null }) {
      return rpcRows(
        "areas_op_create",
        { p_workspace_id: input.workspaceId, p_name: input.name, p_color: input.color ?? null },
        areaRowToModel,
      );
    },

    /** Rename, recolour, delete (its projects become area-less) or restore. */
    updateArea(input: {
      workspaceId: string;
      areaId: string;
      patch: { name?: string; color?: string | null; deleted?: boolean };
    }) {
      const { deleted, ...rest } = input.patch;
      return rpcRows(
        "areas_op_update",
        {
          p_workspace_id: input.workspaceId,
          p_area_id: input.areaId,
          p_patch: { ...rest, ...deletedAtOf(deleted) },
        },
        areaRowToModel,
      );
    },

    /** Move an area right after another (first when `afterAreaId` is null). */
    moveArea(input: { workspaceId: string; areaId: string; afterAreaId: string | null }) {
      return rpcRows(
        "areas_op_move",
        { p_workspace_id: input.workspaceId, p_area_id: input.areaId, p_after: input.afterAreaId },
        areaRowToModel,
      );
    },

    // ── Projects ("buckets" in the schema until TV-D7) ───────────────────────

    /**
     * Make a project (you own it). `id` makes a resend idempotent. Before
     * TV-D10's migration it saves the old way (name, place and section).
     */
    async createProject(input: {
      workspaceId: string;
      id?: string;
      fields: ProjectFields & { name: string };
      /** For the old save: the rail section to file it under. */
      group?: string | null;
    }): Promise<Bucket> {
      const res = await rpc("projects_op_create", {
        p_workspace_id: input.workspaceId,
        p_project: { ...(input.id ? { id: input.id } : {}), ...projectFieldsToOp(input.fields) },
      });
      if (!res.error) return one(res.data, bucketRowToModel);
      if (!isMissingFunctionError(res.error, "projects_op_create")) fail(res.error);
      const now = new Date().toISOString();
      return deps.upsertBucketLegacy({
        id: input.id ?? "",
        workspaceId: input.workspaceId,
        ownerId: "",
        name: input.fields.name,
        isSystem: false,
        group: input.group ?? null,
        position: input.fields.position ?? "",
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      });
    },

    /**
     * Edit a project's fields (only those given). Before TV-D10's migration a
     * rename or a new place still saves, from `fallback` (the project as the
     * app has it); the other fields need the migration.
     */
    async updateProject(input: {
      workspaceId: string;
      projectId: string;
      patch: ProjectFields;
      fallback?: Bucket;
    }): Promise<Bucket> {
      const res = await rpc("projects_op_update", {
        p_workspace_id: input.workspaceId,
        p_project_id: input.projectId,
        p_patch: projectFieldsToOp(input.patch),
      });
      if (!res.error) return one(res.data, bucketRowToModel);
      if (!isMissingFunctionError(res.error, "projects_op_update") || !input.fallback)
        fail(res.error);
      return deps.upsertBucketLegacy({
        ...input.fallback,
        name: input.patch.name ?? input.fallback.name,
        position: input.patch.position ?? input.fallback.position,
      });
    },

    /** Move a project into an area (null: none) and, with a position, to a new place. */
    moveProject(input: {
      workspaceId: string;
      projectId: string;
      areaId: string | null;
      position?: string | null;
    }) {
      return rpcOne(
        "projects_op_move",
        {
          p_workspace_id: input.workspaceId,
          p_project_id: input.projectId,
          p_area_id: input.areaId,
          p_position: input.position ?? null,
        },
        bucketRowToModel,
      );
    },

    /**
     * File a project under an area by name (the rail's "Section" menu): the
     * server finds the area of that name or makes it (`areas_op_ensure`, so a
     * stale list here never makes a second one); null takes it out. Answers
     * with the project and `areas` with that area in it. Before TV-D10's
     * migration it writes the old label.
     */
    async setProjectArea(input: {
      workspaceId: string;
      project: Bucket;
      areaName: string | null;
      areas: Area[];
    }): Promise<{ project: Bucket; areas: Area[] | null }> {
      const name = input.areaName?.trim() || null;
      let area: Area | null = null;
      if (name) {
        const ensured = await rpc("areas_op_ensure", {
          p_workspace_id: input.workspaceId,
          p_name: name,
        });
        if (ensured.error) {
          if (isMissingFunctionError(ensured.error, "areas_op_ensure")) {
            return {
              project: await deps.upsertBucketLegacy({ ...input.project, group: name }),
              areas: null,
            };
          }
          fail(ensured.error);
        }
        area = one(ensured.data, areaRowToModel);
      }
      const moved = await rpc("projects_op_move", {
        p_workspace_id: input.workspaceId,
        p_project_id: input.project.id,
        p_area_id: area?.id ?? null,
        p_position: null,
      });
      if (moved.error) {
        if (!isMissingFunctionError(moved.error, "projects_op_move")) fail(moved.error);
        return {
          project: await deps.upsertBucketLegacy({ ...input.project, group: name }),
          areas: null,
        };
      }
      const areas =
        area && !input.areas.some((a) => a.id === area.id)
          ? [...input.areas, area].sort((a, b) => a.position - b.position)
          : null;
      return { project: one(moved.data, bucketRowToModel), areas };
    },

    // ── Sections ─────────────────────────────────────────────────────────────

    /** Add a section (`after`: the one to follow, null for first, absent for last). */
    createSection(input: {
      workspaceId: string;
      projectId: string;
      id?: string;
      fields: SectionFields & { name: string };
      after?: string | null;
    }) {
      const section: Row = {
        ...(input.id ? { id: input.id } : {}),
        name: input.fields.name,
        ...(input.fields.startsOn !== undefined ? { starts_on: input.fields.startsOn } : {}),
        ...(input.fields.endsOn !== undefined ? { ends_on: input.fields.endsOn } : {}),
        ...(input.after !== undefined ? { after: input.after } : {}),
      };
      return rpcRows(
        "sections_op_create",
        { p_workspace_id: input.workspaceId, p_project_id: input.projectId, p_section: section },
        sectionRowToModel,
      );
    },

    /** Rename, re-date, delete (its tasks go to "No section") or restore. */
    updateSection(input: {
      workspaceId: string;
      sectionId: string;
      patch: SectionFields & { deleted?: boolean };
    }) {
      const { deleted, name, startsOn, endsOn } = input.patch;
      const patch: Row = {
        ...(name !== undefined ? { name } : {}),
        ...(startsOn !== undefined ? { starts_on: startsOn } : {}),
        ...(endsOn !== undefined ? { ends_on: endsOn } : {}),
        ...deletedAtOf(deleted),
      };
      return rpcRows(
        "sections_op_update",
        { p_workspace_id: input.workspaceId, p_section_id: input.sectionId, p_patch: patch },
        sectionRowToModel,
      );
    },

    moveSection(input: { workspaceId: string; sectionId: string; afterSectionId: string | null }) {
      return rpcRows(
        "sections_op_move",
        {
          p_workspace_id: input.workspaceId,
          p_section_id: input.sectionId,
          p_after: input.afterSectionId,
        },
        sectionRowToModel,
      );
    },

    // ── Teams ────────────────────────────────────────────────────────────────

    createTeam(input: {
      workspaceId: string;
      id?: string;
      fields: TeamFields & { name: string };
      members?: string[];
    }) {
      const team: Row = {
        ...(input.id ? { id: input.id } : {}),
        name: input.fields.name,
        ...(input.fields.mark !== undefined ? { mark: input.fields.mark } : {}),
        ...(input.fields.color !== undefined ? { color: input.fields.color } : {}),
        ...(input.fields.defaultProjectId !== undefined
          ? { default_project_id: input.fields.defaultProjectId }
          : {}),
        ...(input.members ? { members: input.members } : {}),
      };
      return rpcOne(
        "teams_op_create",
        { p_workspace_id: input.workspaceId, p_team: team },
        teamRowToModel,
      );
    },

    /** Rename, re-mark, recolour, set the default project, delete or restore. */
    updateTeam(input: {
      workspaceId: string;
      teamId: string;
      patch: TeamFields & { deleted?: boolean };
    }) {
      const { deleted, name, mark, color, defaultProjectId } = input.patch;
      const patch: Row = {
        ...(name !== undefined ? { name } : {}),
        ...(mark !== undefined ? { mark } : {}),
        ...(color !== undefined ? { color } : {}),
        ...(defaultProjectId !== undefined ? { default_project_id: defaultProjectId } : {}),
        ...deletedAtOf(deleted),
      };
      return rpcOne(
        "teams_op_update",
        { p_workspace_id: input.workspaceId, p_team_id: input.teamId, p_patch: patch },
        teamRowToModel,
      );
    },

    addTeamMember(input: { workspaceId: string; teamId: string; userId: string }) {
      return rpcRows(
        "teams_op_add_member",
        { p_workspace_id: input.workspaceId, p_team_id: input.teamId, p_user_id: input.userId },
        teamMemberRowToModel,
      );
    },

    removeTeamMember(input: { workspaceId: string; teamId: string; userId: string }) {
      return rpcRows(
        "teams_op_remove_member",
        { p_workspace_id: input.workspaceId, p_team_id: input.teamId, p_user_id: input.userId },
        teamMemberRowToModel,
      );
    },

    // ── Work sessions ────────────────────────────────────────────────────────

    /** Schedule a session; answers with the task's sessions in time order. */
    addSession(input: {
      workspaceId: string;
      taskId: string;
      id?: string;
      startsAt: string;
      endsAt: string;
      userId?: string;
    }) {
      return rpcRows(
        "tasks_op_session_add",
        {
          p_workspace_id: input.workspaceId,
          p_task_id: input.taskId,
          p_session: {
            ...(input.id ? { id: input.id } : {}),
            starts_at: input.startsAt,
            ends_at: input.endsAt,
            ...(input.userId ? { user_id: input.userId } : {}),
          },
        },
        taskSessionRowToModel,
      );
    },

    updateSession(input: {
      workspaceId: string;
      sessionId: string;
      patch: { startsAt?: string; endsAt?: string; userId?: string };
    }) {
      const { startsAt, endsAt, userId } = input.patch;
      return rpcRows(
        "tasks_op_session_update",
        {
          p_workspace_id: input.workspaceId,
          p_session_id: input.sessionId,
          p_patch: {
            ...(startsAt !== undefined ? { starts_at: startsAt } : {}),
            ...(endsAt !== undefined ? { ends_at: endsAt } : {}),
            ...(userId !== undefined ? { user_id: userId } : {}),
          },
        },
        taskSessionRowToModel,
      );
    },

    removeSession(input: { workspaceId: string; sessionId: string }) {
      return rpcRows(
        "tasks_op_session_remove",
        { p_workspace_id: input.workspaceId, p_session_id: input.sessionId },
        taskSessionRowToModel,
      );
    },

    // ── Reminders (each person's own) ────────────────────────────────────────

    addReminder(input: {
      workspaceId: string;
      taskId: string;
      kind: TaskReminderKind;
      at?: string | null;
    }) {
      return rpcRows(
        "tasks_op_reminder_add",
        {
          p_workspace_id: input.workspaceId,
          p_task_id: input.taskId,
          p_kind: input.kind,
          p_at: input.at ?? null,
        },
        taskReminderRowToModel,
      );
    },

    removeReminder(input: { workspaceId: string; reminderId: string }) {
      return rpcRows(
        "tasks_op_reminder_remove",
        { p_workspace_id: input.workspaceId, p_reminder_id: input.reminderId },
        taskReminderRowToModel,
      );
    },

    // ── Waiting on… ──────────────────────────────────────────────────────────

    addWaiting(input: {
      workspaceId: string;
      taskId: string;
      id?: string;
      kind: TaskWaitingKind;
      /** The person, email thread or API key; none for text. */
      ref?: string | null;
      /** What a text entry waits on. */
      label?: string | null;
      since?: string | null;
    }) {
      const entry: Row = {
        ...(input.id ? { id: input.id } : {}),
        kind: input.kind,
        ...(input.ref ? { ref: input.ref } : {}),
        ...(input.label ? { label: input.label } : {}),
        ...(input.since ? { since: input.since } : {}),
      };
      return rpcRows(
        "tasks_op_waiting_add",
        { p_workspace_id: input.workspaceId, p_task_id: input.taskId, p_entry: entry },
        taskWaitingRowToModel,
      );
    },

    removeWaiting(input: { workspaceId: string; entryId: string }) {
      return rpcRows(
        "tasks_op_waiting_remove",
        { p_workspace_id: input.workspaceId, p_entry_id: input.entryId },
        taskWaitingRowToModel,
      );
    },

    // ── Time blocks (each person's own since TV-D10) ─────────────────────────

    async getTimeBlocks(workspaceId: string): Promise<TimeBlockMap> {
      const userId = await deps.userId();
      if (!userId) return {};
      const { data, error } = await client
        .from("user_preferences")
        .select("task_time_blocks")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) {
        if (isMissingColumnError(error, "task_time_blocks")) {
          return deps.getTimeBlocksLegacy(workspaceId);
        }
        fail(error);
      }
      const all = (data as { task_time_blocks?: unknown } | null)?.task_time_blocks;
      const mine =
        all && typeof all === "object" ? (all as Record<string, unknown>)[workspaceId] : undefined;
      return sanitizeTimeBlocks(mine);
    },

    async setTimeBlocks(workspaceId: string, blocks: TimeBlockMap): Promise<TimeBlockMap> {
      const res = await rpc("tasks_op_set_time_blocks", {
        p_workspace_id: workspaceId,
        p_blocks: sanitizeTimeBlocks(blocks),
      });
      if (!res.error) return sanitizeTimeBlocks(res.data);
      if (!isMissingFunctionError(res.error, "tasks_op_set_time_blocks")) fail(res.error);
      return deps.setTimeBlocksLegacy(workspaceId, blocks);
    },
  };
  return api;
}

export type TasksStructureApi = ReturnType<typeof createTasksStructure>;
