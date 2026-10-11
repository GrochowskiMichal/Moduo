import { isClosedTask, isOpenTask } from "@contracts/vocabularies";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CornerDownRight } from "lucide-react";
import { memo, useCallback } from "react";
import { SELECTED_OPTION } from "@/components/ui/selection";
import { CompleteToggle } from "../../../components/ui/complete-toggle";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "../../../components/ui/context-menu";
import { DRAG_SOURCE } from "../../../components/ui/drag-visuals";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { assigneeLabel } from "../assignee-options";
import { useAssignees } from "../assignees";
import { LEVEL_OPTIONS } from "../helpers";
import type { EnergyLevel, PriorityLevel, Task } from "../model";
import { DEFAULT_ROW_PROPERTIES, rowDate } from "../row-layout";
import { AssignContextMenu } from "./assign-context-menu";
import { AssigneeAvatar } from "./assignee-avatar";
import { taskDrag } from "./dnd/task-dnd";
import { EnergyMark, PriorityMark } from "./level-icons";
import { QueueToggle } from "./queue-toggle";
import { sameTaskFacts, type TaskFacts, type TaskRowActions } from "./row-facts";
import { BucketLabel, DateMark, hasTaskCounts, TaskCounts } from "./task-meta";

type Props = {
  task: Task;
  bucketName: string;
  buckets: Array<{ id: string; name: string; isSystem: boolean }>;
  inboxId: string | null;
  /** Show the bucket tag (when columns are grouped by status, not bucket). */
  showBucket: boolean;
  /** False in My tasks, where every card is mine (D4-4). */
  showAssignee?: boolean;
  /** Display → "Show on rows". */
  properties?: readonly string[];
  canEdit: boolean;
  /** Selection drives the detail rail; available to view-only users too. */
  selected: boolean;
  /** Takes the task's id, so one function serves every card. */
  onSelect: (taskId: string) => void;
  /** The card's own facts (row-facts.ts, TV-D11b): it redraws when they change. */
  facts: TaskFacts;
  /** The parent's title on a subtask card shown flat (null otherwise). */
  parentTitle: string | null;
  /** One object for the life of the board (`useRowActions`). */
  actions: TaskRowActions;
};

/** A sortable kanban card. Drag reorders within a column; dropping on another
 *  column changes status (or bucket). Memoised: a card redraws only when its
 *  own props or facts change (TV-D11b). */
export const TaskCard = memo(TaskCardView, (a: Props, b: Props) => {
  for (const key of Object.keys(a) as (keyof Props)[]) {
    if (key !== "facts" && !Object.is(a[key], b[key])) return false;
  }
  return Object.keys(a).length === Object.keys(b).length && sameTaskFacts(a.facts, b.facts);
});

function TaskCardView({
  task,
  bucketName,
  buckets,
  inboxId,
  showBucket,
  showAssignee = true,
  properties,
  canEdit,
  selected,
  onSelect,
  facts,
  parentTitle,
  actions,
}: Props) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: taskDrag(task.id, "board"),
    disabled: !canEdit,
  });
  // The card is the sortable node AND its only keyboard activator, so Space/
  // Enter on the queue toggle or a chip inside it stay theirs (tasks-v2 Q1-2).
  const setCardRef = useCallback(
    (element: HTMLElement | null) => {
      setNodeRef(element);
      setActivatorNodeRef(element);
    },
    [setNodeRef, setActivatorNodeRef],
  );

  const card = (
    <div
      ref={setCardRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...(canEdit ? listeners : {})}
      role="button"
      aria-pressed={selected}
      data-task-id={task.id}
      data-done={task.status === "done" || undefined}
      onClick={() => onSelect(task.id)}
      className={cn(
        // Linear-quiet: card = bg-card + hairline on the (transparent) column,
        // so it reads as a quiet lift off the canvas — not darker than its
        // column (the old bg-background was the inverted-elevation bug).
        "group flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm transition-colors duration-(--motion-fade) ease-(--ease-out)",
        "select-none",
        // Done cards fade as a whole (tasks-v2 §6), and so does a Won't do
        // card a Status filter lists (TV-U2), like its row.
        (task.status === "done" || task.status === "archived") && !isDragging && "opacity-50",
        // Selection = the accent tint + the 32% ring a card always carries
        // (R5). The old bright accent border read as a white ring on mono.
        selected ? SELECTED_OPTION : "border-border bg-card hover:border-foreground/30",
        // whole card is the drag handle (grip removed)
        canEdit && "cursor-grab active:cursor-grabbing",
        // The source stays in its slot, dimmed (DS-4's DRAG_SOURCE), while the
        // overlay follows the cursor and its neighbours animate apart.
        isDragging && DRAG_SOURCE,
      )}
    >
      <CardBody
        task={task}
        bucketName={bucketName}
        inboxId={inboxId}
        showBucket={showBucket}
        showAssignee={showAssignee}
        properties={properties}
        canEdit={canEdit}
        facts={facts}
        parentTitle={parentTitle}
        actions={actions}
      />
    </div>
  );

  if (!canEdit) return card;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{card}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => actions.toggleDone(task)}>
          {task.status === "done" ? "Mark not done" : "Mark done"}
        </ContextMenuItem>
        {!isClosedTask(task) ? (
          <ContextMenuItem onSelect={() => actions.toggleQueue(task.id)}>
            {facts.queued ? "Remove from queue" : "Add to queue"}
          </ContextMenuItem>
        ) : null}
        {task.recurrence && isOpenTask(task) ? (
          <ContextMenuItem onSelect={() => actions.skipOccurrence(task.id)}>
            Skip occurrence
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Move to bucket</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={task.bucketId}
              onValueChange={(v) => {
                if (v !== task.bucketId) actions.patchTask(task.id, { bucketId: v });
              }}
            >
              {inboxId ? <ContextMenuRadioItem value={inboxId}>Inbox</ContextMenuRadioItem> : null}
              {buckets
                .filter((b) => b.id !== inboxId)
                .map((b) => (
                  <ContextMenuRadioItem key={b.id} value={b.id}>
                    {b.name}
                  </ContextMenuRadioItem>
                ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <AssignContextMenu task={task} api={actions} />
        <ContextMenuSub>
          <ContextMenuSubTrigger>Priority</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={task.priority ?? "none"}
              onValueChange={(v) =>
                actions.patchTask(task.id, {
                  priority: v === "none" ? null : (v as PriorityLevel),
                })
              }
            >
              <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
              {LEVEL_OPTIONS.map((l) => (
                <ContextMenuRadioItem key={l.value} value={l.value}>
                  {l.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Energy</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuRadioGroup
              value={task.energyLevel ?? "none"}
              onValueChange={(v) =>
                actions.patchTask(task.id, {
                  energyLevel: v === "none" ? null : (v as EnergyLevel),
                })
              }
            >
              <ContextMenuRadioItem value="none">None</ContextMenuRadioItem>
              {LEVEL_OPTIONS.map((l) => (
                <ContextMenuRadioItem key={l.value} value={l.value}>
                  {l.label}
                </ContextMenuRadioItem>
              ))}
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={() => actions.deleteTask(task.id)}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The visible body — also rendered standalone inside the DragOverlay. One
 *  quiet meta line under the title (tasks-v2 §6): priority · date · counts ·
 *  bucket where it isn't implied, then the queue mark and the assignee. */
export function CardBody({
  task,
  bucketName,
  inboxId,
  showBucket,
  showAssignee = true,
  properties = DEFAULT_ROW_PROPERTIES,
  canEdit,
  facts,
  parentTitle,
  actions,
}: {
  task: Task;
  bucketName: string;
  inboxId: string | null;
  showBucket: boolean;
  /** False in My tasks, where every card is mine (D4-4). */
  showAssignee?: boolean;
  /** Display → "Show on rows" (energy is off by default). */
  properties?: readonly string[];
  canEdit: boolean;
  facts: TaskFacts;
  parentTitle: string | null;
  actions: Pick<TaskRowActions, "toggleDone" | "toggleQueue">;
}) {
  const done = task.status === "done";
  const queued = facts.queued;
  const claimed = facts.claims.length > 0;
  const on = new Set(properties);
  const date = on.has("date") ? rowDate(task) : null;
  // Blocked — computed, ambient: dim + a quiet icon, never red (spec §5c).
  const blocked = facts.blockedLabel !== null;
  const { assignees, byId } = useAssignees();
  // Solo workspaces have nobody to tell apart; Unassigned shows nothing.
  const withAssignee =
    on.has("assignee") && showAssignee && assignees.length > 1 && !!task.assigneeId;
  const assigneeName = assigneeLabel(task.assigneeId, byId);
  // A parent caption on a subtask card rendered flat (Today, or its parent is
  // off this board): `parentTitle`.
  const priority = on.has("priority") ? task.priority : null;
  const energy = on.has("energy") ? task.energyLevel : null;
  const showQueue = !done && task.status !== "archived" && (canEdit || queued || claimed);
  const hasMeta =
    !!priority ||
    !!energy ||
    !!date ||
    hasTaskCounts(task, facts) ||
    showBucket ||
    parentTitle !== null ||
    showQueue ||
    withAssignee;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex items-start gap-2">
        <span className="mt-0.5" onPointerDown={(e) => e.stopPropagation()}>
          <CompleteToggle
            done={done}
            disabled={!canEdit}
            onToggle={() => actions.toggleDone(task)}
          />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 break-words font-sans text-base leading-snug",
            // A done (or Won't do) card fades as a whole; no muted colour on top.
            done || task.status === "archived"
              ? "text-foreground line-through"
              : blocked
                ? "text-muted-foreground"
                : "text-foreground",
          )}
        >
          {task.title || "Untitled"}
        </span>
      </div>

      {hasMeta ? (
        // The meta wraps onto a second line rather than cut anything (TV-P0,
        // AC1.16); each item keeps its words together.
        <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 pl-6 font-sans text-xs text-muted-foreground">
          <PriorityMark level={priority} />
          <EnergyMark level={energy} />
          {date ? <DateMark date={date} className="shrink-0" /> : null}
          <TaskCounts task={task} facts={facts} />
          {showBucket ? (
            <BucketLabel name={bucketName} isInbox={task.bucketId === inboxId} wrap />
          ) : null}
          {parentTitle !== null ? (
            <span className="flex min-w-0 items-center gap-1">
              <CornerDownRight className="size-icon-xs shrink-0 opacity-70" aria-hidden />
              <span className="min-w-0 break-words">{parentTitle}</span>
            </span>
          ) : null}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {/* Queue mark — always visible + quiet (marker IS the action): my
              toggle, or a teammate's ringed avatar for their queue (TV-D4). */}
            {showQueue ? (
              <QueueToggle
                task={task}
                queued={facts.queued}
                claims={facts.claims}
                onToggle={actions.toggleQueue}
                canEdit={canEdit}
              />
            ) : null}
            {withAssignee ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span
                    className="flex items-center"
                    role="img"
                    aria-label={`Assignee: ${assigneeName}`}
                  >
                    <AssigneeAvatar
                      assignee={byId(task.assigneeId)}
                      assigneeId={task.assigneeId}
                      size="icon"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent>{assigneeName}</TooltipContent>
              </Tooltip>
            ) : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}
