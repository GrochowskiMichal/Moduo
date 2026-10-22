// Teams route work (tasks-v3 §1, REPLAN 54, 94, 95, defaults s and t;
// TV-D13). A task gets an optional team next to its one assignee; members
// see the team's unclaimed tasks ("For Design · 2 unclaimed") and take one
// with `tasks_op_claim`. Routing shares nothing: a member sees a routed task
// only where they could see it anyway. Pure helpers, so My tasks (TV-U15),
// Upcoming and the Home team-load widget (TV-H1) read teams the same way.

import { isBacklogTask, isOpenTask } from "@contracts/vocabularies";

import { AVATAR_HUES, type AvatarHue, avatarHue } from "../../components/ui/avatar";
import type { Task, Team, TeamMember } from "./model";

/** The teams a person is in. */
export function teamIdsOf(
  members: readonly Pick<TeamMember, "teamId" | "userId">[],
  userId: string | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  if (!userId) return ids;
  for (const m of members) if (m.userId === userId) ids.add(m.teamId);
  return ids;
}

/** A team task nobody has taken yet, still to do (To do or In progress:
 *  Backlog is parked, like the notices and check-backs treat it). */
export function isUnclaimed(
  task: Pick<Task, "teamId" | "assigneeId" | "status" | "statusCategory" | "deletedAt">,
): boolean {
  return (
    !!task.teamId && !task.assigneeId && !task.deletedAt && isOpenTask(task) && !isBacklogTask(task)
  );
}

export type UnclaimedGroup = { team: Team; tasks: Task[] };

/**
 * "For Design · 2 unclaimed": per team the person is in (in name order), the
 * open tasks routed to it that nobody has taken. Teams with none are left out.
 */
export function unclaimedForMe(
  tasks: readonly Task[],
  teams: readonly Team[],
  members: readonly Pick<TeamMember, "teamId" | "userId">[],
  userId: string | null | undefined,
): UnclaimedGroup[] {
  const mine = teamIdsOf(members, userId);
  if (mine.size === 0) return [];
  const byTeam = new Map<string, Task[]>();
  for (const task of tasks) {
    if (!task.teamId || !mine.has(task.teamId) || !isUnclaimed(task)) continue;
    const list = byTeam.get(task.teamId);
    if (list) list.push(task);
    else byTeam.set(task.teamId, [task]);
  }
  return teams
    .filter((t) => byTeam.has(t.id))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((team) => ({ team, tasks: byTeam.get(team.id) ?? [] }));
}

/**
 * Upcoming leaves out unassigned tasks routed to a team you're not in
 * (default t): they're that team's to take, not yours to plan.
 */
export function isOtherTeamsWork(
  task: Pick<Task, "teamId" | "assigneeId">,
  myTeams: ReadonlySet<string>,
): boolean {
  return !!task.teamId && !task.assigneeId && !myTeams.has(task.teamId);
}

const HUES: ReadonlySet<string> = new Set(AVATAR_HUES);

/** A team's colour: the one picked for it, else a stable one from its id (95). */
export function teamHue(team: Pick<Team, "id" | "name" | "color">): AvatarHue {
  return team.color && HUES.has(team.color)
    ? (team.color as AvatarHue)
    : avatarHue(team.id || team.name);
}

/** The colours a team can pick (people and teams share them; gray and red are kept for "nobody" and errors). */
export const TEAM_COLOR_OPTIONS: ReadonlyArray<{ value: AvatarHue; label: string }> =
  AVATAR_HUES.map((value) => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }));
