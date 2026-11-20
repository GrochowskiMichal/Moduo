// TV-D15 · the template reads and ops the app runs (runtime.web.templates.ts),
// against a fake Supabase client: what each call sends, how answers map, and
// a database before the migration.

import { describe, expect, it } from "@rstest/core";

import { applyTaskTemplateFields, createTasksTemplates } from "./runtime.web.templates";

type Answer = { data: unknown; error: { code?: string; message?: string } | null };

const row = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  workspace_id: "ws",
  owner_id: "u1",
  name: "Season kit",
  shared: false,
  private_source: false,
  shareable: true,
  summary: { tasks: 3, top: 2, sections: 1, dated: true, people: false },
  created_at: "2026-10-13T10:00:00Z",
  updated_at: "2026-10-13T10:00:00Z",
  deleted_at: null,
  ...over,
});

function fakeClient(opts: { tables?: Record<string, Answer>; rpc?: Record<string, Answer> }) {
  const rpcCalls: Array<[string, Record<string, unknown>]> = [];
  const client = {
    from(table: string) {
      const answer = opts.tables?.[table] ?? { data: [], error: null };
      const query = Promise.resolve(answer) as Promise<unknown> & Record<string, unknown>;
      for (const m of ["select", "eq", "is", "order", "limit", "maybeSingle"]) {
        query[m] = () => query;
      }
      return query;
    },
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push([fn, args]);
      return opts.rpc?.[fn] ?? { data: null, error: { message: `unexpected ${fn}` } };
    },
  };
  const mapped: unknown[] = [];
  const api = createTasksTemplates(client as never, {
    mapAnswer: (raw) => {
      mapped.push(raw);
      return { buckets: [], statuses: [], sections: [], tasks: [], tagLinks: [], relations: [] };
    },
  });
  return { api, rpcCalls, mapped };
}

describe("templates through the runtime (TV-D15)", () => {
  it("lists both kinds; a missing table fails loudly", async () => {
    const { api } = fakeClient({
      tables: {
        task_templates: { data: [row({ id: "a", name: "Brief" })], error: null },
        project_templates: { data: [row({ id: "b" })], error: null },
      },
    });
    const list = await api.listTemplates("ws");
    expect(list.map((t) => [t.id, t.kind])).toEqual([
      ["a", "task"],
      ["b", "project"],
    ]);
    const before = fakeClient({
      tables: {
        task_templates: {
          data: null,
          error: { code: "PGRST205", message: "Could not find the table 'public.task_templates'" },
        },
        project_templates: {
          data: null,
          error: { code: "42P01", message: 'relation "public.project_templates" does not exist' },
        },
      },
    });
    await expect(before.api.listTemplates("ws")).rejects.toThrow(
      /task_templates|project_templates/,
    );
  });

  it("duplicates through the op with the minted id and maps the answer", async () => {
    const answer = { buckets: [{ id: "np" }], tasks: [] };
    const { api, rpcCalls, mapped } = fakeClient({
      rpc: { projects_op_duplicate: { data: answer, error: null } },
    });
    await api.duplicateProject({
      workspaceId: "ws",
      projectId: "p1",
      id: "np",
      name: " Season 2 ",
      startsOn: "2027-01-04",
      keepPeople: false,
    });
    expect(rpcCalls).toEqual([
      [
        "projects_op_duplicate",
        {
          p_workspace_id: "ws",
          p_project_id: "p1",
          p_fields: { id: "np", name: "Season 2", starts_on: "2027-01-04", keep_people: false },
        },
      ],
    ]);
    expect(mapped).toEqual([answer]);
  });

  it("a task template's destination: omitted keeps the template's, null is your Inbox", () => {
    expect(applyTaskTemplateFields({ id: "t", date: null })).toEqual({ id: "t", date: null });
    expect(
      applyTaskTemplateFields({ id: "t", projectId: null, sectionId: "s1", date: "2027-01-01" }),
    ).toEqual({ id: "t", project_id: null, section_id: null, date: "2027-01-01" });
    expect(
      applyTaskTemplateFields({
        id: "t",
        title: " Brief ",
        projectId: "p",
        sectionId: "s1",
        assigneeId: null,
      }),
    ).toEqual({ id: "t", title: "Brief", project_id: "p", section_id: "s1", assignee_id: null });
  });

  it("passes the server's error through", async () => {
    const { api } = fakeClient({
      rpc: {
        task_templates_op_save: {
          data: null,
          error: {
            code: "PGRST202",
            message: "Could not find the function public.task_templates_op_save",
          },
        },
      },
    });
    await expect(api.saveTaskTemplate({ workspaceId: "ws", taskId: "t1" })).rejects.toThrow(
      /Could not find the function public.task_templates_op_save/,
    );
  });

  it("an update answers with the template and its body", async () => {
    const body = { v: 1, kind: "task", anchor: "due", tasks: [{ title: "Brief", parent: null }] };
    const { api, rpcCalls } = fakeClient({
      rpc: { templates_op_update: { data: { ...row(), kind: "task", body }, error: null } },
    });
    const saved = await api.updateTemplate({
      workspaceId: "ws",
      kind: "task",
      id: "t1",
      patch: { shared: true },
    });
    expect(rpcCalls[0]?.[1]).toEqual({
      p_workspace_id: "ws",
      p_kind: "task",
      p_template_id: "t1",
      p_patch: { shared: true },
    });
    expect(saved.body.kind).toBe("task");
    expect(saved.body.tasks[0]?.title).toBe("Brief");
  });
});
