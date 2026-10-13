// My tasks and All (tasks-v3 §8, calls 84 and 54, research §8; TV-U15).
// Pure: no React, no IO.
//
// - My tasks: tasks assigned to you in every project, by status in focus
//   order (In progress · To do), each sorted by date then priority with
//   waiting tasks at the end, then "Backlog · n" folded; date groups are one
//   Display choice away. On top, the team block: per team you're in, its
//   unclaimed tasks ("For Design · 2 unclaimed"), up to five rows then
//   "Show n more"; Take it assigns the task to you and keeps the team.
// - All: every task in projects you can see, never an Inbox, grouped by
//   project in the sidebar's order (areas as quiet dividers); On hold and
//   Done projects start folded.

import { isOpenTask } from "@contracts/vocabularies";
import { LEVEL_ORDER, rowDateOf } from "./helpers";
import type { Bucket, Task, Team, TeamMember } from "./model";

/**
 * My tasks' scope: assigned to you, Won't do left out (the one kept in view
 * comes back through `keep`), Backlog in (the List folds it behind its
 * line, U10-12). Done stays (Display hides it behind "N completed").
 */
export function myTasksView(
  tasks: readonly Task[],
  me: string | null,
  keep: (task: Task) => boolean = () => false,
): Task[] {
  if (!me) return [];
  return tasks.filter((t) => t.assigneeId === me && (t.status !== "archived" || keep(t)));
}

const PRIORITY_RANK: Record<string, number> = Object.fromEntries(
  LEVEL_ORDER.map((level, i) => [level, i]),
);

/**
 * My tasks' own order (research §8): by date (the row's date, earliest
 * first, none last), then priority (high to none); a task waiting on
 * someone or something sinks to the end of its group. Stable.
 */
export function orderMyTasks<T extends Task>(
  tasks: readonly T[],
  waiting: ReadonlySet<string>,
): T[] {
  const dateOf = (t: Task) => rowDateOf(t)?.getTime() ?? Number.POSITIVE_INFINITY;
  return tasks
    .map((task, index) => ({ task, index, at: dateOf(task), waits: waiting.has(task.id) }))
    .sort((a, b) => {
      if (a.waits !== b.waits) return a.waits ? 1 : -1;
      if (a.at !== b.at) return a.at < b.at ? -1 : 1;
      const pa = a.task.priority ? (PRIORITY_RANK[a.task.priority] ?? 3) : 3;
      const pb = b.task.priority ? (PRIORITY_RANK[b.task.priority] ?? 3) : 3;
      if (pa !== pb) return pa - pb;
      return a.index - b.index;
    })
    .map(({ task }) => task);
}

/** One team's block on top of My tasks: its tasks nobody has taken yet. */
export type TeamBlock = { team: Team; tasks: Task[] };

/**
 * "For Design · 2 unclaimed" (54): per team you're in (name order), its open
 * tasks with no assignee, ordered by date. Teams with none are left out.
 */
export function teamBlocks(
  tasks: readonly Task[],
  teams: readonly Team[],
  members: readonly Pick<TeamMember, "teamId" | "userId">[],
  me: string | null,
): TeamBlock[] {
  if (!me) return [];
  const mine = new Set(members.filter((m) => m.userId === me).map((m) => m.teamId));
  if (mine.size === 0) return [];
  const byTeam = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.teamId || !mine.has(task.teamId) || task.assigneeId || task.deletedAt) continue;
    if (!isOpenTask(task)) continue;
    const list = byTeam.get(task.teamId);
    if (list) list.push(task);
    else byTeam.set(task.teamId, [task]);
  }
  return teams
    .filter((t) => byTeam.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => ({ team, tasks: orderMyTasks(byTeam.get(team.id) ?? [], new Set()) }));
}

/** The team block's rows before "Show n more" (research §8). */
export const TEAM_BLOCK_ROWS = 5;

/**
 * All's scope (research §8): every task in projects you can see, never your
 * Inbox (20). A task assigned to you in a project you can't see stays (it
 * reads "Private project", AC1.10).
 */
export function allView(
  tasks: readonly Task[],
  inboxId: string | null,
  live: (task: Task) => boolean,
): Task[] {
  return tasks.filter((t) => t.bucketId !== inboxId && live(t));
}

/**
 * All's project order: the sidebar's, area by area (areas in their order,
 * then projects with no area), so the groups read like the sidebar.
 */
export function allProjectOrder(
  buckets: readonly Pick<Bucket, "id" | "areaId">[],
  areaIds: readonly string[],
): string[] {
  const known = new Set(areaIds);
  const byArea = new Map<string | null, string[]>();
  for (const b of buckets) {
    const area = b.areaId && known.has(b.areaId) ? b.areaId : null;
    const list = byArea.get(area);
    if (list) list.push(b.id);
    else byArea.set(area, [b.id]);
  }
  return [...areaIds.flatMap((id) => byArea.get(id) ?? []), ...(byArea.get(null) ?? [])];
}

/** On hold and Done projects start folded in All, dimmed, never hidden (16). */
export function startsFolded(bucket: Pick<Bucket, "status"> | undefined): boolean {
  return bucket?.status === "on_hold" || bucket?.status === "done";
}
