// TV-H1 — "Upcoming" widget: Tasks' Upcoming (TV-U15) as a glance. The same
// coverage (your dated work and unassigned work you can plan, without Backlog
// or other teams' unclaimed tasks), the same order and day groups (Earlier ·
// Today · Tomorrow · Thu … · Later), open tasks only, and only the days that
// hold work. Each row says when ("3:00 PM · 45m", "due Thu", "Oct 8 · late").
// Rows open the task.

import { Paperclip } from "lucide-react";
import { Fragment, useMemo, useRef } from "react";

import { MetaCount } from "@/components/ui/meta-count";
import { filesLabel } from "@/features/attachments/files";
import { fitUpcoming, upcomingForHome } from "@/features/tasks/home";
import { teamIdsOf } from "@/features/tasks/teams";
import { upcomingWhen } from "@/features/tasks/upcoming";
import { nowOn, useToday } from "@/features/tasks/use-today";
import { useAuth } from "@/providers/auth-provider";

import { useDashboardSource } from "../../context/dashboard-data-context";
import { useDensity } from "../../hooks/use-density";
import { useRowsThatFit } from "../../hooks/use-rows-that-fit";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { openEntity, openModuleRoute } from "../../widget-nav";
import {
  WidgetBodyRoot,
  WidgetEmpty,
  WidgetGroupLabel,
  WidgetList,
  WidgetLoading,
  WidgetMore,
  WidgetRow,
} from "./widget-primitives";

export function UpcomingWidget({ size }: WidgetComponentProps) {
  const tasks = useDashboardSource("tasks");
  const taskFiles = useDashboardSource("taskFiles");
  const { userId } = useAuth();
  const density = useDensity();
  const today = useToday();
  // The rows the cell really holds (a day's header counts as one): the
  // density budget is only the floor, so a tall cell isn't left mostly empty.
  const bodyRef = useRef<HTMLDivElement>(null);
  const fits = useRowsThatFit(bodyRef);

  const { buckets, teamMembers } = tasks.data;
  const groups = useMemo(() => {
    // `today` re-groups the days at midnight.
    const now = nowOn(today);
    const rank = new Map(buckets.map((b, i) => [b.id, i]));
    return upcomingForHome(
      tasks.data.tasks,
      { me: userId, myTeams: teamIdsOf(teamMembers ?? [], userId) },
      now,
      (id) => rank.get(id) ?? Number.MAX_SAFE_INTEGER,
    );
  }, [tasks.data.tasks, buckets, teamMembers, userId, today]);

  if (tasks.loading && tasks.data.tasks.length === 0) return <WidgetLoading />;
  if (groups.length === 0) return <WidgetEmpty>Nothing coming up.</WidgetEmpty>;

  // Each day's header takes a row of the budget.
  const { shown, hidden } = fitUpcoming(
    groups,
    Math.max(widgetRowBudget(size, density), fits ?? 0),
  );
  const now = new Date();

  return (
    <WidgetBodyRoot>
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        {shown.map((g) => (
          <Fragment key={g.key}>
            <WidgetGroupLabel count={g.count}>{g.label}</WidgetGroupLabel>
            <WidgetList className="pt-0">
              {g.rows.map((task) => {
                const when = upcomingWhen(task, now);
                // The 📎 mark (AT-3) sits before when it's due.
                const files = taskFiles?.get(task.id) ?? 0;
                return (
                  <WidgetRow
                    key={task.id}
                    title={task.title}
                    trailing={
                      files > 0 ? (
                        <span className="inline-flex items-center gap-2">
                          <MetaCount icon={Paperclip} count={files} label={filesLabel} />
                          {when}
                        </span>
                      ) : (
                        (when ?? undefined)
                      )
                    }
                    onClick={() => openEntity("task", task.id)}
                  />
                );
              })}
            </WidgetList>
          </Fragment>
        ))}
      </div>
      <WidgetMore count={hidden} onClick={() => openModuleRoute("/tasks", { place: "upcoming" })} />
    </WidgetBodyRoot>
  );
}
