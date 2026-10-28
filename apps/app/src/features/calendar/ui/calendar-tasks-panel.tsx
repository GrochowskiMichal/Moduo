// Plan, the right panel's task view (CALR-5, AC20, AC24): your tasks in four
// groups (From earlier, Due this week, Scheduled, No date), six rows each, then
// Show more; Find a task (/) filters them all and reaches tasks due later.
// A click selects a row, ↵ or a double-click opens it; S lifts the selected
// task onto the grid (ui/use-plan-placement.tsx), "Find time" on an overdue
// row does the same; rows still drag onto the grid (the universal drag
// contract); the checkbox completes with the same op as everywhere.
//
// CAL-4's Review sub-state (AC9) pins to the top while the strip's "Review" is
// active — untick to exclude, "Move N to today", rows drag onto the grid.

import { useDraggable } from "@dnd-kit/core";
import { GripVertical, Search, X } from "lucide-react";
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { Button } from "../../../components/ui/button";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import { Eyebrow } from "../../../components/ui/eyebrow";
import { IconButton } from "../../../components/ui/icon-button";
import { Input } from "../../../components/ui/input";
import { Kbd } from "../../../components/ui/kbd";
import { formatDate, formatDay, formatDuration, formatTime } from "../../../lib/time-format";
import { formatScheduled } from "../../tasks/helpers";
import type { Task } from "../../tasks/model";
import { useTaskCommands, useTasksSelector, useTasksStatus } from "../../tasks/tasks-context";
import { taskDrag } from "../../tasks/ui/dnd/task-dnd";
import { groupPlanTasks, PLAN_GROUP_ROWS, planRows } from "../panel";
import type { StripItem } from "../strip";
import { PlanSkeleton } from "./calendar-skeleton";

export type ReviewController = {
  items: StripItem[];
  onMove: (taskIds: string[]) => void;
  onRemove: (taskId: string) => void;
  onClose: () => void;
};

type Props = {
  /** Only your tasks (assigned to you, or unassigned and yours). */
  userId: string;
  weekStartsOn: number;
  onOpenTask: (taskId: string) => void;
  onRequestCapture: () => void;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  /** The task S lifted onto the grid; its row keeps full contrast. */
  liftedTaskId: string | null;
  onLift: (taskId: string) => void;
  /** Bumped by / : focus Find a task. */
  findRequest: number;
  /** The strip's Review sub-state (AC9). Null when not reviewing. */
  review?: ReviewController | null;
  /** While tasks load: the groups' last known rows (CALR-3, AC4). */
  skeletonGroups?: readonly number[];
  /** Once loaded: the rows each group shows, for the next load's skeleton. */
  onShape?: (groups: number[]) => void;
};

type GroupId = "earlier" | "thisWeek" | "scheduled" | "noDate" | "later";
const GROUP_TITLES: Record<GroupId, string> = {
  earlier: "From earlier",
  thisWeek: "Due this week",
  scheduled: "Scheduled",
  noDate: "No date",
  later: "Due later",
};

/** The quiet date a row carries: never red. */
function rowDate(task: Task, group: GroupId): string | null {
  if (group === "scheduled") return formatScheduled(task.scheduledAt);
  if (!task.dueDate) return null;
  return group === "earlier" ? `Due ${formatDate(task.dueDate)}` : formatDay(task.dueDate);
}

/** ↑↓ between Plan's rows. */
function moveRowFocus(e: KeyboardEvent<HTMLElement>) {
  const list = e.currentTarget.closest("[data-plan-list]");
  if (!list) return;
  const rows = [...list.querySelectorAll<HTMLElement>("[data-plan-task-id]")];
  const at = rows.indexOf(e.currentTarget);
  const next = rows[at + (e.key === "ArrowDown" ? 1 : -1)];
  if (next) {
    e.preventDefault();
    next.focus();
    next.click();
  }
}

export function CalendarTasksPanel({
  userId,
  weekStartsOn,
  onOpenTask,
  onRequestCapture,
  selectedTaskId,
  onSelectTask,
  liftedTaskId,
  onLift,
  findRequest,
  review,
  skeletonGroups,
  onShape,
}: Props) {
  const tasks = useTasksSelector((d) => d.liveTasks);
  const { canEdit, loading } = useTasksStatus();
  const [query, setQuery] = useState("");
  const groups = useMemo(
    () => groupPlanTasks({ tasks, me: userId, query, weekStartsOn }),
    [tasks, userId, query, weekStartsOn],
  );
  const searching = query.trim() !== "";
  const order: GroupId[] = searching
    ? ["earlier", "thisWeek", "scheduled", "noDate", "later"]
    : ["earlier", "thisWeek", "scheduled", "noDate"];
  const total = order.reduce((n, id) => n + groups[id].length, 0);

  // / focuses Find a task (also when it opened the panel for it).
  const findRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (findRequest > 0) findRef.current?.focus();
  }, [findRequest]);

  // Remember the loaded shape (search off) so the next load draws it.
  const shape = [groups.earlier, groups.thisWeek, groups.scheduled, groups.noDate]
    .map((g) => Math.min(g.length, PLAN_GROUP_ROWS))
    .join(",");
  useEffect(() => {
    if (loading || searching || !onShape) return;
    onShape(shape.split(",").map(Number));
  }, [loading, searching, shape, onShape]);

  return (
    <div
      data-plan-list=""
      className="pane-scroll scrollbar-thin flex h-full min-h-0 flex-col gap-2 overflow-y-auto"
    >
      {review && review.items.length > 0 ? (
        <ReviewSection review={review} canEdit={canEdit} />
      ) : null}

      <div className="relative shrink-0">
        <Search
          aria-hidden
          className="absolute left-2 top-1/2 size-icon-xs -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={findRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape" && query) {
              e.preventDefault();
              setQuery("");
            }
          }}
          placeholder="Find a task"
          aria-label="Find a task"
          className="pl-6.5"
          style={{ height: "var(--ctrl-h-sm)" }}
        />
      </div>

      {loading && total === 0 && skeletonGroups ? <PlanSkeleton groups={skeletonGroups} /> : null}

      {!loading && total === 0 && !groups.emptyBySearch ? (
        <div className="flex flex-col items-start gap-2 px-1 py-3">
          <span className="text-sm text-muted-foreground">
            Nothing to plan. Capture a task, or enjoy the calm.
          </span>
          <Button variant="outline" size="sm" onClick={onRequestCapture}>
            Capture a task <Kbd>⇧⌘K</Kbd>
          </Button>
        </div>
      ) : null}
      {groups.emptyBySearch ? (
        <span className="px-1 py-3 text-sm text-muted-foreground">
          Nothing matches "{query.trim()}".
        </span>
      ) : null}

      {order.map((id) => (
        <TaskGroup
          key={id}
          group={id}
          tasks={groups[id]}
          expandAll={searching}
          selectedTaskId={selectedTaskId}
          liftedTaskId={liftedTaskId}
          canEdit={canEdit}
          onSelect={onSelectTask}
          onOpen={onOpenTask}
          onLift={onLift}
        />
      ))}
    </div>
  );
}

// ── Review sub-state (the strip's curate-then-move path) ─────────────────────

function ReviewSection({ review, canEdit }: { review: ReviewController; canEdit: boolean }) {
  // Excluded ids (unticked). Default: everything included.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(() => new Set());
  const includedIds = review.items.map((i) => i.taskId).filter((id) => !excluded.has(id));

  return (
    <div className="shrink-0 rounded-lg border border-border bg-card/40 p-2">
      <div className="flex items-center gap-2 px-1">
        <Eyebrow className="min-w-0 flex-1">
          Unfinished from earlier ({review.items.length})
        </Eyebrow>
        <IconButton icon={X} label="Close review" onClick={review.onClose} />
      </div>

      <div className="mt-1 flex flex-col gap-0.5">
        {review.items.map((item) => (
          <ReviewRow
            key={item.taskId}
            item={item}
            canEdit={canEdit}
            included={!excluded.has(item.taskId)}
            onToggleInclude={() =>
              setExcluded((prev) => {
                const next = new Set(prev);
                if (next.has(item.taskId)) next.delete(item.taskId);
                else next.add(item.taskId);
                return next;
              })
            }
            onRemove={() => review.onRemove(item.taskId)}
          />
        ))}
      </div>

      {canEdit ? (
        <div className="mt-2 flex px-1">
          <Button
            size="sm"
            variant="secondary"
            disabled={includedIds.length === 0}
            onClick={() => review.onMove(includedIds)}
          >
            Move {includedIds.length} to today
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function ReviewRow({
  item,
  canEdit,
  included,
  onToggleInclude,
  onRemove,
}: {
  item: StripItem;
  canEdit: boolean;
  included: boolean;
  onToggleInclude: () => void;
  onRemove: () => void;
}) {
  const { setNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `cal-review-task:${item.taskId}`,
    data: taskDrag(item.taskId, "list"),
    disabled: !canEdit,
  });
  // One grammar (Tasks v3 call 41): "Tomorrow · 3:00 PM · 1h 30m".
  const origin = `${formatDay(item.scheduledAtMs)} · ${formatTime(item.scheduledAtMs)} · ${formatDuration(item.durationMinutes)}`;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "group flex items-center gap-2 rounded-md px-1 py-0.5",
        isDragging && "opacity-40",
      )}
    >
      <input
        type="checkbox"
        checked={included}
        disabled={!canEdit}
        onChange={onToggleInclude}
        aria-label={included ? `Exclude ${item.title}` : `Include ${item.title}`}
        className="size-3.5 shrink-0 accent-primary"
      />
      <div {...listeners} {...attributes} className="flex min-w-0 flex-1 cursor-grab flex-col">
        {/* Titles and dates wrap, never truncate (TV-P0, AC1.16). */}
        <span className="break-words text-sm text-foreground">{item.title}</span>
        <span className="break-words text-2xs text-muted-foreground">{origin}</span>
      </div>
      {canEdit ? (
        <IconButton icon={X} label={`Remove ${item.title} from the schedule`} onClick={onRemove} />
      ) : null}
    </div>
  );
}

function TaskGroup({
  group,
  tasks,
  expandAll,
  selectedTaskId,
  liftedTaskId,
  canEdit,
  onSelect,
  onOpen,
  onLift,
}: {
  group: GroupId;
  tasks: Task[];
  expandAll: boolean;
  selectedTaskId: string | null;
  liftedTaskId: string | null;
  canEdit: boolean;
  onSelect: (taskId: string) => void;
  onOpen: (taskId: string) => void;
  onLift: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  if (tasks.length === 0) return null;
  const { rows, more } = planRows(tasks, expanded || expandAll);
  const title = GROUP_TITLES[group];
  return (
    <div className="flex shrink-0 flex-col gap-0.5" data-plan-group={group}>
      <Eyebrow as="div" className="px-1">
        {title} ({tasks.length})
      </Eyebrow>
      {rows.map((task) => (
        <PlanTaskRow
          key={task.id}
          task={task}
          date={rowDate(task, group)}
          selected={task.id === selectedTaskId}
          lifted={task.id === liftedTaskId}
          findTime={group === "earlier" && canEdit}
          onSelect={onSelect}
          onOpen={onOpen}
          onLift={onLift}
        />
      ))}
      {more > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-muted-foreground"
          onClick={() => setExpanded(true)}
        >
          Show {more} more
        </Button>
      ) : null}
    </div>
  );
}

function PlanTaskRow({
  task,
  date,
  selected,
  lifted,
  findTime,
  onSelect,
  onOpen,
  onLift,
}: {
  task: Task;
  date: string | null;
  selected: boolean;
  lifted: boolean;
  findTime: boolean;
  onSelect: (taskId: string) => void;
  onOpen: (taskId: string) => void;
  onLift: (taskId: string) => void;
}) {
  const { toggleDone } = useTaskCommands();
  const { canEdit } = useTasksStatus();
  const { setNodeRef, setActivatorNodeRef, listeners, attributes, isDragging } = useDraggable({
    id: `cal-panel-task:${task.id}`,
    data: taskDrag(task.id, "list"),
    disabled: !canEdit,
  });

  return (
    <div
      ref={(el) => {
        setNodeRef(el);
        setActivatorNodeRef(el);
      }}
      {...listeners}
      {...attributes}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      data-plan-task-id={task.id}
      onClick={() => onSelect(task.id)}
      onDoubleClick={() => onOpen(task.id)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") {
          e.preventDefault();
          onOpen(task.id);
        } else if (e.key === " ") {
          e.preventDefault(); // Space must not scroll
          onSelect(task.id);
        } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          moveRowFocus(e);
        }
      }}
      className={cn(
        "group flex cursor-grab items-center gap-2 rounded-md px-1.5 hover:bg-accent/60",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        selected && "bg-state-active",
        lifted && "ring-1 ring-primary/60",
        isDragging && "opacity-40",
      )}
      style={{ minHeight: "var(--row-h-sm)" }}
    >
      <CompleteToggle
        done={task.status === "done"}
        disabled={!canEdit}
        onToggle={() => toggleDone(task)}
        aria-label={task.status === "done" ? `Reopen ${task.title}` : `Complete ${task.title}`}
      />
      <div className="flex min-w-0 flex-1 flex-col py-0.5">
        {/* Titles wrap, never truncate (TV-P0); the facts sit on a line of their own. */}
        <span className="break-words text-sm text-foreground">{task.title}</span>
        {date || task.durationMinutes || lifted || findTime ? (
          <span className="flex flex-wrap items-center gap-x-1.5 text-2xs text-muted-foreground">
            {date ? <span>{date}</span> : null}
            {task.durationMinutes ? <span>{formatDuration(task.durationMinutes)}</span> : null}
            {lifted ? (
              <span>
                <Kbd>↵</Kbd> places, <Kbd>⇥</Kbd> next free time
              </span>
            ) : findTime ? (
              <button
                type="button"
                className="rounded-sm text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onLift(task.id);
                }}
              >
                Find time
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      <GripVertical
        aria-hidden
        className="size-icon-xs shrink-0 text-muted-foreground/0 transition-colors duration-(--motion-fade) group-hover:text-muted-foreground/60"
      />
    </div>
  );
}
