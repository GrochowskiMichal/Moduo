// TV-H1 — "Team" widget (decision 12, Chat's CH70): one row per person, with
// Chat's "now" line (Active · Focusing · Away · a saved status) above Tasks'
// load: Focus size and its estimated time, in progress, waiting, due this
// week. Ownership, never surveillance: nothing about runs or tracked time per
// person. Counts are over the reader's copy of the shared store, so they only
// ever include tasks the reader can see. Teams with unclaimed work follow the
// people. `config.teamId` narrows it to one team.

import { useContext, useMemo } from "react";

import { PersonAvatar, TeamMark } from "@/components/ui/avatar";
import { canBeAssignee } from "@/features/sharing/rules";
import { loadLine, type TeamPerson, teamLoad } from "@/features/tasks/home";
import { teamHue } from "@/features/tasks/teams";
import { reportRange } from "@/features/tasks/time-report";
import { useToday } from "@/features/tasks/use-today";
import { WorkspaceContext } from "@/features/workspaces/workspace-context";
import { formatDuration } from "@/lib/time-format";
import { useTimeRegion } from "@/lib/time-region";
import { cn } from "@/lib/utils";
import { useAuth } from "@/providers/auth-provider";

import { useDashboardData } from "../../context/dashboard-data-context";
import type { WidgetComponentProps } from "../../registry/types";
import { teamNowLine } from "../../team-now";
import { WidgetBodyRoot, WidgetEmpty, WidgetGroupLabel, WidgetLoading } from "./widget-primitives";

const NO_MEMBERS: never[] = [];

export function TeamWidget({ widget, size }: WidgetComponentProps) {
  const { tasks, taskQueue, taskWaiting, workspaceId } = useDashboardData();
  const members = useContext(WorkspaceContext)?.members ?? NO_MEMBERS;
  const { userId } = useAuth();
  const { weekStartsOn } = useTimeRegion();
  const today = useToday();
  // Chat's line (CH70); registered once at start, so it's stable here.
  const NowLine = teamNowLine();

  const teamId = typeof widget.config.teamId === "string" ? widget.config.teamId : null;
  const teams = tasks.data.teams ?? NO_MEMBERS;
  const teamMembers = tasks.data.teamMembers ?? NO_MEMBERS;

  const people = useMemo<TeamPerson[]>(
    () =>
      members
        .filter((m) => m.isActive && !m.removedAt)
        .map((m) => ({
          userId: m.userId,
          name: m.displayName?.trim() || null,
          avatarUrl: m.avatarUrl,
          canTakeTasks: canBeAssignee(m.perms),
        })),
    [members],
  );
  const waitingTaskIds = useMemo(
    () => new Set(taskWaiting.data.map((w) => w.taskId)),
    [taskWaiting.data],
  );
  const load = useMemo(() => {
    const [y, m, d] = today.split("-").map(Number);
    const weekEnd = reportRange(
      "this_week",
      new Date(y ?? 0, (m ?? 1) - 1, d ?? 1),
      weekStartsOn,
    ).to;
    return teamLoad({
      tasks: tasks.data.tasks,
      queue: taskQueue.data,
      waitingTaskIds,
      people,
      teamMembers,
      teamIds: teams.map((t) => t.id),
      teamId,
      me: userId,
      weekEnd,
    });
  }, [
    today,
    weekStartsOn,
    tasks.data.tasks,
    taskQueue.data,
    waitingTaskIds,
    people,
    teamMembers,
    teams,
    teamId,
    userId,
  ]);

  if (tasks.loading && tasks.data.tasks.length === 0) return <WidgetLoading />;
  if (load.rows.length === 0) return <WidgetEmpty>No one to show yet.</WidgetEmpty>;

  const team = teamId ? teams.find((t) => t.id === teamId) : undefined;
  const compact = size === "S";

  return (
    <WidgetBodyRoot>
      {team && !compact ? <WidgetGroupLabel>{team.name}</WidgetGroupLabel> : null}
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <ul className="flex flex-col gap-0.5 p-1.5">
          {load.rows.map((row) => {
            const name = row.name ?? "Member";
            return (
              <li
                key={row.userId}
                data-person={row.userId}
                className="flex min-h-[var(--row-h)] items-start gap-2 rounded-md px-2 py-1"
              >
                <PersonAvatar
                  name={row.name ?? ""}
                  id={row.userId}
                  src={row.avatarUrl}
                  size={compact ? "icon" : "sm"}
                  className="mt-0.5"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="min-w-0 truncate text-sm text-foreground">{name}</span>
                  {/* Chat's "now" line (CH70): empty until Chat registers it. */}
                  {NowLine && workspaceId ? (
                    <NowLine workspaceId={workspaceId} userId={row.userId} size={size} />
                  ) : null}
                  <span
                    data-team-load=""
                    className={cn(
                      "min-w-0 text-xs text-muted-foreground",
                      compact ? "truncate" : "line-clamp-2",
                    )}
                  >
                    {loadLine(row, formatDuration)}
                  </span>
                </div>
              </li>
            );
          })}
          {load.unclaimed.map(({ teamId: id, count }) => {
            const t = teams.find((x) => x.id === id);
            if (!t) return null;
            return (
              <li
                key={`team-${id}`}
                data-team={id}
                className="flex min-h-[var(--row-h)] items-center gap-2 rounded-md px-2 py-1"
              >
                <TeamMark
                  name={t.name}
                  id={t.id}
                  letters={t.mark}
                  color={teamHue(t)}
                  size={compact ? "icon" : "sm"}
                />
                <span className="min-w-0 truncate text-sm text-foreground">{t.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                  {count} unclaimed
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </WidgetBodyRoot>
  );
}
