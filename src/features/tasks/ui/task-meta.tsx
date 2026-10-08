// The quiet marks rows and cards share (tasks-v2 §6, TV-U1): the counts after
// a title, the bucket as dot + name, the one date, and the "N completed" line.

import { CircleDashed, Clock, Hash, Inbox, ListChecks, ListTree, Repeat } from "lucide-react";
import type { ReactNode } from "react";
import { MetaCount, MetaCounts } from "../../../components/ui/meta-count";
import { NavRowDot } from "../../../components/ui/nav-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { completedLabel } from "../completed";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { Task } from "../model";
import { recurrenceLabel } from "../parse/recurrence";
import type { RowDate } from "../row-layout";

// ── blocked marker (computed, ambient — dim/quiet, never red; spec §5c) ───────

export function BlockedMarker({
  taskId,
  api,
  iconClassName = "size-3.5",
}: {
  taskId: string;
  api: Pick<TasksModuleApi, "blockersByTask">;
  iconClassName?: string;
}) {
  const openBlockers = (api.blockersByTask.get(taskId) ?? []).filter(
    (b) => b.status !== "done" && b.status !== "archived",
  );
  const label =
    openBlockers.length === 1
      ? `Blocked by “${openBlockers[0].title || "Untitled"}”`
      : `Blocked by ${openBlockers.length} tasks`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center" role="img" aria-label={label}>
          <CircleDashed className={iconClassName} aria-hidden />
        </span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Wraps a mark in a tooltip; the mark itself stays the accessible name. */
function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/**
 * The counts right after a title, in their fixed order: `# tags` · subtasks
 * done/total · blocked · repeats. Muted, each hidden at zero. Tags are a count
 * here, never chips (U1-2); their names are in the tooltip. Attachments (📎)
 * and comments (💬) join between tags and subtasks when their data lands
 * (AT-3, TV-U3).
 */
export function TaskCounts({
  task,
  api,
  className,
}: {
  task: Task;
  api: Pick<
    TasksModuleApi,
    "tagsByTask" | "subtaskProgressByTask" | "blockedTaskIds" | "blockersByTask"
  >;
  className?: string;
}) {
  const tags = api.tagsByTask.get(task.id) ?? [];
  const progress = api.subtaskProgressByTask.get(task.id) ?? null;
  const blocked = api.blockedTaskIds.has(task.id);
  if (tags.length === 0 && !progress?.total && !blocked && !task.recurrence) return null;
  return (
    <MetaCounts className={className}>
      {tags.length > 0 ? (
        <Tip label={tags.map((t) => `#${t.name}`).join(" ")}>
          <MetaCount
            icon={Hash}
            count={tags.length}
            label={(n) => (n === 1 ? `1 tag: ${tags[0].name}` : `${n} tags`)}
          />
        </Tip>
      ) : null}
      {progress && progress.total > 0 ? (
        <MetaCount
          icon={ListTree}
          count={progress.total}
          value={`${progress.done}/${progress.total}`}
          label={() => `${progress.done} of ${progress.total} subtasks done`}
        />
      ) : null}
      {blocked ? <BlockedMarker taskId={task.id} api={api} iconClassName="size-icon-xs" /> : null}
      {task.recurrence ? (
        <Tip label={recurrenceLabel(task.recurrence)}>
          <span className="flex items-center text-muted-foreground" role="img" aria-label="Repeats">
            <Repeat className="size-icon-xs" aria-hidden />
          </span>
        </Tip>
      ) : null}
    </MetaCounts>
  );
}

/**
 * The bucket as plain muted text (dot + name, never a pill), shown only where
 * the bucket isn't implied by the scope or the grouping (tasks-v2 §6, Q1-3).
 */
export function BucketLabel({
  name,
  isInbox,
  className,
}: {
  name: string;
  isInbox: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1.5 font-sans text-xs text-muted-foreground",
        className,
      )}
    >
      {isInbox ? (
        <Inbox className="size-icon-xs shrink-0" aria-hidden />
      ) : (
        <NavRowDot className="size-1.5" />
      )}
      <span className="truncate">{name}</span>
    </span>
  );
}

/** The one date on a row or card: a scheduled time carries a clock. */
export function DateMark({ date, className }: { date: RowDate; className?: string }) {
  return (
    <span
      className={cn(
        "flex min-w-0 items-center gap-1 font-sans text-xs tabular-nums",
        // Drift is ambient: quiet emphasis, never red.
        date.drifted ? "text-foreground" : "text-muted-foreground",
        className,
      )}
    >
      {date.kind === "scheduled" ? <Clock className="size-icon-xs shrink-0" aria-hidden /> : null}
      <span className="truncate">{date.label}</span>
    </span>
  );
}

/**
 * The quiet line that ends a list or group whose completed tasks Display
 * hides: "5 completed · show". Once shown, it offers "hide" again.
 */
export function CompletedLine({
  count,
  shown,
  onToggle,
  className,
}: {
  count: number;
  shown: boolean;
  onToggle: () => void;
  className?: string;
}) {
  if (count <= 0) return null;
  const label = completedLabel(count);
  return (
    <div
      className={cn(
        "flex min-h-(--row-h-sm) items-center gap-2 px-2.5 font-sans text-xs text-muted-foreground",
        className,
      )}
    >
      <ListChecks className="size-icon-xs shrink-0" aria-hidden />
      <button
        type="button"
        aria-expanded={shown}
        aria-label={`${label}, ${shown ? "hide" : "show"}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className="rounded-sm tabular-nums transition-colors duration-(--motion-fade) ease-(--ease-out) hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {label} · {shown ? "hide" : "show"}
      </button>
    </div>
  );
}
