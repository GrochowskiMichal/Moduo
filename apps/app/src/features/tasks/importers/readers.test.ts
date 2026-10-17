// TV-U18: each service's export file → a plan, from the fixtures in
// tests/fixtures/importers (written from each service's documented format).

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "@rstest/core";
import { parseCsv } from "./csv";
import { jiraDue, wordsDue } from "./dates";
import {
  choosePlan,
  describeNotes,
  describeSkips,
  IMPORT_MAX_TASKS,
  type ImportPlan,
  planTask,
  planTasks,
} from "./plan";
import { readImportText, sizeProblem } from "./read";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../../..");
const fixture = (name: string) =>
  readFileSync(resolve(REPO, "e2e/tests/fixtures/importers", name), "utf8");
const NOW = new Date("2026-10-14T10:00:00");

function read(name: string, zone = "Europe/Warsaw"): ImportPlan {
  const res = readImportText(name, fixture(name), { zone, now: NOW });
  if (!res.ok) throw new Error(res.message);
  return res.plan;
}
const task = (plan: ImportPlan, title: string) => {
  const t = planTasks(plan).find((x) => x.title === title);
  if (!t) throw new Error(`no task ${title}`);
  return t;
};

describe("csv", () => {
  it("reads quotes, doubled quotes, line breaks, a BOM and repeated headers", () => {
    const t = parseCsv('﻿a,b,b\r\n"x, y","say ""hi""\nthere",z\n\n1,2\n');
    expect(t.header).toEqual(["a", "b", "b"]);
    expect(t.rows).toEqual([
      ["x, y", 'say "hi"\nthere', "z"],
      ["1", "2", ""],
    ]);
  });
});

describe("Todoist", () => {
  const plan = read("todoist-cs201.csv");

  it("is one project named after the file, with its sections", () => {
    expect(plan.source).toBe("todoist");
    expect(plan.projects.map((p) => p.name)).toEqual(["todoist-cs201"]);
    expect(plan.projects[0]!.sections).toEqual(["Week 1", "Week 2"]);
    expect(plan.projects[0]!.description).toBe("Syllabus is on the course site");
  });

  it("takes labels out of the title, priority 1 as high, the duration as the estimate", () => {
    const t = task(plan, "Read chapter 1");
    expect(t.tags).toEqual(["reading"]);
    expect(t.priority).toBe("medium");
    expect(t.estimateMinutes).toBe(45);
    expect(t.dueOn).toBe("2026-10-20");
    expect(t.section).toBe("Week 1");
    expect(t.comments).toEqual([
      { author: "Sam Student", on: null, text: "Focus on 1.3 — it's on the quiz" },
    ]);
    expect(task(plan, "Problem set 1").priority).toBe("high");
    expect(task(plan, "Problem set 1").tags).toEqual(["homework", "graded"]);
  });

  it("keeps a repeat Moduo can follow and a dated time", () => {
    const ps = task(plan, "Problem set 1");
    expect(ps.recurrence?.rrule).toContain("BYDAY=MO");
    expect(ps.dueOn).toBe("2026-10-19");
    const lab = task(plan, "Lab report draft");
    expect(lab.dueOn).toBe("2026-10-27");
    expect(lab.dueTime).toBe("17:00");
    expect(lab.description).toBe('Template in the shared drive.\nUse the "results" table.');
    expect(lab.assignee).toEqual({ name: "Alex Kim", email: null });
  });

  it("keeps a repeat it can't follow as text, and says so", () => {
    const oh = task(plan, "Office hours");
    expect(oh.recurrence).toBeNull();
    expect(oh.dueOn).toBeNull();
    expect(oh.description).toBe("Repeats in Todoist: every 3rd workday");
    expect(plan.notes.repeat_as_text).toBe(1);
  });

  it("uses a deadline as the due date when there's no date", () => {
    expect(task(plan, "Midterm prep").dueOn).toBe("2026-11-03");
  });

  it("flattens deeper subtasks and keeps keys stable across reads", () => {
    const parent = task(plan, "Problem set 1");
    expect(task(plan, "Question 1").parentKey).toBe(parent.key);
    expect(task(plan, "Question 2 (part b)").parentKey).toBe(parent.key);
    expect(plan.notes.flattened).toBe(1);
    const again = read("todoist-cs201.csv");
    expect(planTasks(again).map((t) => t.key)).toEqual(planTasks(plan).map((t) => t.key));
    expect(new Set(planTasks(plan).map((t) => t.key)).size).toBe(planTasks(plan).length);
  });
});

describe("Trello", () => {
  const plan = read("trello-launch.json", "Europe/Warsaw");
  const project = plan.projects[0]!;

  it("numbers members the board doesn't name, one person each", () => {
    const board = {
      name: "Side board",
      lists: [{ id: "l1", name: "To Do", pos: 1 }],
      members: [{ id: "m-known", fullName: "Dana Park" }],
      cards: [
        { id: "c1", name: "First", idList: "l1", idMembers: ["m-gone-a"], pos: 1 },
        { id: "c2", name: "Second", idList: "l1", idMembers: ["m-gone-b"], pos: 2 },
        { id: "c3", name: "Third", idList: "l1", idMembers: ["m-gone-a"], pos: 3 },
        { id: "c4", name: "Fourth", idList: "l1", idMembers: ["m-known"], pos: 4 },
      ],
    };
    const res = readImportText("side.json", JSON.stringify(board), {
      zone: "Europe/Warsaw",
      now: NOW,
    });
    if (!res.ok) throw new Error(res.message);
    const who = (title: string) => task(res.plan, title).assignee?.name;
    expect(["First", "Second", "Third", "Fourth"].map(who)).toEqual([
      "Trello member 1",
      "Trello member 2",
      "Trello member 1",
      "Dana Park",
    ]);
  });

  it("makes open lists statuses with a guessed category", () => {
    expect(project.name).toBe("Website launch");
    expect(project.statuses).toEqual([
      { name: "Ideas", category: "backlog" },
      { name: "To Do", category: "todo" },
      { name: "Doing", category: "in_progress" },
      { name: "Waiting on client", category: "in_progress" },
      { name: "Done", category: "done" },
    ]);
  });

  it("leaves archived cards and archived lists' cards behind", () => {
    expect(plan.skipped.archived).toBe(2);
    expect(planTasks(plan).some((t) => t.title === "Old banner" || t.title === "Retro notes")).toBe(
      false,
    );
  });

  it("maps a card: short link key, labels (colour when unnamed), due in the zone, comments oldest first", () => {
    const hero = task(plan, "Homepage hero copy");
    expect(hero.key).toBe("Qw3rTy12");
    expect(hero.status).toBe("To Do");
    expect(hero.tags).toEqual(["Design", "Urgent"]);
    expect(hero.dueOn).toBe("2026-10-20");
    expect(hero.dueTime).toBe("17:00");
    expect(hero.comments.map((c) => c.text)).toEqual([
      "Option two reads better out loud.",
      "Agreed — going with two.",
    ]);
    expect(hero.assignee).toEqual({ name: "Dana Park", email: null });
    expect(task(plan, "Pick the photo set").tags).toEqual(["yellow"]);
    // 22:00 UTC is the next day in Warsaw.
    expect(task(plan, "Legal review of the terms").dueOn).toBe("2026-10-24");
    expect(plan.notes.start_dropped).toBe(1);
    expect(plan.notes.attachments_dropped).toBe(2);
  });

  it("turns checklist items into subtasks", () => {
    const item = task(plan, "Draft three headlines");
    expect(item.parentKey).toBe("Qw3rTy12");
    expect(item.category).toBe("done");
    expect(task(plan, "Run them past Riley").category).toBe("todo");
  });

  it("applies the categories the preview confirms", () => {
    const chosen = choosePlan(plan, {
      includeFinished: true,
      categories: { "Website launch": { "Waiting on client": "todo" } },
    });
    expect(chosen.projects[0]!.statuses.find((s) => s.name === "Waiting on client")?.category).toBe(
      "todo",
    );
    expect(task(chosen, "Legal review of the terms").category).toBe("todo");
  });
});

describe("Linear", () => {
  const plan = read("linear-eng.csv");

  it("keeps issue ids as keys, projects by Linear project or team, milestones as sections", () => {
    expect(plan.projects.map((p) => p.name)).toEqual(["Billing revamp", "Engineering"]);
    const billing = plan.projects[0]!;
    expect(billing.sections).toEqual(["Beta"]);
    expect(task(plan, "Invoice PDF is cut off on Safari").key).toBe("ENG-123");
  });

  it("states by their own columns: In Review in progress, Canceled won't do", () => {
    const billing = plan.projects[0]!;
    expect(billing.statuses).toContainEqual({ name: "In Review", category: "in_progress" });
    expect(task(plan, "Invoice PDF is cut off on Safari").category).toBe("done");
    expect(task(plan, "Old coupon flow").category).toBe("wont_do");
    expect(task(plan, "Retry failed webhooks").category).toBe("backlog");
  });

  it("maps priority (Urgent keeps a tag), labels, emails and parents", () => {
    const bug = task(plan, "Invoice PDF is cut off on Safari");
    expect(bug.priority).toBe("high");
    expect(bug.tags).toEqual(["Bug", "urgent"]);
    expect(bug.assignee).toEqual({ name: null, email: "maya@example.com" });
    expect(task(plan, "Billing page v2").tags).toEqual(["Frontend", "Billing"]);
    expect(task(plan, "Plans table").parentKey).toBe("ENG-120");
    expect(task(plan, "Plans table: empty state").parentKey).toBe("ENG-120");
    expect(plan.notes.estimate_dropped).toBe(4);
  });
});

describe("Jira", () => {
  const plan = read("jira-web.csv");

  it("makes an epic a section and its stories the section's tasks", () => {
    const web = plan.projects[0]!;
    expect(web.name).toBe("Website");
    expect(web.sections).toEqual(["Checkout redesign"]);
    expect(planTasks(plan).some((t) => t.title === "Checkout redesign")).toBe(false);
    const story = task(plan, "Address form validation");
    expect(story.section).toBe("Checkout redesign");
    expect(story.parentKey).toBeNull();
    expect(plan.notes.epic_as_section).toBe(1);
  });

  it("maps a story: key, status category, due wall clock, estimate, labels, email", () => {
    const story = task(plan, "Address form validation");
    expect(story.key).toBe("WEB-42");
    expect(story.status).toBe("Selected for Development");
    expect(story.category).toBe("todo");
    expect(story.dueOn).toBe("2026-10-24");
    expect(story.dueTime).toBe("17:00");
    expect(story.estimateMinutes).toBe(240);
    expect(story.tags).toEqual(["checkout", "forms"]);
    expect(story.assignee).toEqual({ name: null, email: "riley@example.com" });
    expect(plan.notes.estimate_dropped).toBe(2);
    expect(plan.notes.attachments_dropped).toBe(1);
  });

  it("keeps sub-tasks under their story, Won't Do as won't do, Highest as high + tag", () => {
    const sub = task(plan, "Postcode lookup returns 500");
    expect(sub.parentKey).toBe("WEB-42");
    expect(sub.category).toBe("done");
    expect(sub.tags).toEqual(["bug", "highest"]);
    expect(task(plan, "Remove the legacy coupon field").category).toBe("wont_do");
    expect(task(plan, "Accessibility pass").category).toBe("backlog");
  });

  it("reads comments without account ids", () => {
    expect(planTasks(plan).flatMap((t) => t.comments)).toEqual([]);
  });

  it("reads Jira's dates", () => {
    expect(jiraDue("31/Oct/26 12:00 AM")).toEqual({ dueOn: "2026-10-31", dueTime: null });
    expect(jiraDue("06/Oct/26 12:15 PM")).toEqual({ dueOn: "2026-10-06", dueTime: "12:15" });
    expect(jiraDue("2026-10-24 17:00")).toEqual({ dueOn: "2026-10-24", dueTime: "17:00" });
    expect(jiraDue("32/Oct/26")).toBeNull();
  });
});

describe("Asana", () => {
  const plan = read("asana-marketing.csv");

  it("maps sections, subtasks by parent name, done, emails and dates", () => {
    const p = plan.projects[0]!;
    expect(p.name).toBe("Q4 Marketing");
    expect(p.sections).toEqual(["Planning", "In progress"]);
    const launch = task(plan, "Launch email");
    expect(launch.key).toBe("1208123400000001");
    expect(launch.tags).toEqual(["email", "launch"]);
    expect(launch.assignee).toEqual({ name: "Maya Chen", email: "maya@example.com" });
    expect(launch.priority).toBe("high");
    expect(task(plan, "Write the copy").parentKey).toBe("1208123400000001");
    expect(task(plan, "Write the copy").section).toBe("Planning");
    expect(task(plan, "Book the photographer").category).toBe("done");
    expect(task(plan, "Webinar landing page").dueOn).toBe("2026-10-30");
    expect(plan.skipped.untitled).toBe(1);
    expect(plan.notes.start_dropped).toBe(1);
  });
});

describe("the choice before importing", () => {
  it("leaves finished tasks out unless asked, with their subtasks", () => {
    const plan = read("trello-launch.json");
    const open = choosePlan(plan, { includeFinished: false });
    expect(planTasks(open).some((t) => t.category === "done")).toBe(false);
    expect(open.skipped.finished).toBe(2);
    expect(open.projects[0]!.statuses.some((s) => s.name === "Done")).toBe(false);
  });

  it("keeps the first tasks up to the limit and says how many were left", () => {
    const plan: ImportPlan = {
      source: "asana",
      label: "big",
      projects: [
        {
          name: "Big",
          description: "",
          sections: [],
          statuses: [],
          tasks: Array.from({ length: IMPORT_MAX_TASKS + 5 }, (_, i) =>
            planTask({ key: `k${i}`, title: `Task ${i}` }),
          ),
        },
      ],
      skipped: {},
      notes: {},
    };
    const chosen = choosePlan(plan, { includeFinished: true });
    expect(planTasks(chosen)).toHaveLength(IMPORT_MAX_TASKS);
    expect(describeSkips(chosen.skipped)).toEqual(["5 over the 2,000-task limit"]);
  });

  it("says what changed in plain words", () => {
    expect(describeNotes({ repeat_as_text: 2, start_dropped: 1 })).toEqual([
      "2 repeats Moduo can't follow, kept as text in the description",
      "1 start date left out (tasks have a due date only)",
    ]);
  });
});

describe("files we can't read", () => {
  it("names the limit and what we read", () => {
    expect(sizeProblem(12 * 1024 * 1024)).toBe(
      "This file is 12.0 MB. Moduo reads export files up to 10 MB: export one project or board at a time.",
    );
    const res = readImportText("x.csv", "Name,Amount\nCoffee,3\n", { zone: "UTC" });
    expect(res.ok).toBe(false);
    const json = readImportText("x.json", '{"pages": []}', { zone: "UTC" });
    expect(json).toEqual({
      ok: false,
      message: "This JSON isn't a Trello board export. Moduo reads Trello's board JSON.",
    });
  });

  it("reads a repeat with an end it can't keep as text", () => {
    expect(wordsDue("every tuesday until Dec 15", NOW)).toEqual({ kind: "text", repeat: true });
    expect(wordsDue("", NOW)).toEqual({ kind: "none" });
  });
});

describe("dates and names a reader can't take as they are", () => {
  it("keeps an unreadable due date as text and says so", () => {
    const csv = [
      "Summary,Issue key,Issue id,Issue Type,Status,Project name,Due Date,Description",
      "Ship it,WEB-9,1009,Task,To Do,Website,24.10.2026,The launch.",
    ].join("\n");
    const res = readImportText("jira.csv", csv, { zone: "UTC", now: NOW });
    if (!res.ok) throw new Error(res.message);
    const t = planTasks(res.plan)[0]!;
    expect(t.dueOn).toBeNull();
    expect(t.description).toBe("The launch.\n\nDue in Jira: 24.10.2026");
    expect(res.plan.notes.date_as_text).toBe(1);
  });

  it("gives a re-downloaded Todoist file the same project and keys", () => {
    const again = readImportText("todoist-cs201 (1).csv", fixture("todoist-cs201.csv"), {
      zone: "Europe/Warsaw",
      now: NOW,
    });
    if (!again.ok) throw new Error(again.message);
    const first = read("todoist-cs201.csv");
    expect(again.plan.projects[0]!.name).toBe("todoist-cs201");
    expect(planTasks(again.plan).map((t) => t.key)).toEqual(planTasks(first).map((t) => t.key));
  });
});
