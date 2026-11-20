// TV-D10 · how the app reads and writes the new task fields (section, team,
// estimate, import key) and the structure rows.

import { describe, expect, it } from "@rstest/core";

import { estimateOf, type Task } from "../features/tasks/model";
import {
  bucketRowToModel,
  sectionRowToModel,
  taskCreateOpInput,
  taskPatchToColumns,
  taskPatchToOpFields,
  taskReminderRowToModel,
  taskRowToModel,
  teamRowToModel,
} from "./task-rows";

const NOW = "2026-10-11T10:00:00Z";
const taskRow = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  workspace_id: "ws",
  owner_id: "u1",
  assignee_id: "u1",
  bucket_id: "p1",
  title: "Problem set 1",
  status: "todo",
  duration_minutes: 60,
  created_at: NOW,
  updated_at: NOW,
  ...over,
});

describe("task rows (TV-D10)", () => {
  it("read the section, team, estimate and import key", () => {
    const t = taskRowToModel(
      taskRow({
        section_id: "s1",
        team_id: "tm1",
        estimate_minutes: 240,
        imported_from: { source: "todoist", key: "8812" },
      }),
    );
    expect([t.sectionId, t.teamId, t.estimateMinutes, t.importedFrom]).toEqual([
      "s1",
      "tm1",
      240,
      { source: "todoist", key: "8812" },
    ]);
    // duration_minutes is the scheduled block now; the estimate is its own.
    expect([t.durationMinutes, estimateOf(t)]).toEqual([60, 240]);
  });

  it("leave the fields out on a row from before it, so the estimate is duration_minutes", () => {
    const t = taskRowToModel(taskRow());
    expect("estimateMinutes" in t || "sectionId" in t || "teamId" in t).toBe(false);
    expect(estimateOf(t)).toBe(60);
    // A null estimate on a migrated row is "no estimate", whatever the block.
    expect(estimateOf(taskRowToModel(taskRow({ estimate_minutes: null })))).toBeNull();
  });

  it("send the new fields to the ops by their column names", () => {
    expect(taskPatchToOpFields({ sectionId: "s1", teamId: null, estimateMinutes: 90 })).toEqual({
      section_id: "s1",
      team_id: null,
      estimate_minutes: 90,
    });
  });

  it("create with them only when set (no fallback needed on an older database)", () => {
    const base = { ...taskRowToModel(taskRow()), id: "t2" } as Task;
    expect(Object.keys(taskCreateOpInput(base))).not.toContain("section_id");
    const input = taskCreateOpInput({
      ...base,
      sectionId: "s1",
      teamId: "tm1",
      estimateMinutes: 30,
      importedFrom: { source: "trello", key: "c1" },
    });
    expect([input.section_id, input.team_id, input.estimate_minutes, input.imported_from]).toEqual([
      "s1",
      "tm1",
      30,
      { source: "trello", key: "c1" },
    ]);
  });

  it("the raw column write has no estimate or section column: duration_minutes only", () => {
    expect(taskPatchToColumns({ estimateMinutes: 45, sectionId: "s1" }, NOW)).toEqual({
      duration_minutes: 45,
      updated_at: NOW,
    });
  });
});

describe("structure rows (TV-D10)", () => {
  it("projects carry their fields, read laxly", () => {
    const p = bucketRowToModel({
      id: "p1",
      workspace_id: "ws",
      name: "Acme",
      status: "on_hold",
      starts_on: "2026-11-02",
      target_on: "2026-12-18",
      lead_id: "u1",
      client_contact_id: "c1",
      area_id: "a1",
      group_label: "Clients",
      created_at: NOW,
      updated_at: NOW,
    });
    expect([
      p.status,
      p.startsOn,
      p.targetOn,
      p.leadId,
      p.clientContactId,
      p.areaId,
      p.group,
    ]).toEqual(["on_hold", "2026-11-02", "2026-12-18", "u1", "c1", "a1", "Clients"]);
    const old = bucketRowToModel({
      id: "p1",
      workspace_id: "ws",
      name: "Acme",
      created_at: NOW,
      updated_at: NOW,
    });
    expect("status" in old).toBe(false);
    expect("clientCompanyId" in old).toBe(false);
  });

  it("a project's client can be a company (MOD-155), and a row from before it has no such field", () => {
    const row = {
      id: "p1",
      workspace_id: "ws",
      name: "Acme",
      status: "active",
      created_at: NOW,
      updated_at: NOW,
    };
    const company = bucketRowToModel({ ...row, client_contact_id: null, client_company_id: "co1" });
    expect([company.clientContactId, company.clientCompanyId]).toEqual([null, "co1"]);
    const person = bucketRowToModel({ ...row, client_contact_id: "c1", client_company_id: null });
    expect([person.clientContactId, person.clientCompanyId]).toEqual(["c1", null]);
    expect("clientCompanyId" in bucketRowToModel({ ...row, client_contact_id: "c1" })).toBe(false);
  });

  it("sections, teams and reminders map, unknown kinds read safely", () => {
    expect(
      sectionRowToModel({
        id: "s1",
        workspace_id: "ws",
        project_id: "p1",
        name: "Final exam",
        position: 3,
        ends_on: "2026-12-15",
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toMatchObject({ name: "Final exam", startsOn: null, endsOn: "2026-12-15", position: 3 });
    expect(
      teamRowToModel({
        id: "tm1",
        workspace_id: "ws",
        name: "Design",
        mark: "DS",
        created_at: NOW,
        updated_at: NOW,
      }),
    ).toMatchObject({ mark: "DS", defaultProjectId: null, color: null });
    expect(
      taskReminderRowToModel({
        id: "r1",
        workspace_id: "ws",
        task_id: "t1",
        user_id: "u1",
        kind: "two_days_before",
        at: NOW,
        created_at: NOW,
        updated_at: NOW,
      }).kind,
    ).toBe("at");
  });
});
