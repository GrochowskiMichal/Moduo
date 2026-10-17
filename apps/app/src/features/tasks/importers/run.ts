// Writing a plan through the import engine (TV-U18; TV-D16's engine, the
// same one MCP imports use — never a parallel one): `imports_op_begin` →
// the run's projects and sections (`imports_op_project_create` /
// `_section_create`, recorded for Undo) → the statuses a project needs →
// each task through `tasks_op_create_with` with its key and tags →
// comments → `imports_op_finish`. Every write is an op under the person's own
// rights; what the server refuses is counted, never named as made.
//
// Re-running the same file finds what the last run made (your own live tasks
// with those keys) and updates them in place: their words, dates, priority,
// estimate and repeat from the file, tags added. Where a task lives (project,
// section, parent) and its status, assignee and comments stay as they are in
// Moduo (agent's choice, TV-U18-4). Nothing is ever duplicated.
//
// Plain functions over a small API, so tests drive them with a fake.

import type { TaskStatusCategory } from "@contracts/vocabularies";
import { taskStatusWord } from "@contracts/vocabularies";
import { formatFullDate } from "../../../lib/time-format";
import { positionsAfter } from "../helpers";
import type { ProjectStatus, Section, Task } from "../model";
import {
  categoryFromName,
  type ImportPlan,
  type PlanComment,
  type PlanTask,
  personKey,
  sourceLabel,
} from "./plan";

/** What the run needs from the runtime (`runtime.tasks` and `runtime.spine`). */
export type ImportApi = {
  beginImport(input: {
    workspaceId: string;
    source: string;
    label: string;
  }): Promise<{ id: string }>;
  createImportProject(input: {
    workspaceId: string;
    importId: string;
    project: { id: string; name: string; description?: string };
  }): Promise<{ id: string; name: string }>;
  createImportSection(input: {
    workspaceId: string;
    importId: string;
    projectId: string;
    section: { id: string; name: string };
  }): Promise<{ id: string }>;
  createImportTask(input: {
    workspaceId: string;
    importId: string;
    task: Record<string, unknown>;
    tags?: string[];
  }): Promise<{ action: "created" | "updated" | "existing"; id: string }>;
  finishImport(input: { workspaceId: string; importId: string }): Promise<{
    tasksCreated: number;
    tasksUpdated: number;
    projectsCreated: number;
    sectionsCreated: number;
  }>;
  listStatuses(workspaceId: string): Promise<ProjectStatus[]>;
  createStatus(input: {
    workspaceId: string;
    projectId: string;
    category: TaskStatusCategory;
    name: string;
  }): Promise<ProjectStatus[]>;
  addComment(input: {
    workspaceId: string;
    entityType: "task";
    entityId: string;
    body: string;
  }): Promise<unknown>;
};

/** What's already in the workspace, from the shared store. */
export type ImportContext = {
  workspaceId: string;
  userId: string;
  /** Live projects you can add tasks to (archived ones left out). */
  projects: ReadonlyArray<{ id: string; name: string }>;
  sections: ReadonlyArray<Section>;
  tasks: ReadonlyArray<
    Pick<Task, "id" | "bucketId" | "parentId" | "position" | "creatorId" | "importedFrom"> & {
      sectionId?: string | null;
    }
  >;
};

export type ProjectTarget =
  | { kind: "new" }
  /** A re-run: the project the last run's tasks are in. */
  | { kind: "existing"; projectId: string; name: string };

export type ResolvedPlan = {
  plan: ImportPlan;
  targets: ProjectTarget[];
  /** Plan key → your live task with that key (a re-run updates it). */
  existing: ReadonlyMap<string, ExistingTask>;
  counts: {
    newTasks: number;
    updatedTasks: number;
    newProjects: number;
    /** Tasks with no assignee in the export. */
    nobodyOnIt: number;
  };
};

type ExistingTask = { id: string; bucketId: string; sectionId: string | null };

/** How the plan meets what's there: which tasks are new, which projects reused. */
export function resolvePlan(plan: ImportPlan, ctx: ImportContext): ResolvedPlan {
  const projectIds = new Set(ctx.projects.map((p) => p.id));
  const mine = new Map<string, ExistingTask>();
  for (const t of ctx.tasks) {
    if (t.creatorId !== ctx.userId || t.importedFrom?.source !== plan.source) continue;
    mine.set(t.importedFrom.key, {
      id: t.id,
      bucketId: t.bucketId,
      sectionId: t.sectionId ?? null,
    });
  }
  const existing = new Map<string, ExistingTask>();
  const targets: ProjectTarget[] = [];
  let newTasks = 0;
  let updatedTasks = 0;
  let nobody = 0;
  for (const project of plan.projects) {
    const tally = new Map<string, number>();
    for (const t of project.tasks) {
      const found = mine.get(t.key);
      if (found) {
        existing.set(t.key, found);
        updatedTasks += 1;
        if (projectIds.has(found.bucketId))
          tally.set(found.bucketId, (tally.get(found.bucketId) ?? 0) + 1);
      } else {
        newTasks += 1;
        // Only a new task takes an assignee (a re-run keeps who's on it).
        if (!t.assignee) nobody += 1;
      }
    }
    const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
    const reused = best ? ctx.projects.find((p) => p.id === best[0]) : undefined;
    targets.push(
      reused ? { kind: "existing", projectId: reused.id, name: reused.name } : { kind: "new" },
    );
  }
  return {
    plan,
    targets,
    existing,
    counts: {
      newTasks,
      updatedTasks,
      newProjects: targets.filter((t) => t.kind === "new").length,
      nobodyOnIt: nobody,
    },
  };
}

export type RunOptions = {
  /** Tasks nobody is on in the export go to you (else they stay unassigned). */
  assignNobodyToMe: boolean;
  /** Each person the file names (`personKey`) → the member picked, or null (Unassigned). */
  assigneeOf: ReadonlyMap<string, string | null>;
  onProgress?: (done: number, total: number) => void;
  /** Stop between tasks (what's done stays, and can be undone). */
  signal?: AbortSignal;
  newId?: () => string;
  now?: Date;
};

export type ImportOutcome =
  | { ok: false; message: string }
  | {
      ok: true;
      importId: string;
      /** The server's own count of what the run made (what you can see). */
      made: {
        tasksCreated: number;
        tasksUpdated: number;
        projectsCreated: number;
        sectionsCreated: number;
      };
      /** Projects this run made, as the server named them. */
      projects: Array<{ id: string; name: string }>;
      failed: number;
      /** The first refusal, in the server's words. */
      firstError: string | null;
      /** Tasks made without their tags (you can't make tags here). */
      tagsLeftOff: number;
      comments: number;
      commentsFailed: number;
      unassigned: number;
      /**
       * Tasks the app took for new that the server matched to an earlier
       * import of yours (it updated them where they are).
       */
      matchedEarlier: number;
      /** The server's count couldn't be read (the tasks landed; Undo works). */
      countsUnknown: boolean;
      stopped: boolean;
    };

const CONCURRENCY = 6;

/** A tag refusal names tags; the task can still be made without them. */
const isTagRefusal = (message: string) => /\btags?\b/i.test(message);

export function commentBody(c: PlanComment, source: string): string {
  const when = c.on ? formatFullDate(new Date(`${c.on}T12:00:00`)) : null;
  const head = [c.author ?? null, `in ${sourceLabel(source as ImportPlan["source"])}`, when]
    .filter(Boolean)
    .join(" · ");
  return `${head}\n${c.text}`;
}

export async function runImport(
  api: ImportApi,
  resolved: ResolvedPlan,
  ctx: ImportContext,
  opts: RunOptions,
): Promise<ImportOutcome> {
  const { plan } = resolved;
  const ws = ctx.workspaceId;
  const newId = opts.newId ?? (() => crypto.randomUUID());
  let importId: string;
  try {
    importId = (await api.beginImport({ workspaceId: ws, source: plan.source, label: plan.label }))
      .id;
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "The import couldn't start." };
  }

  const total = plan.projects.reduce((n, p) => n + p.tasks.length, 0);
  let done = 0;
  let failed = 0;
  let firstError: string | null = null;
  let tagsLeftOff = 0;
  let comments = 0;
  let commentsFailed = 0;
  let unassigned = 0;
  let matchedEarlier = 0;
  let stopped = false;
  const madeProjects: Array<{ id: string; name: string }> = [];
  const fail = (message: string, count = 1) => {
    failed += count;
    firstError ??= message;
  };
  const tick = () => {
    done += 1;
    opts.onProgress?.(done, total);
  };

  try {
    // Projects: the one a re-run's tasks are in, or a new one.
    const projectIdOf: Array<string | null> = [];
    for (const [i, project] of plan.projects.entries()) {
      const target = resolved.targets[i]!;
      if (target.kind === "existing") {
        projectIdOf.push(target.projectId);
        continue;
      }
      try {
        const made = await api.createImportProject({
          workspaceId: ws,
          importId,
          project: {
            id: newId(),
            name: project.name,
            ...(project.description ? { description: project.description } : {}),
          },
        });
        madeProjects.push(made);
        projectIdOf.push(made.id);
      } catch (e) {
        projectIdOf.push(null);
        fail(e instanceof Error ? e.message : "A project couldn't be made.", project.tasks.length);
        for (const _ of project.tasks) tick();
      }
    }

    // Statuses each project needs, by name; made where missing.
    const statusIdOf = new Map<string, string>(); // `${projectId}␟${lower name}` → id
    if (plan.projects.some((p, i) => p.statuses.length > 0 && projectIdOf[i])) {
      let all: ProjectStatus[] = [];
      try {
        all = await api.listStatuses(ws);
      } catch {
        all = [];
      }
      for (const [i, project] of plan.projects.entries()) {
        const pid = projectIdOf[i];
        if (!pid) continue;
        const own = all.filter((s) => s.projectId === pid);
        for (const s of own) statusIdOf.set(`${pid}␟${s.name.toLowerCase()}`, s.id);
        for (const status of project.statuses) {
          const k = `${pid}␟${status.name.toLowerCase()}`;
          if (statusIdOf.has(k)) continue;
          // A name that is its own category ("Done", "To Do") is that category's first status.
          if (categoryFromName(status.name) === status.category && wordIsCategory(status.name))
            continue;
          try {
            const set = await api.createStatus({
              workspaceId: ws,
              projectId: pid,
              category: status.category,
              name: status.name,
            });
            for (const s of set) statusIdOf.set(`${pid}␟${s.name.toLowerCase()}`, s.id);
          } catch {
            // Its tasks land in the category's first status instead.
          }
        }
      }
    }

    // Sections: one of that name already in the project, else made by the run.
    const sectionIdOf = new Map<string, string>(); // `${projectId}␟${lower name}` → id
    for (const s of ctx.sections) sectionIdOf.set(`${s.projectId}␟${s.name.toLowerCase()}`, s.id);
    for (const [i, project] of plan.projects.entries()) {
      const pid = projectIdOf[i];
      if (!pid) continue;
      for (const name of project.sections) {
        const k = `${pid}␟${name.toLowerCase()}`;
        if (sectionIdOf.has(k)) continue;
        try {
          const made = await api.createImportSection({
            workspaceId: ws,
            importId,
            projectId: pid,
            section: { id: newId(), name },
          });
          sectionIdOf.set(k, made.id);
        } catch {
          // Its tasks land without a section.
        }
      }
    }

    // Tasks: every project's top-level tasks first, then the subtasks.
    const idOfKey = new Map<string, string>();
    const placeOfKey = new Map<string, { bucketId: string; sectionId: string | null }>();
    const failedKeys = new Set<string>();
    type Job = { task: PlanTask; projectId: string; position: string };
    const parents: Job[] = [];
    const children: Job[] = [];
    for (const [i, project] of plan.projects.entries()) {
      const pid = projectIdOf[i];
      if (!pid) continue;
      const positions = positionsAfter(
        project.tasks.length,
        ctx.tasks.filter((t) => t.bucketId === pid).map((t) => t.position),
      );
      project.tasks.forEach((task, n) => {
        (task.parentKey ? children : parents).push({
          task,
          projectId: pid,
          position: positions[n]!,
        });
      });
    }

    const one = async (job: Job) => {
      const { task } = job;
      if (opts.signal?.aborted) {
        stopped = true;
        return;
      }
      const prior = resolved.existing.get(task.key);
      const parentId = task.parentKey ? idOfKey.get(task.parentKey) : null;
      if (task.parentKey && (!parentId || failedKeys.has(task.parentKey))) {
        failedKeys.add(task.key);
        fail("A subtask's parent couldn't be imported.");
        tick();
        return;
      }
      const imported = { source: plan.source, key: task.key };
      let payload: Record<string, unknown>;
      if (prior) {
        // A re-run: the file's words and dates; the task stays where it is.
        payload = { title: task.title, description: task.description, imported_from: imported };
        if (task.dueOn) payload.due_on = task.dueOn;
        if (task.dueTime) payload.due_time = task.dueTime;
        if (task.recurrence) payload.recurrence = task.recurrence;
        if (task.priority) payload.priority = task.priority;
        if (task.estimateMinutes) payload.estimate_minutes = task.estimateMinutes;
      } else {
        const parentPlace = task.parentKey ? placeOfKey.get(task.parentKey) : null;
        const bucketId = parentPlace?.bucketId ?? job.projectId;
        const sectionId = parentPlace
          ? parentPlace.sectionId
          : task.section
            ? (sectionIdOf.get(`${bucketId}␟${task.section.toLowerCase()}`) ?? null)
            : null;
        const statusId = task.status
          ? statusIdOf.get(`${bucketId}␟${task.status.toLowerCase()}`)
          : undefined;
        payload = {
          id: newId(),
          title: task.title,
          description: task.description,
          bucket_id: bucketId,
          position: job.position,
          imported_from: imported,
        };
        if (statusId) payload.status_id = statusId;
        else payload.status = taskStatusWord(task.category);
        if (sectionId) payload.section_id = sectionId;
        if (parentId) payload.parent_id = parentId;
        if (task.dueOn) payload.due_on = task.dueOn;
        if (task.dueTime) payload.due_time = task.dueTime;
        if (task.recurrence) payload.recurrence = task.recurrence;
        if (task.priority) payload.priority = task.priority;
        if (task.estimateMinutes) payload.estimate_minutes = task.estimateMinutes;
        // The person the importer picked for the file's name or email (the
        // preview's suggestion, from what the member list already shows).
        const member = task.assignee ? opts.assigneeOf.get(personKey(task.assignee)) : null;
        if (member) payload.assignee_id = member;
        else if (!task.assignee && opts.assignNobodyToMe) payload.assignee_id = ctx.userId;
        else {
          payload.assignee_id = null;
          unassigned += 1;
        }
      }
      // A teammate on a task with comments is assigned after the comments,
      // in the run's re-send: each comment would otherwise be a notice to
      // them, and the assignment then groups like any other.
      const assignAfter =
        !prior &&
        task.comments.length > 0 &&
        typeof payload.assignee_id === "string" &&
        payload.assignee_id !== ctx.userId
          ? (payload.assignee_id as string)
          : null;
      if (assignAfter) payload.assignee_id = null;
      let answer: { action: string; id: string };
      try {
        answer = await api.createImportTask({
          workspaceId: ws,
          importId,
          task: payload,
          tags: task.tags,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "A task couldn't be imported.";
        if (task.tags.length && isTagRefusal(message)) {
          try {
            answer = await api.createImportTask({ workspaceId: ws, importId, task: payload });
            tagsLeftOff += 1;
          } catch (e2) {
            failedKeys.add(task.key);
            fail(e2 instanceof Error ? e2.message : message);
            tick();
            return;
          }
        } else {
          failedKeys.add(task.key);
          fail(message);
          tick();
          return;
        }
      }
      idOfKey.set(task.key, answer.id);
      placeOfKey.set(task.key, {
        bucketId: prior ? prior.bucketId : String(payload.bucket_id),
        sectionId: prior ? prior.sectionId : ((payload.section_id as string | undefined) ?? null),
      });
      // The app took it for new, but the server found an earlier import of
      // yours with this key (one the app hadn't read) and updated that.
      if (!prior && answer.action === "updated") matchedEarlier += 1;
      // Comments on a task this run made, then the task once more by key (with
      // its teammate, if any), so the run's own comments don't count as a
      // change made after it (Undo).
      if (answer.action === "created" && task.comments.length) {
        let added = 0;
        for (const c of task.comments) {
          try {
            await api.addComment({
              workspaceId: ws,
              entityType: "task",
              entityId: answer.id,
              body: commentBody(c, plan.source),
            });
            added += 1;
          } catch {
            commentsFailed += 1;
          }
        }
        comments += added;
        if (added > 0 || assignAfter) {
          try {
            await api.createImportTask({
              workspaceId: ws,
              importId,
              task: {
                title: task.title,
                imported_from: imported,
                ...(assignAfter ? { assignee_id: assignAfter } : {}),
              },
            });
          } catch {
            // The task stays; Undo would then keep it as changed.
            if (assignAfter) unassigned += 1;
          }
        }
      }
      tick();
    };

    await pool(parents, one);
    await pool(children, one);
  } catch (e) {
    // Something past a single task failed: finish anyway, so what landed can be undone.
    fail(e instanceof Error ? e.message : "The import stopped part way.", 0);
  }

  let made = { tasksCreated: 0, tasksUpdated: 0, projectsCreated: 0, sectionsCreated: 0 };
  let countsUnknown = false;
  try {
    made = await api.finishImport({ workspaceId: ws, importId });
  } catch {
    // The run stays open; what landed is still in it and Undo still works.
    countsUnknown = true;
  }
  return {
    ok: true,
    importId,
    made,
    projects: madeProjects,
    failed,
    firstError,
    tagsLeftOff,
    comments,
    commentsFailed,
    unassigned,
    matchedEarlier,
    countsUnknown,
    stopped: stopped || Boolean(opts.signal?.aborted),
  };
}

/** A status name that is a category word ("To Do", "Done", "Backlog"). */
function wordIsCategory(name: string): boolean {
  const n = name.toLowerCase().replace(/[\s'’_-]+/g, "");
  return ["backlog", "todo", "inprogress", "done", "wontdo"].includes(n);
}

async function pool<T>(items: T[], work: (item: T) => Promise<void>) {
  let next = 0;
  const runners = Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await work(item);
    }
  });
  await Promise.all(runners);
}
