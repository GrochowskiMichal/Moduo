// DB-5 — "Time tracking" widget. Desktop-only (capability-gated; on web the frame
// shows an "Available on desktop" placeholder). The time-tracking runtime is
// `any`-typed, so we read entry durations defensively and sum today's total —
// worst case it degrades to the calm empty state, never a crash. A richer,
// schema-exact summary is a follow-up once verifiable on the desktop build.

import { Timer } from "lucide-react";
import { useMemo } from "react";

import { todayStr } from "@/features/tasks/helpers";

import { useDashboardData } from "../../context/dashboard-data-context";
import type { WidgetComponentProps } from "../../registry/types";
import { WidgetEmpty, WidgetLoading } from "./widget-primitives";

function toMs(value: unknown): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function entrySeconds(entry: Record<string, unknown>): number {
  const explicit = entry.durationSeconds ?? entry.seconds ?? entry.duration;
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const start = toMs(entry.startedAt ?? entry.startAt ?? entry.start);
  const end = toMs(entry.endedAt ?? entry.endAt ?? entry.end);
  if (start != null && end != null && end > start) return Math.round((end - start) / 1000);
  return 0;
}

function isToday(entry: Record<string, unknown>, today: string): boolean {
  const start = toMs(entry.startedAt ?? entry.startAt ?? entry.start ?? entry.date);
  if (start == null) return true; // no timestamp → count it (defensive)
  const d = new Date(start);
  const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return key === today;
}

function formatDuration(totalSeconds: number): string {
  const minutes = Math.round(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export function TimetrackingWidget(_props: WidgetComponentProps) {
  const { timetracking } = useDashboardData();

  const { totalSeconds, sessions } = useMemo(() => {
    const today = todayStr();
    const todays = timetracking.data.entries.filter((e) => isToday(e, today));
    return {
      totalSeconds: todays.reduce((sum, e) => sum + entrySeconds(e), 0),
      sessions: todays.length,
    };
  }, [timetracking.data.entries]);

  if (timetracking.loading && timetracking.data.entries.length === 0) return <WidgetLoading />;

  if (sessions === 0 || totalSeconds === 0) {
    return <WidgetEmpty>No time tracked today.</WidgetEmpty>;
  }

  return (
    <div className="grid h-full place-items-center px-3 text-center">
      <div className="flex flex-col items-center gap-1">
        <Timer className="size-icon-lg text-muted-foreground" aria-hidden />
        <p className="text-2xl font-display font-semibold tabular-nums text-foreground">
          {formatDuration(totalSeconds)}
        </p>
        <p className="text-xs text-muted-foreground">
          today · {sessions} {sessions === 1 ? "session" : "sessions"}
        </p>
      </div>
    </div>
  );
}
