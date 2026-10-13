// A project's overview (TV-U16, spec §3, REPLAN 16 and 78): the numbers and
// lists the right panel's Project view shows, and a client's hub rolls up.
// Pure: everything is read from the shared store's rows the reader already
// has, so a project shows only what its reader can see.

import { isClosedTask, isOpenTask, taskCategoryOf } from "@contracts/vocabularies";

import { toFloating } from "../../lib/zoned-time";
import type {
  Bucket,
  Section,
  Task,
  TaskCompletion,
  TaskWaitingEntry,
  Team,
  TeamMember,
} from "./model";

const live = (t: Task) => !t.deletedAt;

/** A project's live tasks (subtasks too). */
export function tasksOfProject(tasks: readonly Task[], projectId: string): Task[] {
  return tasks.filter((t) => t.bucketId === projectId && live(t));
}

/** A project's numbers, from its live tasks (subtasks count as tasks). */
export function projectFacts(tasks: readonly Task[], projectId: string) {
  const mine = tasksOfProject(tasks, projectId);
  const counted = mine.filter((t) => taskCategoryOf(t) !== "backlog");
  const done = counted.filter((t) => taskCategoryOf(t) === "done").length;
  const closed = counted.filter((t) => isClosedTask(t)).length;
  return {
    total: counted.length - (closed - done),
    done,
    open: counted.filter((t) => !isClosedTask(t)).length,
    inProgress: counted.filter((t) => taskCategoryOf(t) === "in_progress").length,
    backlog: mine.length - counted.length,
  };
}

const dueKey = (t: Task) => t.dueOn ?? t.dueDate?.slice(0, 10) ?? null;

/**
 * What's next in a project: its open top-level tasks (To do and In progress),
 * work already started first, then by due date (dated before undated), then
 * in the project's own order (section, then place). `rest` counts the others.
 */
export function nextUp(
  tasks: readonly Task[],
  projectId: string,
  sections: readonly Section[],
  limit = 5,
): { tasks: Task[]; rest: number } {
  const sectionPos = new Map(
    sections.filter((s) => s.projectId === projectId).map((s) => [s.id, s.position]),
  );
  const open = tasksOfProject(tasks, projectId).filter((t) => !t.parentId && isOpenTask(t));
  const sorted = [...open].sort((a, b) => {
    const started =
      Number(taskCategoryOf(b) === "in_progress") - Number(taskCategoryOf(a) === "in_progress");
    if (started) return started;
    const da = dueKey(a);
    const db = dueKey(b);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return da < db ? -1 : 1;
    }
    // Tasks outside a section come first, as in the List.
    const sa = a.sectionId ? (sectionPos.get(a.sectionId) ?? 0) + 1 : 0;
    const sb = b.sectionId ? (sectionPos.get(b.sectionId) ?? 0) + 1 : 0;
    if (sa !== sb) return sa - sb;
    return a.position < b.position ? -1 : a.position > b.position ? 1 : 0;
  });
  return { tasks: sorted.slice(0, limit), rest: Math.max(0, sorted.length - limit) };
}

export type SectionProgress = {
  section: Section;
  done: number;
  total: number;
  open: number;
};

/** Each section in order with how far it is ("2 of 5"); Backlog and Won't
 *  do don't count toward the total, as in the project's own progress. */
export function sectionProgress(
  tasks: readonly Task[],
  projectId: string,
  sections: readonly Section[],
): SectionProgress[] {
  const mine = tasksOfProject(tasks, projectId);
  return sections
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => a.position - b.position)
    .map((section) => {
      const inIt = mine.filter((t) => t.sectionId === section.id);
      const facts = projectFacts(
        inIt.map((t) => ({ ...t, bucketId: projectId })),
        projectId,
      );
      return { section, done: facts.done, total: facts.total, open: facts.open };
    });
}

export type ProjectPerson = { userId: string; open: number; lead: boolean };

/**
 * Who's on a project: its lead, then everyone with open work in it (Backlog
 * included: it's theirs), most open work first.
 */
export function projectPeople(
  tasks: readonly Task[],
  projectId: string,
  leadId: string | null | undefined,
): ProjectPerson[] {
  const counts = new Map<string, number>();
  for (const t of tasksOfProject(tasks, projectId)) {
    if (!t.assigneeId || isClosedTask(t)) continue;
    counts.set(t.assigneeId, (counts.get(t.assigneeId) ?? 0) + 1);
  }
  const people: ProjectPerson[] = [...counts].map(([userId, open]) => ({
    userId,
    open,
    lead: userId === leadId,
  }));
  if (leadId && !counts.has(leadId)) people.push({ userId: leadId, open: 0, lead: true });
  return people.sort((a, b) => Number(b.lead) - Number(a.lead) || b.open - a.open);
}

/** The calendar day of a moment in `zone` (YYYY-MM-DD), as the time report
 *  dates its entries. */
export function dayIn(at: string, zone: string | null | undefined): string | null {
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return null;
  return toFloating(d, zone).toISOString().slice(0, 10);
}

/**
 * How many tasks of a project were finished in a range of days ("Done this
 * month · 14"): every completion (each cycle of a repeat counts), dated in
 * the reader's zone; a reopened task's completion is taken back. A done task
 * read before completions were kept counts by its `completedAt`.
 */
export function doneInRange(
  tasks: readonly Task[],
  completions: readonly TaskCompletion[],
  projectId: string,
  range: { from: string; to: string },
  zone: string | null | undefined,
): number {
  const ids = new Set(tasksOfProject(tasks, projectId).map((t) => t.id));
  const within = (at: string | null | undefined) => {
    const day = at ? dayIn(at, zone) : null;
    return day !== null && day >= range.from && day <= range.to;
  };
  const recorded = new Set<string>();
  let count = 0;
  for (const c of completions) {
    if (!ids.has(c.taskId)) continue;
    recorded.add(c.taskId);
    if (!c.deletedAt && within(c.completedAt)) count += 1;
  }
  for (const t of tasks) {
    if (!ids.has(t.id) || recorded.has(t.id)) continue;
    if (taskCategoryOf(t) === "done" && within(t.completedAt)) count += 1;
  }
  return count;
}

export type WaitingLine = { task: Task; entries: TaskWaitingEntry[]; since: string };

/** A project's unfinished tasks that wait on someone or something, the
 *  longest-waiting first. */
export function waitingIn(
  tasks: readonly Task[],
  waiting: readonly TaskWaitingEntry[],
  projectIds: ReadonlySet<string>,
): WaitingLine[] {
  const byTask = new Map<string, TaskWaitingEntry[]>();
  for (const w of waiting) {
    const list = byTask.get(w.taskId);
    if (list) list.push(w);
    else byTask.set(w.taskId, [w]);
  }
  const lines: WaitingLine[] = [];
  for (const t of tasks) {
    if (!live(t) || !projectIds.has(t.bucketId) || isClosedTask(t)) continue;
    const entries = byTask.get(t.id);
    if (!entries?.length) continue;
    const since = entries.reduce((min, e) => (e.since < min ? e.since : min), entries[0].since);
    lines.push({ task: t, entries, since });
  }
  return lines.sort((a, b) => (a.since < b.since ? -1 : a.since > b.since ? 1 : 0));
}

export type ActivityLine = {
  kind: "done" | "added";
  task: Task;
  /** Who finished or added it (null: unknown). */
  userId: string | null;
  at: string;
};

/**
 * What happened lately in a project, from what the reader's copy holds:
 * tasks finished (each completion) and tasks added, newest first. Comments
 * aren't here: the copy keeps only that a task has them, not who wrote them.
 */
export function recentActivity(
  tasks: readonly Task[],
  completions: readonly TaskCompletion[],
  projectId: string,
  limit = 6,
): ActivityLine[] {
  const mine = new Map(tasksOfProject(tasks, projectId).map((t) => [t.id, t]));
  const lines: ActivityLine[] = [];
  const recorded = new Set<string>();
  for (const c of completions) {
    const task = mine.get(c.taskId);
    if (!task) continue;
    recorded.add(c.taskId);
    if (c.deletedAt) continue;
    lines.push({ kind: "done", task, userId: c.userId, at: c.completedAt });
  }
  for (const task of mine.values()) {
    if (!recorded.has(task.id) && taskCategoryOf(task) === "done" && task.completedAt) {
      lines.push({ kind: "done", task, userId: task.completedBy ?? null, at: task.completedAt });
    }
    lines.push({
      kind: "added",
      task,
      userId: task.creatorUnknown ? null : task.creatorId || null,
      at: task.createdAt,
    });
  }
  return lines.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

// ── A client's hub (AC6.4) ──────────────────────────────────────────────────

export type ClientRollup = {
  projects: { project: Bucket; open: number }[];
  /** Open tasks across them (To do and In progress, subtasks too). */
  open: number;
  /** The next few, by due date (dated first). */
  next: Task[];
  waiting: WaitingLine[];
};

/** What a client's hub rolls up: the live projects they're the client of,
 *  their open work, what's next and what waits. */
export function clientRollup(
  buckets: readonly Bucket[],
  tasks: readonly Task[],
  waiting: readonly TaskWaitingEntry[],
  contactId: string,
  limit = 3,
): ClientRollup {
  const projects = buckets.filter(
    (b) => b.clientContactId === contactId && !b.isSystem && !b.deletedAt && !b.archivedAt,
  );
  const ids = new Set(projects.map((p) => p.id));
  const openTasks = tasks.filter((t) => live(t) && ids.has(t.bucketId) && isOpenTask(t));
  const next = openTasks
    .filter((t) => !t.parentId)
    .sort((a, b) => {
      const da = dueKey(a);
      const db = dueKey(b);
      if (da === db) return a.title.localeCompare(b.title);
      if (da === null) return 1;
      if (db === null) return -1;
      return da < db ? -1 : 1;
    })
    .slice(0, limit);
  return {
    projects: projects
      .map((project) => ({
        project,
        open: openTasks.filter((t) => t.bucketId === project.id).length,
      }))
      .sort((a, b) => a.project.name.localeCompare(b.project.name)),
    open: openTasks.length,
    next,
    waiting: waitingIn(tasks, waiting, ids),
  };
}

// ── Someone leaving the workspace (AC5.6, REPLAN 78) ────────────────────────

export type DepartureSummary = {
  /** Open tasks assigned to them that the remover can see: unassigned. */
  assigned: number;
  /** …of which a team's: they go back to the team. */
  teamTasks: number;
  /** Projects they lead (that the remover can see): the lead is cleared. */
  led: string[];
  /** Teams they're in: they leave them. */
  teams: string[];
};

/** What someone leaves behind, as far as the remover's copy shows it. The
 *  server does the rest the same way (`teams_member_removed`). */
export function departureSummary(
  userId: string,
  data: {
    tasks: readonly Task[];
    buckets: readonly Bucket[];
    teams: readonly Team[];
    teamMembers: readonly TeamMember[];
  },
): DepartureSummary {
  const theirs = data.tasks.filter((t) => live(t) && t.assigneeId === userId && !isClosedTask(t));
  const teamIds = new Set(data.teamMembers.filter((m) => m.userId === userId).map((m) => m.teamId));
  return {
    assigned: theirs.length,
    teamTasks: theirs.filter((t) => !!t.teamId).length,
    led: data.buckets
      .filter((b) => b.leadId === userId && !b.isSystem && !b.deletedAt)
      .map((b) => b.name)
      .sort((a, b) => a.localeCompare(b)),
    teams: data.teams
      .filter((t) => teamIds.has(t.id))
      .map((t) => t.name)
      .sort((a, b) => a.localeCompare(b)),
  };
}

const tasksWord = (n: number) => (n === 1 ? "1 open task" : `${n} open tasks`);

function listNames(names: readonly string[]): string {
  if (names.length <= 2) return names.map((n) => `“${n}”`).join(" and ");
  return `${names
    .slice(0, 2)
    .map((n) => `“${n}”`)
    .join(", ")} and ${names.length - 2} more`;
}

/**
 * The lines a removal (or a leave) confirm says (REPLAN 78): what happens to
 * their Inbox, their tasks, the projects they lead, their teams and the
 * projects only they can see. `self` words it for someone leaving;
 * `receiver` names who gets the rest of their Inbox ("you" or the owner);
 * `owner` who gets the projects only they can see ("you" when the remover
 * owns the workspace); `fromName` is the name those projects are marked with.
 */
export function departureLines(
  summary: DepartureSummary | null,
  opts: { first: string; self: boolean; receiver: string; owner: string; fromName: string },
): string[] {
  const their = opts.self ? "your" : "their";
  const lines = [
    `Tasks in ${their} Inbox go back to the people who made them; the rest go to ${opts.receiver}.`,
  ];
  const whose = opts.self ? "Your" : `${opts.first}’s`;
  if (!summary) {
    lines.push(`${whose} open tasks here become unassigned; a team’s go back to the team.`);
  } else if (summary.assigned > 0) {
    const team =
      summary.teamTasks === 0
        ? ""
        : summary.teamTasks === summary.assigned
          ? summary.assigned === 1
            ? "; it goes back to its team"
            : "; they go back to their teams"
          : `; ${summary.teamTasks} of them go${summary.teamTasks === 1 ? "es" : ""} back to ${summary.teamTasks === 1 ? "its team" : "their teams"}`;
    const become = summary.assigned === 1 ? "becomes" : "become";
    lines.push(`${whose} ${tasksWord(summary.assigned)} here ${become} unassigned${team}.`);
  }
  if (summary && summary.led.length > 0) {
    lines.push(
      `${listNames(summary.led)} ${summary.led.length === 1 ? "loses its" : "lose their"} lead.`,
    );
  }
  if (summary && summary.teams.length > 0) {
    lines.push(`${opts.self ? "You leave" : `${opts.first} leaves`} ${listNames(summary.teams)}.`);
  }
  lines.push(
    `Projects only ${opts.self ? "you" : opts.first} can see go to ${opts.owner}, marked “From ${opts.fromName}”.`,
  );
  return lines;
}
