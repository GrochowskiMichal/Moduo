// TV-U18: who an export's assignees are is decided in the app, from what the
// member list already shows the person importing (names, their own email),
// and by their own picks in the preview. Nothing in the import path can tell
// them a member's email they couldn't already see.

import { describe, expect, it } from "@rstest/core";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { createTasksAgents } from "../../../lib/runtime.web.agents";
import { type ImportPlan, personFrom, planPeople, planTask, suggestAssignees } from "./plan";
import { type ImportApi, resolvePlan, runImport } from "./run";
import { importApiOf } from "./ui/import-dialog";

const members = [
  { userId: "me", fullName: "Sam Student", canTakeTasks: true },
  { userId: "maya", fullName: "Maya Chen", canTakeTasks: true },
  { userId: "alex1", fullName: "Alex Kim", canTakeTasks: true },
  { userId: "alex2", fullName: "alex kim", canTakeTasks: true },
  { userId: "vic", fullName: "Vic Viewer", canTakeTasks: false },
];
const me = { userId: "me", email: "sam@school.edu" };

describe("reading people from a file", () => {
  it("takes names, emails and both", () => {
    expect(personFrom("Maya Chen")).toEqual({ name: "Maya Chen", email: null });
    expect(personFrom("maya@example.com")).toEqual({ name: null, email: "maya@example.com" });
    expect(personFrom("Maya Chen", "Maya@Example.com")).toEqual({
      name: "Maya Chen",
      email: "maya@example.com",
    });
    expect(personFrom("Maya Chen <maya@example.com>")).toEqual({
      name: "Maya Chen",
      email: "maya@example.com",
    });
    expect(personFrom("  ")).toBeNull();
  });
});

describe("suggesting who they are here", () => {
  const people = [
    { key: "sam@school.edu", person: { name: null, email: "sam@school.edu" } },
    { key: "maya chen", person: { name: "Maya Chen", email: null } },
    { key: "alex kim", person: { name: "Alex Kim", email: null } },
    { key: "vic viewer", person: { name: "Vic Viewer", email: null } },
    { key: "jan@acme.com", person: { name: null, email: "jan@acme.com" } },
  ];
  const picks = suggestAssignees(people, members, me);

  it("matches your own email, and a member by a name only one member has", () => {
    expect(picks.get("sam@school.edu")).toBe("me");
    expect(picks.get("maya chen")).toBe("maya");
  });

  it("leaves a shared name, someone who can't take tasks and an unknown email to the importer", () => {
    expect(picks.get("alex kim")).toBeNull();
    expect(picks.get("vic viewer")).toBeNull();
    expect(picks.get("jan@acme.com")).toBeNull();
  });

  it("never matches a member by an email the app can't read", () => {
    // Maya's real email is in the file, but members' emails aren't in the
    // member list: only her name could find her, so an email-only entry stays
    // Unassigned and nothing confirms the email is hers.
    const byEmail = suggestAssignees(
      [{ key: "maya@example.com", person: { name: null, email: "maya@example.com" } }],
      members,
      me,
    );
    expect(byEmail.get("maya@example.com")).toBeNull();
  });
});

describe("nothing in the import path looks people up", () => {
  const plan: ImportPlan = {
    source: "asana",
    label: "Q4",
    projects: [
      {
        name: "Q4",
        description: "",
        sections: [],
        statuses: [],
        tasks: [
          planTask({
            key: "1",
            title: "Launch email",
            assignee: personFrom("", "maya@example.com"),
          }),
          planTask({ key: "2", title: "Venue", assignee: personFrom("Jan Novak", "jan@acme.com") }),
        ],
      },
    ],
    skipped: {},
    notes: {},
  };

  it("lists each person once, with their tasks", () => {
    expect(planPeople(plan).map((p) => [p.label, p.tasks])).toEqual([
      ["Jan Novak · jan@acme.com", 1],
      ["maya@example.com", 1],
    ]);
  });

  it("sends the server only the member the importer picked, never the file's emails or names", async () => {
    const sent: unknown[] = [];
    const record = async <T>(input: unknown, answer: T) => {
      sent.push(input);
      return answer;
    };
    const api: ImportApi = {
      beginImport: (i) => record(i, { id: "run" }),
      createImportProject: (i) => record(i, { id: "p", name: "Q4" }),
      createImportSection: (i) => record(i, { id: "s" }),
      createImportTask: (i) => record(i, { action: "created" as const, id: String(i.task.id) }),
      finishImport: (i) =>
        record(i, { tasksCreated: 2, tasksUpdated: 0, projectsCreated: 1, sectionsCreated: 0 }),
      listStatuses: (ws) => record(ws, []),
      createStatus: (i) => record(i, []),
      addComment: (i) => record(i, {}),
    };
    const ctx = { workspaceId: "ws", userId: "me", projects: [], sections: [], tasks: [] };
    const out = await runImport(api, resolvePlan(plan, ctx), ctx, {
      assignNobodyToMe: false,
      assigneeOf: new Map([
        ["maya@example.com", "maya"],
        ["jan@acme.com", null],
      ]),
    });
    expect(out.ok).toBe(true);
    const wire = JSON.stringify(sent);
    expect(wire).not.toContain("maya@example.com");
    expect(wire).not.toContain("jan@acme.com");
    expect(wire).not.toContain("Jan Novak");
    expect(wire).toContain('"assignee_id":"maya"');
  });

  it("offers the dialog no member lookup: the runtime's import calls are the engine's ops", () => {
    const agents = createTasksAgents({} as never, { userId: async () => "me" });
    expect(Object.keys(agents).filter((k) => /member|email|people|person/i.test(k))).toEqual([]);
    const runtime = {
      tasks: { ...agents, listStatuses: async () => [], createStatus: async () => [] },
      spine: { addComment: async () => ({}) },
    } as unknown as ModuoRuntime;
    expect(Object.keys(importApiOf(runtime) ?? {}).sort()).toEqual([
      "addComment",
      "beginImport",
      "createImportProject",
      "createImportSection",
      "createImportTask",
      "createStatus",
      "finishImport",
      "listStatuses",
    ]);
  });
});
