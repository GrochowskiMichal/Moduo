// TV-U18: a plan written through the import engine, against a fake API that
// records every call (the SQL tests prove the engine itself:
// supabase/tests/import.test.sql, import_native.test.sql).

import { describe, expect, it } from "@rstest/core";

import type { ProjectStatus } from "../model";
import { choosePlan, type ImportPlan, planTask } from "./plan";
import { type ImportApi, type ImportContext, resolvePlan, runImport } from "./run";

type Call = { op: string; input: Record<string, unknown> };

/** The importer's picks in the preview: Maya is a member, Jan left Unassigned. */
const PICKS = new Map<string, string | null>([
  ["maya@example.com", "maya"],
  ["jan@acme.com", null],
]);

function fakeApi(
  opts: {
    refuse?: (op: string, input: Record<string, unknown>) => string | null;
    /** What the server answers for a task (default: created with an id, else updated). */
    actionOf?: (task: Record<string, unknown>) => "created" | "updated";
  } = {},
) {
  const calls: Call[] = [];
  const statuses: ProjectStatus[] = [];
  let n = 0;
  const seed = (projectId: string) => {
    for (const [category, name] of [
      ["backlog", "Backlog"],
      ["todo", "To do"],
      ["in_progress", "In progress"],
      ["done", "Done"],
      ["wont_do", "Won't do"],
    ] as const) {
      statuses.push({
        id: `st-${projectId}-${name}`,
        workspaceId: "ws",
        projectId,
        category,
        name,
        position: 1,
        hidden: false,
        createdAt: "",
        updatedAt: "",
      });
    }
  };
  const record = async <T>(
    op: string,
    input: Record<string, unknown>,
    answer: () => T,
  ): Promise<T> => {
    calls.push({ op, input });
    const refusal = opts.refuse?.(op, input);
    if (refusal) throw new Error(refusal);
    return answer();
  };
  const api: ImportApi = {
    beginImport: (input) => record("begin", input, () => ({ id: "run-1" })),
    createImportProject: (input) =>
      record("project", input, () => {
        seed(input.project.id);
        return { id: input.project.id, name: input.project.name };
      }),
    createImportSection: (input) => record("section", input, () => ({ id: input.section.id })),
    createImportTask: (input) =>
      record("task", input, () => ({
        action:
          opts.actionOf?.(input.task) ??
          (input.task.id ? ("created" as const) : ("updated" as const)),
        id: String(input.task.id ?? `existing-${input.task.title}`),
      })),
    finishImport: (input) =>
      record("finish", input, () => ({
        tasksCreated: calls.filter((c) => c.op === "task" && (c.input.task as { id?: string }).id)
          .length,
        tasksUpdated: 0,
        projectsCreated: calls.filter((c) => c.op === "project").length,
        sectionsCreated: calls.filter((c) => c.op === "section").length,
      })),
    listStatuses: async () => [...statuses],
    createStatus: (input) =>
      record("status", input, () => {
        statuses.push({
          id: `st-${input.projectId}-${input.name}`,
          workspaceId: "ws",
          projectId: input.projectId,
          category: input.category,
          name: input.name,
          position: 2,
          hidden: false,
          createdAt: "",
          updatedAt: "",
        });
        return statuses.filter((s) => s.projectId === input.projectId);
      }),
    addComment: (input) => record("comment", input, () => ({})),
  };
  return { api, calls, newId: () => `id-${++n}` };
}

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  workspaceId: "ws",
  userId: "me",
  projects: [],
  sections: [],
  tasks: [],
  ...over,
});

function trelloPlan(): ImportPlan {
  return {
    source: "trello",
    label: "Website launch",
    projects: [
      {
        name: "Website launch",
        description: "For October.",
        sections: ["Week 1"],
        statuses: [
          { name: "To Do", category: "todo" },
          { name: "Doing", category: "in_progress" },
        ],
        tasks: [
          planTask({
            key: "c1",
            title: "Hero copy",
            status: "Doing",
            category: "in_progress",
            section: "Week 1",
            tags: ["Design"],
            assignee: { name: "Maya Chen", email: "maya@example.com" },
            comments: [{ author: "Riley", on: "2026-10-06", text: "Option two." }],
          }),
          planTask({ key: "c1/i1", parentKey: "c1", title: "Draft", category: "done" }),
          planTask({
            key: "c2",
            title: "Photos",
            status: "To Do",
            assignee: { name: "Jan Novak", email: "jan@acme.com" },
          }),
          planTask({ key: "c3", title: "Analytics" }),
        ],
      },
    ],
    skipped: {},
    notes: {},
  };
}

const tasksOf = (calls: Call[]) =>
  calls.filter((c) => c.op === "task").map((c) => c.input.task as Record<string, unknown>);

describe("a first import", () => {
  it("begins, makes the project, section and missing statuses, then every task, then finishes", async () => {
    const { api, calls, newId } = fakeApi();
    const resolved = resolvePlan(choosePlan(trelloPlan(), { includeFinished: true }), ctx());
    expect(resolved.counts).toMatchObject({
      newTasks: 4,
      updatedTasks: 0,
      newProjects: 1,
      nobodyOnIt: 2,
    });
    const out = await runImport(api, resolved, ctx(), {
      assignNobodyToMe: true,
      assigneeOf: PICKS,
      newId,
    });
    if (!out.ok) throw new Error(out.message);

    expect(calls[0]).toEqual({
      op: "begin",
      input: { workspaceId: "ws", source: "trello", label: "Website launch" },
    });
    expect(calls.find((c) => c.op === "project")?.input.project).toEqual({
      id: "id-1",
      name: "Website launch",
      description: "For October.",
    });
    // "To Do" is the project's own "To do"; only "Doing" is made.
    expect(calls.filter((c) => c.op === "status").map((c) => c.input.name)).toEqual(["Doing"]);
    expect(
      calls
        .filter((c) => c.op === "section")
        .map((c) => (c.input.section as { name: string }).name),
    ).toEqual(["Week 1"]);
    expect(calls.at(-1)?.op).toBe("finish");

    const sent = tasksOf(calls).filter((t) => t.id);
    const byTitle = (title: string) => sent.find((t) => t.title === title);
    const [hero, photos, analytics, draft] = ["Hero copy", "Photos", "Analytics", "Draft"].map(
      byTitle,
    );
    expect(hero).toMatchObject({
      title: "Hero copy",
      bucket_id: "id-1",
      status_id: "st-id-1-Doing",
      section_id: "id-2",
      // Maya is on it, but only from the re-send after its comment.
      assignee_id: null,
      imported_from: { source: "trello", key: "c1" },
    });
    expect(photos).toMatchObject({ status_id: "st-id-1-To do", assignee_id: null });
    expect(analytics).toMatchObject({ status: "todo", assignee_id: "me" });
    expect(draft).toMatchObject({ parent_id: hero!.id, section_id: "id-2", status: "done" });
    // The export's order, kept.
    const positions = [hero, photos, analytics].map((t) => String(t!.position));
    expect([...positions].sort()).toEqual(positions);
    expect(out.unassigned).toBe(1);
    expect(out.projects).toEqual([{ id: "id-1", name: "Website launch" }]);
  });

  it("adds a created task's comments, then sends it again by key so they're the run's own", async () => {
    const { api, calls, newId } = fakeApi();
    const resolved = resolvePlan(trelloPlan(), ctx());
    const out = await runImport(api, resolved, ctx(), {
      assignNobodyToMe: false,
      assigneeOf: PICKS,
      newId,
    });
    if (!out.ok) throw new Error(out.message);
    const commentAt = calls.findIndex((c) => c.op === "comment");
    expect(String(calls[commentAt]?.input.body)).toMatch(
      /^Riley · in Trello · .*2026\nOption two\.$/,
    );
    const resend = calls.slice(commentAt).find((c) => c.op === "task");
    expect(resend?.input.task).toEqual({
      title: "Hero copy",
      imported_from: { source: "trello", key: "c1" },
      assignee_id: "maya",
    });
    expect(out.comments).toBe(1);
  });
});

describe("a re-run", () => {
  it("updates what the last run made where it is, and makes no project", async () => {
    const { api, calls, newId } = fakeApi();
    const here = ctx({
      projects: [{ id: "p-old", name: "Website launch" }],
      tasks: [
        {
          id: "t1",
          bucketId: "p-old",
          parentId: null,
          position: "a",
          creatorId: "me",
          importedFrom: { source: "trello", key: "c1" },
        },
        {
          id: "t2",
          bucketId: "p-old",
          parentId: null,
          position: "b",
          creatorId: "me",
          importedFrom: { source: "trello", key: "c2" },
        },
        // Someone else's task with the same key isn't yours to update.
        {
          id: "x",
          bucketId: "p-old",
          parentId: null,
          position: "c",
          creatorId: "maya",
          importedFrom: { source: "trello", key: "c3" },
        },
      ],
    });
    const resolved = resolvePlan(trelloPlan(), here);
    expect(resolved.targets).toEqual([
      { kind: "existing", projectId: "p-old", name: "Website launch" },
    ]);
    expect(resolved.counts).toMatchObject({ newTasks: 2, updatedTasks: 2, newProjects: 0 });
    await runImport(api, resolved, here, { assignNobodyToMe: false, assigneeOf: PICKS, newId });
    expect(calls.some((c) => c.op === "project")).toBe(false);
    const sent = tasksOf(calls);
    const hero = sent.find((t) => t.title === "Hero copy" && t.description !== undefined)!;
    expect(hero).toEqual({
      title: "Hero copy",
      description: "",
      imported_from: { source: "trello", key: "c1" },
    });
    // A new subtask of an updated parent goes under it.
    expect(sent.find((t) => t.title === "Draft")).toMatchObject({
      parent_id: "existing-Hero copy",
      bucket_id: "p-old",
    });
    // No comments on a task this run didn't make.
    expect(calls.some((c) => c.op === "comment")).toBe(false);
  });
});

describe("refusals", () => {
  it("makes a task without its tags when tags can't be made here", async () => {
    const { api, calls, newId } = fakeApi({
      refuse: (op, input) =>
        op === "task" && (input.tags as string[] | undefined)?.length
          ? "You can't make new tags in this workspace."
          : null,
    });
    const out = await runImport(api, resolvePlan(trelloPlan(), ctx()), ctx(), {
      assignNobodyToMe: false,
      assigneeOf: PICKS,
      newId,
    });
    if (!out.ok) throw new Error(out.message);
    expect(out.tagsLeftOff).toBe(1);
    expect(out.failed).toBe(0);
    expect(
      calls.filter(
        (c) =>
          c.op === "task" &&
          c.input.task &&
          (c.input.task as { title: string }).title === "Hero copy",
      ).length,
    ).toBeGreaterThanOrEqual(2);
  });

  it("counts a refused task and its subtasks, and still finishes", async () => {
    const { api, calls, newId } = fakeApi({
      refuse: (op, input) =>
        op === "task" && (input.task as { title: string }).title === "Hero copy"
          ? "No access."
          : null,
    });
    const out = await runImport(api, resolvePlan(trelloPlan(), ctx()), ctx(), {
      assignNobodyToMe: false,
      assigneeOf: PICKS,
      newId,
    });
    if (!out.ok) throw new Error(out.message);
    expect(out.failed).toBe(2);
    expect(out.firstError).toBe("No access.");
    expect(calls.at(-1)?.op).toBe("finish");
  });

  it("writes nothing when the run can't begin", async () => {
    const { api, calls, newId } = fakeApi({
      refuse: (op) => (op === "begin" ? "You don't have edit access." : null),
    });
    const out = await runImport(api, resolvePlan(trelloPlan(), ctx()), ctx(), {
      assignNobodyToMe: false,
      assigneeOf: PICKS,
      newId,
    });
    expect(out).toEqual({ ok: false, message: "You don't have edit access." });
    expect(calls).toHaveLength(1);
  });

  it("stops between tasks when asked, keeping what landed", async () => {
    const { api, calls, newId } = fakeApi();
    const stop = new AbortController();
    stop.abort();
    const out = await runImport(api, resolvePlan(trelloPlan(), ctx()), ctx(), {
      assignNobodyToMe: false,
      assigneeOf: PICKS,
      newId,
      signal: stop.signal,
    });
    if (!out.ok) throw new Error(out.message);
    expect(out.stopped).toBe(true);
    expect(tasksOf(calls)).toHaveLength(0);
    expect(calls.at(-1)?.op).toBe("finish");
  });
});

describe("people and notices", () => {
  it("assigns a teammate on a commented task only in the re-send after its comments", async () => {
    const { api, calls, newId } = fakeApi();
    await runImport(api, resolvePlan(trelloPlan(), ctx()), ctx(), {
      assignNobodyToMe: false,
      assigneeOf: PICKS,
      newId,
    });
    const heroSends = calls.filter(
      (c) => c.op === "task" && (c.input.task as { title: string }).title === "Hero copy",
    );
    expect((heroSends[0]!.input.task as Record<string, unknown>).assignee_id).toBeNull();
    const firstComment = calls.findIndex((c) => c.op === "comment");
    const resend = calls.slice(firstComment).find((c) => c.op === "task");
    expect(resend?.input.task).toEqual({
      title: "Hero copy",
      imported_from: { source: "trello", key: "c1" },
      assignee_id: "maya",
    });
  });

  it("says when the server matched a task the app took for new, and when counts can't be read", async () => {
    const { api, newId } = fakeApi({
      actionOf: (t) => (t.title === "Photos" && t.id ? "updated" : t.id ? "created" : "updated"),
      refuse: (op) => (op === "finish" ? "Network" : null),
    });
    const out = await runImport(api, resolvePlan(trelloPlan(), ctx()), ctx(), {
      assignNobodyToMe: false,
      assigneeOf: PICKS,
      newId,
    });
    if (!out.ok) throw new Error(out.message);
    expect(out.matchedEarlier).toBe(1);
    expect(out.countsUnknown).toBe(true);
  });

  it("counts people and the nobody-on-it tick on new tasks only", () => {
    const here = ctx({
      tasks: [
        {
          id: "t3",
          bucketId: "p",
          parentId: null,
          position: "a",
          creatorId: "me",
          importedFrom: { source: "trello", key: "c3" },
        },
      ],
    });
    // c3 (nobody on it) came in before; c1/i1 is the only new one nobody is on.
    expect(resolvePlan(trelloPlan(), here).counts.nobodyOnIt).toBe(1);
  });
});
