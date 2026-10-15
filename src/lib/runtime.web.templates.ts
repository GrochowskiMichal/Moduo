// Templates and "Duplicate project…" (TV-D15, specs/tasks-v3.md §15): reads
// under each table's row-level security (your own templates and the ones
// shared with the workspace), every write an op. An apply or a duplicate
// answers with every row it made (the project, its statuses and sections,
// the tasks, their tag links and dependencies), so the shared store settles
// the whole copy in one step.
//
// A database before the migration reads as "no templates", and the writes
// say what's missing instead of failing quietly.

import type { StarterTemplate } from "@contracts/vocabularies";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Bucket,
  ProjectStatus,
  Section,
  TagLink,
  Task,
  TaskRelation,
} from "../features/tasks/model";
import {
  type Template,
  type TemplateKind,
  type TemplatePatchable,
  type TemplateWithBody,
  templateBodyOf,
  templateFromRow,
} from "../features/tasks/templates/model";
import type { Truncation } from "./paged-select";
import { isMissingFunctionError, isMissingTableError } from "./task-rows";

/** Everything an apply or a duplicate made, as the store's rows. */
export type TemplateApplyResult = {
  buckets: Bucket[];
  statuses: ProjectStatus[];
  sections: Section[];
  tasks: Task[];
  tagLinks: TagLink[];
  relations: TaskRelation[];
};

export type TemplatePatch = TemplatePatchable;

export type ApplyTaskTemplateInput = {
  workspaceId: string;
  templateId: string;
  /** The new task's id, minted by the app: a resend makes nothing twice. */
  id: string;
  /** Instead of the template's title. */
  title?: string;
  /** Where it goes; omitted = the template's project when you can add tasks there, else your Inbox. null = your Inbox. */
  projectId?: string | null;
  sectionId?: string | null;
  /** YYYY-MM-DD the template's offsets count from; null or omitted = no dates. */
  date?: string | null;
  /** Who the task itself goes to; omitted = the template's. Subtasks keep theirs. */
  assigneeId?: string | null;
};

export type ProjectCopyInput = {
  workspaceId: string;
  /** The new project's id, minted by the app: a resend makes nothing twice. */
  id: string;
  name?: string;
  /** YYYY-MM-DD the copy starts on; null = no dates. */
  startsOn?: string | null;
  areaId?: string | null;
  /** Keep who's assigned (people who can take tasks here). Default true. */
  keepPeople?: boolean;
};

const TEMPLATE_COLUMNS =
  "id,workspace_id,owner_id,name,shared,private_source,shareable,summary,created_at,updated_at,deleted_at";
const TABLE: Record<TemplateKind, string> = {
  task: "task_templates",
  project: "project_templates",
};
/** Each list's ceiling (nobody keeps more; a cut list still works). */
const LIST_CAP = 500;

type Answer = { data: unknown; error: { code?: string; message?: string } | null };

function fail(error: { code?: string; message?: string }, fn: string, what: string): never {
  if (isMissingFunctionError(error, fn)) {
    throw new Error(`${what} needs a newer server. Try again after the update.`);
  }
  throw new Error(error.message ?? "That didn't save.");
}

function projectCopyFields(input: Omit<ProjectCopyInput, "workspaceId">): Record<string, unknown> {
  const out: Record<string, unknown> = { id: input.id };
  if (input.name?.trim()) out.name = input.name.trim();
  if (input.startsOn !== undefined) out.starts_on = input.startsOn;
  if (input.areaId !== undefined) out.area_id = input.areaId;
  if (input.keepPeople !== undefined) out.keep_people = input.keepPeople;
  return out;
}

export function applyTaskTemplateFields(
  input: Omit<ApplyTaskTemplateInput, "workspaceId" | "templateId">,
): Record<string, unknown> {
  const out: Record<string, unknown> = { id: input.id };
  if (input.title?.trim()) out.title = input.title.trim();
  if (input.projectId !== undefined) {
    out.project_id = input.projectId;
    out.section_id = input.projectId ? (input.sectionId ?? null) : null;
  }
  if (input.date !== undefined) out.date = input.date;
  if (input.assigneeId !== undefined) out.assignee_id = input.assigneeId;
  return out;
}

export function createTasksTemplates(
  client: SupabaseClient,
  deps: {
    /** The op's answer (raw rows per store table) as the store's rows. */
    mapAnswer: (raw: unknown) => TemplateApplyResult;
  },
) {
  async function listKind(workspaceId: string, kind: TemplateKind): Promise<Template[]> {
    const { data, error } = (await client
      .from(TABLE[kind])
      .select(TEMPLATE_COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("deleted_at", null)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .limit(LIST_CAP)) as Answer;
    if (error) {
      if (isMissingTableError(error, TABLE[kind]) || error.code === "42703") return [];
      throw new Error(error.message ?? "Couldn't read the templates.");
    }
    return (Array.isArray(data) ? data : []).flatMap((row) => {
      const t = templateFromRow(row, kind);
      return t ? [t] : [];
    });
  }

  async function rpc(name: string, args: Record<string, unknown>, what: string): Promise<unknown> {
    const { data, error } = (await client.rpc(name, args)) as Answer;
    if (error) fail(error, name, what);
    return data;
  }

  return {
    /** Your templates and the workspace's shared ones (task and project), by name. */
    async listTemplates(workspaceId: string): Promise<Template[]> {
      const [tasks, projects] = await Promise.all([
        listKind(workspaceId, "task"),
        listKind(workspaceId, "project"),
      ]);
      return [...tasks, ...projects];
    },

    /**
     * Every template you can see, with its body, for the data export
     * (§Assumptions #26): yours and the shared ones. A cut read says so.
     */
    async exportTemplates(
      workspaceId: string,
    ): Promise<{ templates: TemplateWithBody[]; truncated: Truncation[] }> {
      const out: TemplateWithBody[] = [];
      const truncated: Truncation[] = [];
      for (const kind of ["task", "project"] as const) {
        const { data, error } = (await client
          .from(TABLE[kind])
          .select(`${TEMPLATE_COLUMNS},body`)
          .eq("workspace_id", workspaceId)
          .is("deleted_at", null)
          .order("name", { ascending: true })
          .order("id", { ascending: true })
          .limit(LIST_CAP)) as Answer;
        if (error) {
          if (isMissingTableError(error, TABLE[kind])) continue;
          throw new Error(error.message ?? "Couldn't read the templates.");
        }
        const rows = Array.isArray(data) ? data : [];
        if (rows.length >= LIST_CAP) {
          truncated.push({ scope: `${kind} templates`, shown: rows.length, total: null });
        }
        for (const row of rows) {
          const t = templateFromRow(row, kind);
          if (t) out.push({ ...t, body: templateBodyOf((row as { body?: unknown }).body, kind) });
        }
      }
      return { templates: out, truncated };
    },

    /** One template with its body; null when it's gone or not yours to see. */
    async getTemplate(input: {
      workspaceId: string;
      kind: TemplateKind;
      id: string;
    }): Promise<TemplateWithBody | null> {
      const { data, error } = (await client
        .from(TABLE[input.kind])
        .select(`${TEMPLATE_COLUMNS},body`)
        .eq("workspace_id", input.workspaceId)
        .eq("id", input.id)
        .is("deleted_at", null)
        .maybeSingle()) as Answer;
      if (error) {
        if (isMissingTableError(error, TABLE[input.kind])) return null;
        throw new Error(error.message ?? "Couldn't read the template.");
      }
      const t = templateFromRow(data, input.kind);
      if (!t) return null;
      return { ...t, body: templateBodyOf((data as { body?: unknown }).body, input.kind) };
    },

    /**
     * May you copy this project or task (Duplicate, Save as template)? Copying
     * needs Edit on it (D15-11). A server before that rule answers yes (it
     * decides on the copy itself).
     */
    async canCopyTemplateSource(input: { kind: TemplateKind; id: string }): Promise<boolean> {
      const { data, error } = (await client.rpc("templates_can_copy", {
        p_kind: input.kind,
        p_id: input.id,
      })) as Answer;
      if (error) {
        if (isMissingFunctionError(error, "templates_can_copy")) return true;
        throw new Error(error.message ?? "Couldn't check access.");
      }
      return data === true;
    },

    /** "Save as template" on a task: yours, not shared. */
    async saveTaskTemplate(input: {
      workspaceId: string;
      taskId: string;
      id?: string;
      name?: string;
    }): Promise<Template> {
      const fields: Record<string, unknown> = {};
      if (input.id) fields.id = input.id;
      if (input.name?.trim()) fields.name = input.name.trim();
      const data = await rpc(
        "task_templates_op_save",
        { p_workspace_id: input.workspaceId, p_task_id: input.taskId, p_fields: fields },
        "Saving a template",
      );
      const t = templateFromRow(data, "task");
      if (!t) throw new Error("The template saved, but its answer couldn't be read.");
      return t;
    },

    /** "Save as template" on a project: yours, not shared. */
    async saveProjectTemplate(input: {
      workspaceId: string;
      projectId: string;
      id?: string;
      name?: string;
    }): Promise<Template> {
      const fields: Record<string, unknown> = {};
      if (input.id) fields.id = input.id;
      if (input.name?.trim()) fields.name = input.name.trim();
      const data = await rpc(
        "project_templates_op_save",
        { p_workspace_id: input.workspaceId, p_project_id: input.projectId, p_fields: fields },
        "Saving a template",
      );
      const t = templateFromRow(data, "project");
      if (!t) throw new Error("The template saved, but its answer couldn't be read.");
      return t;
    },

    /**
     * A starter template Moduo ships (TV-U17, the role question): the server
     * builds its body from the key. Yours, kept to yourself. `id` is minted by
     * the app, so a resend makes nothing twice.
     */
    async createStarterTemplate(input: {
      workspaceId: string;
      id: string;
      starter: StarterTemplate;
    }): Promise<Template> {
      const data = await rpc(
        "project_templates_op_starter",
        { p_workspace_id: input.workspaceId, p_fields: { id: input.id, starter: input.starter } },
        "Adding a starter template",
      );
      const t = templateFromRow(data, "project");
      if (!t) throw new Error("The template saved, but its answer couldn't be read.");
      return t;
    },

    /** Rename, share or unshare, edit, delete or restore a template. */
    async updateTemplate(input: {
      workspaceId: string;
      kind: TemplateKind;
      id: string;
      patch: TemplatePatch;
    }): Promise<TemplateWithBody> {
      const data = await rpc(
        "templates_op_update",
        {
          p_workspace_id: input.workspaceId,
          p_kind: input.kind,
          p_template_id: input.id,
          p_patch: input.patch,
        },
        "Changing a template",
      );
      const t = templateFromRow(data, input.kind);
      if (!t) throw new Error("The template saved, but its answer couldn't be read.");
      return { ...t, body: templateBodyOf((data as { body?: unknown }).body, input.kind) };
    },

    /** "From template…" for a task: the task and its subtasks, in one op. */
    async applyTaskTemplate(input: ApplyTaskTemplateInput): Promise<TemplateApplyResult> {
      const data = await rpc(
        "task_templates_op_apply",
        {
          p_workspace_id: input.workspaceId,
          p_template_id: input.templateId,
          p_fields: applyTaskTemplateFields(input),
        },
        "Making tasks from a template",
      );
      return deps.mapAnswer(data);
    },

    /** "New project → From template…": the whole project, in one op. */
    async applyProjectTemplate(
      input: ProjectCopyInput & { templateId: string },
    ): Promise<TemplateApplyResult> {
      const data = await rpc(
        "project_templates_op_apply",
        {
          p_workspace_id: input.workspaceId,
          p_template_id: input.templateId,
          p_fields: projectCopyFields(input),
        },
        "Making a project from a template",
      );
      return deps.mapAnswer(data);
    },

    /** "Duplicate project…": the project's statuses, sections and open tasks, dates shifted. */
    async duplicateProject(
      input: ProjectCopyInput & { projectId: string },
    ): Promise<TemplateApplyResult> {
      const data = await rpc(
        "projects_op_duplicate",
        {
          p_workspace_id: input.workspaceId,
          p_project_id: input.projectId,
          p_fields: projectCopyFields(input),
        },
        "Duplicating a project",
      );
      return deps.mapAnswer(data);
    },
  };
}

export type TasksTemplatesApi = ReturnType<typeof createTasksTemplates>;
