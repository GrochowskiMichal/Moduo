// The quiet marks rows and cards share (tasks-v2 §6, TV-U1): the counts after
// a title, the bucket as dot + name, the one date, and the "N completed" line.

import {
  CircleDashed,
  Clock,
  Hourglass,
  Inbox,
  ListChecks,
  ListTree,
  MessageSquare,
  Paperclip,
  Repeat,
  Tag as TagIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { TagChipList } from "../../../components/tag-chip";
import { MetaCount, MetaCounts } from "../../../components/ui/meta-count";
import { NavRowDot } from "../../../components/ui/nav-row";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { filesLabel } from "../../attachments/files";
import { completedLabel } from "../completed";
import type { Task } from "../model";
import { recurrenceLabel } from "../parse/recurrence";
import type { RowDate } from "../row-layout";
import type { TaskFacts } from "./row-facts";

// ── blocked marker (computed, ambient — dim/quiet, never red; spec §5c) ───────

export function BlockedMarker({
  label,
  iconClassName = "size-3.5",
}: {
  /** "Blocked by …" (`blockedLabelOf`). */
  label: string;
  iconClassName?: string;
}) {
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
 * The counts right after a title, in their fixed order (tasks-v3 §4): tags ·
 * files (📎, AT-3) · comments · subtasks done/total · blocked · waiting ·
 * repeats · waiting to sync. Muted, each hidden at zero. Standard rows and
 * cards show tags as a tag icon and a count, with their names in the tooltip
 * (U1-2; the icon since MOD-97); Detailed
 * rows show up to two dot chips in its place (`tagNames`, MOD-97). Rows and
 * cards never show thumbnails. The facts are the row's own (row-facts.ts,
 * TV-D11b).
 */
type CountsFacts = Pick<TaskFacts, "tags" | "progress" | "blockedLabel"> &
  Partial<Pick<TaskFacts, "comments" | "attachments" | "waiting" | "pending">>;

/** Whether `TaskCounts` has anything to show for this task. */
export function hasTaskCounts(task: Task, facts: CountsFacts, opts: CountsOptions = {}): boolean {
  return (
    facts.tags.length > 0 ||
    (facts.attachments ?? 0) > 0 ||
    (facts.comments ?? 0) > 0 ||
    (facts.progress?.total ?? 0) > 0 ||
    facts.blockedLabel !== null ||
    (!!facts.waiting && !opts.waitingColumn) ||
    !!task.recurrence ||
    !!facts.pending
  );
}

type CountsOptions = {
  /** Show up to two tags as dot chips, then "+n" (Detailed rows). */
  tagNames?: boolean;
  /** The waiting line has a column of its own (Detailed): no mark here. */
  waitingColumn?: boolean;
};

/** How many tag chips a Detailed row shows before "+n". */
const TAG_NAMES_SHOWN = 2;

export function TaskCounts({
  task,
  facts,
  className,
  ...opts
}: {
  task: Task;
  facts: CountsFacts;
  className?: string;
} & CountsOptions) {
  if (!hasTaskCounts(task, facts, opts)) return null;
  const { tags, progress, blockedLabel, comments = 0, attachments = 0, waiting, pending } = facts;
  // The names as words ("ui, notes"): "#" is only how you type a tag (MOD-97).
  const tagList = tags.map((t) => t.name).join(", ");
  return (
    <MetaCounts className={className}>
      {tags.length > 0 && opts.tagNames ? (
        // Dot chips (MOD-97): each says "Tag: <name>" on hover and "+n" names
        // the rest, so no tooltip wraps them (it would double the hover text).
        <span data-slot="row-tag-names" className="inline-flex shrink-0 items-center">
          <TagChipList tags={tags} max={TAG_NAMES_SHOWN} />
        </span>
      ) : tags.length > 0 ? (
        // A tag icon + the number, like files, comments and subtasks (MOD-97,
        // Maciej 2026-10-15): no hue, since a dot alone means other things here.
        <Tip label={tagList}>
          <MetaCount
            icon={TagIcon}
            count={tags.length}
            label={(n) => `${n} ${n === 1 ? "tag" : "tags"}: ${tagList}`}
          />
        </Tip>
      ) : null}
      <MetaCount icon={Paperclip} count={attachments} label={filesLabel} />
      <MetaCount
        icon={MessageSquare}
        count={comments}
        label={(n) => (n === 1 ? "1 comment" : `${n} comments`)}
      />
      {progress && progress.total > 0 ? (
        <MetaCount
          icon={ListTree}
          count={progress.total}
          value={`${progress.done}/${progress.total}`}
          label={() => `${progress.done} of ${progress.total} subtasks done`}
        />
      ) : null}
      {blockedLabel !== null ? (
        <BlockedMarker label={blockedLabel} iconClassName="size-icon-xs" />
      ) : null}
      {waiting && !opts.waitingColumn ? (
        <Tip label={`Waiting ${waiting}`}>
          <span
            className="flex items-center text-muted-foreground"
            role="img"
            aria-label={`Waiting ${waiting}`}
          >
            <Hourglass className="size-icon-xs" aria-hidden />
          </span>
        </Tip>
      ) : null}
      {task.recurrence ? (
        <Tip label={recurrenceLabel(task.recurrence)}>
          <span className="flex items-center text-muted-foreground" role="img" aria-label="Repeats">
            <Repeat className="size-icon-xs" aria-hidden />
          </span>
        </Tip>
      ) : null}
      {pending ? (
        // Offline (default g): this capture or check-off waits on the device.
        <Tip label="Waiting to sync">
          <span
            data-slot="row-pending"
            className="flex items-center text-muted-foreground"
            role="img"
            aria-label="Waiting to sync"
          >
            <Clock className="size-icon-xs" aria-hidden />
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
  wrap = false,
  className,
}: {
  name: string;
  isInbox: boolean;
  /** Wrap a long name instead of cutting it (cards, TV-P0). Rows still cut
   *  until TV-U10's row anatomy gives the name its own room. */
  wrap?: boolean;
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
      <span className={wrap ? "min-w-0 break-words" : "truncate"}>{name}</span>
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
      {/* A date never truncates (call 41): it keeps its width. */}
      <span className="whitespace-nowrap">{date.label}</span>
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
