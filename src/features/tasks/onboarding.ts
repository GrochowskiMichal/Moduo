// Onboarding and Tasks' welcome (TV-U17, tasks-v3 §16, REPLAN 34): the pure
// rules. One role question per person ("What will you run in Moduo?") sets
// defaults only (where Tasks opens, the row preset, a starter template, and
// the saved views TV-U8 seeds); it never turns a feature on or off. Tasks'
// welcome shows once per person, never per device, and anyone can reopen it
// from the sidebar's ⋯ or the top bar's Help. The state lives in the synced
// preferences (`tasksOnboarding`), so it follows the person.

import type { StarterTemplate } from "@contracts/vocabularies";
import type { RowPreset } from "./row-layout";

/** The answers to "What will you run in Moduo?" (REPLAN §3's role table). */
export const TASKS_ROLES = [
  "student",
  "developer",
  "pm",
  "founder",
  "client_work",
  "creator",
] as const;
export type TasksRole = (typeof TASKS_ROLES)[number];

export function isTasksRole(value: unknown): value is TasksRole {
  return typeof value === "string" && (TASKS_ROLES as readonly string[]).includes(value);
}

/** Where Tasks first opens for a role: a sidebar place, or the first project's Board. */
export type FirstView =
  | { kind: "scope"; scope: "inbox" | "upcoming" | "all" }
  | { kind: "project-board" };

export type RoleDefaults = {
  /** The choice as the question shows it. */
  label: string;
  /** What it covers, in a few words. */
  hint: string;
  firstView: FirstView;
  /** Display → Rows for every view that doesn't remember its own (REPLAN 61). */
  rows: RowPreset;
  /** The Timeline's "Due per week" counts start on (REPLAN 67: the term at a glance). */
  duePerWeek: boolean;
  /** The starter template made for this person (REPLAN 9: templates are in). */
  starter: StarterTemplate | null;
  /** The saved views TV-U8 seeds for this role (names; not built yet). */
  views: readonly string[];
};

/**
 * REPLAN §3: "What changes per role is only defaults". Opens on · Row preset
 * · Seeded saved views · Starter template, column by column. "Client
 * projects" opens on All, which lists every project's tasks project by
 * project; a project's Board falls back to All while there's no project.
 */
export const ROLE_DEFAULTS: Record<TasksRole, RoleDefaults> = {
  student: {
    label: "School or study",
    hint: "Courses, assignments, exams",
    firstView: { kind: "scope", scope: "upcoming" },
    rows: "standard",
    duePerWeek: true,
    starter: null,
    views: ["Upcoming", "Today"],
  },
  developer: {
    label: "Software",
    hint: "Issues, bugs, releases",
    firstView: { kind: "scope", scope: "inbox" },
    rows: "detailed",
    duePerWeek: false,
    starter: null,
    views: ["This week", "Mine"],
  },
  pm: {
    label: "Projects for a team",
    hint: "Plans, milestones, who does what",
    firstView: { kind: "project-board" },
    rows: "standard",
    duePerWeek: false,
    starter: "kickoff",
    views: ["Waiting", "Due this week"],
  },
  founder: {
    label: "A company or its operations",
    hint: "Everything that keeps it running",
    firstView: { kind: "scope", scope: "inbox" },
    rows: "standard",
    duePerWeek: false,
    starter: "monthly_close",
    views: ["Waiting on people"],
  },
  client_work: {
    label: "Client work",
    hint: "Clients, deliverables, time",
    firstView: { kind: "scope", scope: "all" },
    rows: "standard",
    duePerWeek: false,
    starter: "client_onboarding",
    views: ["Waiting on client"],
  },
  creator: {
    label: "Content",
    hint: "Ideas, episodes, publishing",
    firstView: { kind: "project-board" },
    rows: "standard",
    duePerWeek: false,
    starter: "episode",
    views: ["Pipeline", "Publish dates"],
  },
};

/** The row preset a view starts with when it remembers none. */
export function defaultRowsFor(role: TasksRole | null): RowPreset {
  return role ? ROLE_DEFAULTS[role].rows : "standard";
}

const NO_DUE_PER_WEEK = { duePerWeek: false } as const;
const DUE_PER_WEEK = { duePerWeek: true } as const;

/** What a role changes in the Timeline's defaults (one stable object per answer). */
export function timelineRoleFor(role: TasksRole | null): { duePerWeek: boolean } {
  return role && ROLE_DEFAULTS[role].duePerWeek ? DUE_PER_WEEK : NO_DUE_PER_WEEK;
}

/**
 * The sidebar place a role opens on: a scope, or a project (with its Board,
 * `board: true`). A project's Board needs a project; without one it's All.
 */
export function firstViewFor(
  role: TasksRole | null,
  projectIds: readonly string[],
): { selection: string; board: boolean } {
  const first = role ? ROLE_DEFAULTS[role].firstView : null;
  if (!first) return { selection: "inbox", board: false };
  if (first.kind === "scope") return { selection: first.scope, board: false };
  const project = projectIds[0];
  return project ? { selection: project, board: true } : { selection: "all", board: false };
}

/** What the welcome's automatic open needs to know. */
export type WelcomeGate = {
  /** The person's synced preferences have been read this session. */
  prefsReady: boolean;
  /** The task copy has reached the server this session (an empty device copy proves nothing). */
  tasksReady: boolean;
  welcomeSeen: boolean;
  /** The person already made tasks in this workspace: they know Tasks. */
  hasOwnTasks: boolean;
};

export type WelcomeDecision = "wait" | "show" | "skip-experienced" | "none";

/**
 * Whether Tasks' welcome opens by itself (REPLAN 34: once per person, no
 * forced steps). It waits for the person's preferences and the server's
 * tasks, so a new device never flashes it and an empty copy isn't mistaken
 * for a new person. Someone who already made tasks here is marked as having
 * seen it, quietly ("stay out of the way for experienced people").
 */
export function welcomeDecision(gate: WelcomeGate): WelcomeDecision {
  if (!gate.prefsReady) return "wait";
  if (gate.welcomeSeen) return "none";
  if (!gate.tasksReady) return "wait";
  return gate.hasOwnTasks ? "skip-experienced" : "show";
}

/**
 * The three teaching tasks (REPLAN 34) for whoever creates the workspace:
 * things to do, each one a gesture, filed in their Inbox. `capture` is the
 * capture shortcut as this device writes it ("⌘⇧K" or "Ctrl Shift K").
 */
export function teachingTaskTitles(capture: string): string[] {
  return [
    `Press ${capture} anywhere to capture a task`,
    "Type @, # or / in a task’s name to assign, tag or date it",
    "Press Q on this task to line it up in Focus",
  ];
}

/**
 * The teaching tasks and the starter go only into a workspace you own that
 * has nothing in it yet (REPLAN 34: "seeded once, for whoever creates the
 * workspace"): never into a prepared or shared one.
 */
export function shouldSeedWorkspace(input: {
  isOwner: boolean;
  canEdit: boolean;
  tasksReady: boolean;
  seededAlready: boolean;
  /** Tasks in the workspace you can see (any status). */
  taskCount: number;
  /** Projects besides the Inbox. */
  projectCount: number;
}): boolean {
  return (
    input.isOwner &&
    input.canEdit &&
    input.tasksReady &&
    !input.seededAlready &&
    input.taskCount === 0 &&
    input.projectCount === 0
  );
}
