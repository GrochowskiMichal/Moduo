// TV-D15 · templates as data: reading rows and bodies, dates as offsets, and
// the edits the template-as-editor makes (a body must always hold together:
// parents before their subtasks, one level, positions renumbered).

import { describe, expect, it } from "@rstest/core";

import {
  addTemplateSection,
  addTemplateTask,
  copyName,
  daysBetween,
  offsetLabel,
  type ProjectTemplateBody,
  patchTemplateSection,
  patchTemplateTask,
  removeTemplateSection,
  removeTemplateTask,
  renameTemplateStatus,
  shiftDay,
  type TaskTemplateBody,
  type TemplateTask,
  templateBodyOf,
  templateFromRow,
  templateOutline,
  templateSize,
} from "./model";

const task = (
  title: string,
  parent: number | null,
  extra: Partial<TemplateTask> = {},
): TemplateTask => ({
  title,
  description: "",
  parent,
  position: null,
  priority: null,
  energy: null,
  estimate: null,
  due: null,
  due_time: null,
  assignee: null,
  team: null,
  tags: [],
  links: [],
  ...extra,
});

const project = (): ProjectTemplateBody => ({
  v: 1,
  kind: "project",
  name: "Season",
  description: "",
  color: null,
  starts: 0,
  target: 28,
  statuses: [
    { category: "todo", name: "To do", hidden: false },
    { category: "todo", name: "Drafting", hidden: false },
    { category: "done", name: "Done", hidden: false },
  ],
  sections: [
    { name: "Kick-off", starts: null, ends: 2 },
    { name: "Build", starts: 7, ends: 18 },
  ],
  tasks: [
    task("Brief", null, { section: 0, status: 1 }),
    task("Build it", null, { section: 1, status: 0 }),
    task("Brief: outline", 0),
    task("Build: test", 1),
  ],
  relations: [[0, 1]],
});

describe("reading templates", () => {
  it("maps a row of either table, and drops one it can't read", () => {
    const row = {
      id: "t1",
      workspace_id: "ws",
      owner_id: "u1",
      name: "Season kit",
      shared: true,
      private_source: false,
      shareable: true,
      summary: {
        tasks: 4,
        top: 2,
        sections: 2,
        dated: true,
        people: false,
        anchor: null,
        title: null,
        project: null,
      },
      created_at: "2026-10-13T10:00:00Z",
      updated_at: "2026-10-13T10:00:00Z",
      deleted_at: null,
    };
    const t = templateFromRow(row, "project");
    expect(t?.kind).toBe("project");
    expect(t?.shared).toBe(true);
    expect(t?.facts).toMatchObject({ tasks: 4, sections: 2, dated: true });
    expect(templateFromRow({ ...row, id: undefined }, "project")).toBeNull();
    expect(templateFromRow(row)).toBeNull();
    expect(templateFromRow({ ...row, kind: "task" })?.kind).toBe("task");
  });

  it("reads a body leniently: unknown links and statuses are left out", () => {
    const body = templateBodyOf(
      {
        v: 1,
        kind: "project",
        name: "S",
        statuses: [
          { category: "todo", name: "To do" },
          { category: "nope", name: "x" },
        ],
        sections: [{ name: "A", starts: null, ends: 3 }],
        tasks: [
          {
            title: "T",
            parent: null,
            status: 0,
            section: 0,
            priority: "urgent",
            links: [
              { type: "note", id: "n1" },
              { type: "email", id: "e1" },
            ],
            tags: [{ name: "x" }, { color: "red" }],
          },
        ],
        relations: [[0, 0], "bad"],
      },
      "project",
    ) as ProjectTemplateBody;
    expect(body.statuses).toEqual([{ category: "todo", name: "To do", hidden: false }]);
    expect(body.tasks[0]?.priority).toBeNull();
    expect(body.tasks[0]?.links).toEqual([{ type: "note", id: "n1" }]);
    expect(body.tasks[0]?.tags).toEqual([{ id: null, name: "x", color: null }]);
    expect(body.relations).toEqual([[0, 0]]);
  });

  it("a task body counts from the due date or the start", () => {
    expect((templateBodyOf({ anchor: "due", tasks: [] }, "task") as TaskTemplateBody).anchor).toBe(
      "due",
    );
    expect((templateBodyOf({ tasks: [] }, "task") as TaskTemplateBody).anchor).toBe("start");
  });
});

describe("dates as days from the start", () => {
  it("shifts calendar days across months and years", () => {
    expect(shiftDay("2026-11-02", 2)).toBe("2026-11-04");
    expect(shiftDay("2026-12-30", 3)).toBe("2027-01-02");
    expect(shiftDay("2027-03-01", -1)).toBe("2027-02-28");
    expect(daysBetween("2026-11-02", "2027-01-04")).toBe(63);
  });

  it("says an offset in words", () => {
    expect(offsetLabel(null, "start")).toBe("No date");
    expect(offsetLabel(0, "start")).toBe("On the start");
    expect(offsetLabel(0, "due")).toBe("On the due date");
    expect(offsetLabel(1, "start")).toBe("1 day after the start");
    expect(offsetLabel(-3, "due")).toBe("3 days before the due date");
  });

  it("names a copy and sizes a template", () => {
    expect(copyName("Season 1")).toBe("Season 1 (copy)");
    expect(copyName("x".repeat(120)).length).toBeLessThanOrEqual(120);
    expect(
      templateSize({ kind: "project", facts: { tasks: 12, top: 8, sections: 3 } as never }),
    ).toBe("12 tasks · 3 sections");
    expect(templateSize({ kind: "task", facts: { tasks: 3 } as never })).toBe("2 subtasks");
    expect(templateSize({ kind: "task", facts: { tasks: 1 } as never })).toBe("No subtasks");
  });
});

describe("editing a body (the template is its own editor)", () => {
  it("adds a top-level task before every subtask, renumbering parents and dependencies", () => {
    const next = addTemplateTask(project(), { title: "Launch", section: 1 });
    expect(next.tasks.map((t) => t.title)).toEqual([
      "Brief",
      "Build it",
      "Launch",
      "Brief: outline",
      "Build: test",
    ]);
    expect(next.tasks[3]?.parent).toBe(0);
    expect(next.tasks[4]?.parent).toBe(1);
    expect(next.tasks[2]).toMatchObject({ parent: null, section: 1, status: null });
    expect(next.relations).toEqual([[0, 1]]);
  });

  it("adds a subtask after its parent's last subtask", () => {
    const next = addTemplateTask(project(), { title: "Brief: send", parent: 0 });
    expect(next.tasks.map((t) => t.title)).toEqual([
      "Brief",
      "Build it",
      "Brief: outline",
      "Brief: send",
      "Build: test",
    ]);
    expect(next.tasks[3]?.parent).toBe(0);
    expect(next.tasks[4]?.parent).toBe(1);
    expect(templateOutline(next).map((x) => `${x.depth}:${x.task.title}`)).toEqual([
      "0:Brief",
      "1:Brief: outline",
      "1:Brief: send",
      "0:Build it",
      "1:Build: test",
    ]);
  });

  it("removes a task with its subtasks and closes up every position", () => {
    const next = removeTemplateTask(project(), 0);
    expect(next.tasks.map((t) => t.title)).toEqual(["Build it", "Build: test"]);
    expect(next.tasks[1]?.parent).toBe(0);
    expect(next.relations).toEqual([]);
  });

  it("never removes a task template's own task", () => {
    const body: TaskTemplateBody = {
      v: 1,
      kind: "task",
      anchor: "start",
      project: null,
      section: null,
      tasks: [task("Episode", null), task("Record", 0)],
      relations: [],
    };
    expect(removeTemplateTask(body, 0)).toBe(body);
    expect(removeTemplateTask(body, 1).tasks.map((t) => t.title)).toEqual(["Episode"]);
  });

  it("a due time goes with its due date", () => {
    const body = patchTemplateTask(project(), 0, { due: 2, due_time: "14:00" });
    expect(patchTemplateTask(body, 0, { due: null }).tasks[0]?.due_time).toBeNull();
  });

  it("sections: a start needs an end after it; a removed one leaves its tasks unsectioned", () => {
    let body = addTemplateSection(project(), "Ship");
    expect(body.sections[2]).toEqual({ name: "Ship", starts: null, ends: null });
    body = patchTemplateSection(body, 1, { starts: 30 });
    expect(body.sections[1]).toMatchObject({ starts: 18, ends: 18 });
    body = patchTemplateSection(body, 1, { ends: null });
    expect(body.sections[1]).toMatchObject({ starts: null, ends: null });
    const without = removeTemplateSection(project(), 0);
    expect(without.tasks[0]?.section).toBeNull();
    expect(without.tasks[1]?.section).toBe(0);
  });

  it("statuses are renamed, never to a name another status has", () => {
    expect(renameTemplateStatus(project(), 1, "Writing").statuses[1]?.name).toBe("Writing");
    const same = project();
    expect(renameTemplateStatus(same, 1, "to do")).toBe(same);
    expect(renameTemplateStatus(same, 1, "  ")).toBe(same);
  });
});
