// TV-H1 — the time widget (type id `timetracking`, kept so placed widgets carry
// over): your tracked task time this week, on web and desktop (tasks-v2 §17).
// It reads TV-D14's report for this week (Time & region's week and zone) and
// keeps only your own entries, even for the workspace owner: per-person time
// stays off Home (decision 12). The desktop window tracker it used to read
// stays dormant. Rows open the task.

import { useMemo } from "react";

import { todayStr } from "@/features/tasks/helpers";
import { weekTime } from "@/features/tasks/home";
import { dayIn } from "@/features/tasks/project-overview";
import { formatDurationSeconds } from "@/lib/time-format";
import { useTimeRegion } from "@/lib/time-region";

import { useDashboardData } from "../../context/dashboard-data-context";
import { useDensity } from "../../hooks/use-density";
import type { WidgetComponentProps } from "../../registry/types";
import { widgetRowBudget } from "../../widget-density";
import { openEntity, openModuleRoute } from "../../widget-nav";
import {
  WidgetBodyRoot,
  WidgetEmpty,
  WidgetList,
  WidgetLoading,
  WidgetMore,
  WidgetRow,
} from "./widget-primitives";

export function TimetrackingWidget({ size }: WidgetComponentProps) {
  const { timeReport } = useDashboardData();
  const density = useDensity();
  const { timeZone } = useTimeRegion();

  // The report dates entries in Time & region's zone; today is that zone's day.
  const week = useMemo(
    () => weekTime(timeReport.data, dayIn(new Date().toISOString(), timeZone) ?? todayStr()),
    [timeReport.data, timeZone],
  );

  if (timeReport.loading && timeReport.data.length === 0) return <WidgetLoading />;
  if (week.weekSeconds === 0) return <WidgetEmpty>No time tracked this week.</WidgetEmpty>;

  const summary =
    week.todaySeconds > 0
      ? `this week · ${formatDurationSeconds(week.todaySeconds)} today`
      : "this week";

  if (size === "S") {
    return (
      <div className="grid h-full place-items-center px-3 text-center">
        <div className="flex flex-col items-center gap-1">
          <p className="font-display text-2xl font-semibold tabular-nums text-foreground">
            {formatDurationSeconds(week.weekSeconds)}
          </p>
          <p className="text-xs text-muted-foreground">{summary}</p>
        </div>
      </div>
    );
  }

  // One row goes to the total line.
  const budget = Math.max(1, widgetRowBudget(size, density) - 1);
  const shown = week.lines.slice(0, budget);
  const overflow = week.lines.length - shown.length;

  return (
    <WidgetBodyRoot>
      <div className="flex items-baseline gap-2 px-3.5 pt-2">
        <span className="font-display text-xl font-semibold tabular-nums text-foreground">
          {formatDurationSeconds(week.weekSeconds)}
        </span>
        <span className="text-xs text-muted-foreground">{summary}</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
        <WidgetList>
          {shown.map((line) => (
            <WidgetRow
              key={line.taskId}
              title={line.title}
              secondary={size === "L" ? (line.project ?? "Private project") : undefined}
              trailing={formatDurationSeconds(line.seconds)}
              onClick={() => openEntity("task", line.taskId)}
            />
          ))}
        </WidgetList>
      </div>
      <WidgetMore count={overflow} onClick={() => openModuleRoute("/tasks")} />
    </WidgetBodyRoot>
  );
}
