import { isClosedTask } from "@contracts/vocabularies";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { CornerDownRight } from "lucide-react";
import { memo, useCallback } from "react";
import { TeamMark } from "../../../components/ui/avatar";
import { ItemCard, ItemCardMeta, ItemCardTitle } from "../../../components/ui/item-card";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../components/ui/tooltip";
import { cn } from "../../../lib/utils";
import { assigneeLabel } from "../assignee-options";
import { useAssignees } from "../assignees";
import type { Task } from "../model";
import { DEFAULT_ROW_PROPERTIES, handleLabel, rowDate, rowTime } from "../row-layout";
import { descriptionWords } from "../search";
import { type SelectMods, selectModsOf } from "../selection";
import { nowOn } from "../use-today";
import { AssigneeAvatar } from "./assignee-avatar";
import { taskDrag } from "./dnd/task-dnd";
import { EnergyMark, PriorityMark } from "./level-icons";
import { QueueToggle } from "./queue-toggle";
import { sameTaskFacts, type TaskFacts, type TaskRowActions } from "./row-facts";
import { activateTask, type TaskCommand, TaskContextMenu } from "./task-context-menu";
import { TaskCounts } from "./task-meta";
import { TitleEditor } from "./task-row";
import { DateCell, ProjectMenu, StatusGlyph } from "./task-row-cells";

/** A team's mark, as the card shows it on a task waiting for someone to take it. */
export type CardTeam = { id: string; name: string; mark: string; color: string | null };

type Props = {
  task: Task;
  bucketName: string;
  inboxId: string | null;
  /** Show the project (a board across projects, not grouped by project). */
  showBucket: boolean;
  /** False in My tasks, where every card is mine (D4-4). */
  showAssignee?: boolean;
  /** Display → "Show on cards". */
  properties?: readonly string[];
  /** Display → Rows: Detailed adds the handle and a second meta line. */
  detailed?: boolean;
  /** Display → Description: Preview shows two lines of it (AC7.4). */
  description?: boolean;
  /**
   * The status column's name when the board is grouped by status: the card
   * names its own status only when it differs ("In review" under In
   * progress, research §5). Null otherwise.
   */
  columnStatus?: string | null;
  canEdit: boolean;
  /** Selection drives the detail panel; available to view-only users too. */
  selected: boolean;
  editing?: boolean;
  /** Which inline menu or popover the keyboard or the menu asked for. */
  command?: TaskCommand | null;
  /** Callbacks take the task's id, so one function serves every card. A
   *  click passes its ⇧ / ⌘ (multi-select, TV-U12). */
  onSelect: (taskId: string, mods?: SelectMods) => void;
  onStartEdit?: (taskId: string) => void;
  onEndEdit?: () => void;
  onRequestCommand?: (taskId: string, command: TaskCommand) => void;
  onClearCommand?: () => void;
  /** The card's own facts (row-facts.ts, TV-D11b): it redraws when they change. */
  facts: TaskFacts;
  /** The parent's title on a subtask card shown flat (null otherwise). */
  parentTitle: string | null;
  /** One object for the life of the board (`useRowActions`). */
  actions: TaskRowActions;
  /** Today's date key (`useToday`): the card's date label is worked out against it. */
  today: string;
  /** The workspace's task key ("MOD"): Detailed's handle. */
  taskKey?: string | null;
  /** Its team, while nobody has taken it (TV-D13): the mark stands in for an avatar. */
  team?: CardTeam | null;
};

const NOOP = () => {};

/**
 * One task on the Board (tasks-v3 §5, TV-U11): the kit's ItemCard at the
 * board's fixed width. Standard: the status icon (a click finishes, ⇧S picks)
 * · the title · one meta line (project where not implied · priority · one
 * date · counts · the status's own name where it differs from the column ·
 * the Focus mark on hover · the avatar). Detailed adds the handle and a
 * second line (tags by name · time · waiting). Display → Description shows
 * two lines of the description. Drag reorders within a column and moves
 * between columns; right-click opens the one task menu. Memoised: a card
 * redraws only when its own props or facts change (TV-D11b).
 */
export const TaskCard = memo(TaskCardView, (a: Props, b: Props) => {
  for (const key of Object.keys(a) as (keyof Props)[]) {
    if (key !== "facts" && !Object.is(a[key], b[key])) return false;
  }
  return Object.keys(a).length === Object.keys(b).length && sameTaskFacts(a.facts, b.facts);
});

function TaskCardView({
  task,
  bucketName,
  inboxId,
  showBucket,
  showAssignee = true,
  properties,
  detailed = false,
  description = false,
  columnStatus = null,
  canEdit,
  selected,
  editing = false,
  command = null,
  onSelect,
  onStartEdit = NOOP,
  onEndEdit = NOOP,
  onRequestCommand = NOOP,
  onClearCommand = NOOP,
  facts,
  parentTitle,
  actions,
  today,
  taskKey = null,
  team = null,
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
    disabled: !canEdit || editing,
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
  const closed = isClosedTask(task);

  const card = (
    <ItemCard
      ref={setCardRef}
      // dnd-kit's transform while the column parts for a reorder: geometry,
      // set by the library each frame (no design value).
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...(canEdit && !editing ? listeners : {})}
      role="button"
      aria-pressed={selected}
      data-task-id={task.id}
      data-done={closed || undefined}
      selected={selected}
      done={closed}
      dragging={isDragging}
      onClick={(e) => onSelect(task.id, selectModsOf(e))}
      onDoubleClick={() => {
        if (canEdit) onStartEdit(task.id);
      }}
      className={cn(
        // `group` too: the Focus mark reveals on the card's hover (R6).
        "group w-(--board-card-w) select-none",
        canEdit && !editing && "cursor-grab active:cursor-grabbing",
      )}
    >
      <CardBody
        task={task}
        bucketName={bucketName}
        inboxId={inboxId}
        showBucket={showBucket}
        showAssignee={showAssignee}
        properties={properties}
        detailed={detailed}
        description={description}
        columnStatus={columnStatus}
        canEdit={canEdit}
        editing={editing}
        command={command}
        onEndEdit={onEndEdit}
        onRequestCommand={onRequestCommand}
        onClearCommand={onClearCommand}
        facts={facts}
        parentTitle={parentTitle}
        actions={actions}
        today={today}
        taskKey={taskKey}
        team={team}
      />
    </ItemCard>
  );

  return (
    <TaskContextMenu
      task={task}
      facts={facts}
      canEdit={canEdit}
      taskKey={taskKey}
      actions={actions}
      onOpen={onSelect}
      onRename={onStartEdit}
      onRequestCommand={onRequestCommand}
    >
      {card}
    </TaskContextMenu>
  );
}

/** The card's inside — also drawn on its own inside the DragOverlay. */
export function CardBody({
  task,
  bucketName,
  inboxId,
  showBucket,
  showAssignee = true,
  properties = DEFAULT_ROW_PROPERTIES,
  detailed = false,
  description = false,
  columnStatus = null,
  canEdit,
  editing = false,
  command = null,
  onEndEdit = NOOP,
  onRequestCommand = NOOP,
  onClearCommand = NOOP,
  facts,
  parentTitle,
  actions,
  today,
  taskKey = null,
  team = null,
}: {
  task: Task;
  bucketName: string;
  inboxId: string | null;
  showBucket: boolean;
  showAssignee?: boolean;
  properties?: readonly string[];
  detailed?: boolean;
  description?: boolean;
  columnStatus?: string | null;
  canEdit: boolean;
  editing?: boolean;
  command?: TaskCommand | null;
  onEndEdit?: () => void;
  onRequestCommand?: (taskId: string, command: TaskCommand) => void;
  onClearCommand?: () => void;
  facts: TaskFacts;
  parentTitle: string | null;
  actions: TaskRowActions;
  today: string;
  taskKey?: string | null;
  team?: CardTeam | null;
}) {
  const closed = isClosedTask(task);
  const on = new Set(properties);
  const now = nowOn(today);
  const date = on.has("date") ? rowDate(task, now) : null;
  const dateCommand = command === "schedule" || command === "due" ? command : null;
  // Blocked — computed, ambient: dim + a quiet icon, never red (spec §5c).
  const blocked = facts.blockedLabel !== null;
  const { assignees, byId } = useAssignees();
  // Solo workspaces have nobody to tell apart; Unassigned shows nothing.
  const withAssignee =
    on.has("assignee") && showAssignee && assignees.length > 1 && !!task.assigneeId;
  const assigneeName = assigneeLabel(task.assigneeId, byId);
  // Routed to a team and nobody has taken it yet (TV-D13): the team's mark.
  const waitingTeam = team && !task.assigneeId && !closed ? team : null;
  const priority = on.has("priority") ? task.priority : null;
  const energy = on.has("energy") ? task.energyLevel : null;
  const showQueue = !closed && (canEdit || facts.queued || facts.claims.length > 0);
  // The card's own status name where the column doesn't say it.
  const statusName =
    (detailed || columnStatus !== null) && facts.statusName !== columnStatus
      ? facts.statusName
      : null;
  const handle = detailed ? handleLabel(taskKey, task.number) : null;
  const preview = description ? descriptionWords(task.description).replace(/\s+/g, " ").trim() : "";
  const time = detailed ? rowTime(task) : null;
  const tagNames = detailed && facts.tags.length > 0;
  const second = detailed && (tagNames || !!time || !!facts.waiting);

  return (
    <>
      {handle ? (
        <span className="ps-6 font-sans text-xs text-subtle-foreground tabular-nums">{handle}</span>
      ) : null}
      <ItemCardTitle
        lead={
          <span onPointerDown={(e) => e.stopPropagation()} className="flex items-center">
            <StatusGlyph
              task={task}
              statusName={facts.statusName}
              canEdit={canEdit}
              menuOpen={command === "status"}
              onMenuOpenChange={(o) => (o ? onRequestCommand(task.id, "status") : onClearCommand())}
              onActivate={() => activateTask(task, actions)}
              onPickStatus={(target) => actions.setTaskStatus(task.id, target)}
            />
          </span>
        }
        className={cn(blocked && !closed && "text-muted-foreground")}
      >
        {editing ? (
          <TitleEditor
            initial={task.title}
            className="font-sans text-base"
            onCommit={(value) => {
              const next = value.trim();
              if (next && next !== task.title) actions.patchTask(task.id, { title: next });
              onEndEdit();
            }}
            onCancel={onEndEdit}
          />
        ) : (
          <span className={cn("font-sans", closed && "line-through decoration-subtle-foreground")}>
            {task.title || "Untitled"}
          </span>
        )}
      </ItemCardTitle>

      {preview ? (
        <p
          data-slot="card-description"
          className="line-clamp-2 ps-6 font-sans text-xs text-muted-foreground group-data-[done]/card:opacity-50"
        >
          {preview}
        </p>
      ) : null}

      {/* The one meta line: it wraps rather than cut anything (AC1.16). */}
      <ItemCardMeta>
        {showBucket ? (
          <ProjectMenu
            task={task}
            inboxId={inboxId}
            projectName={bucketName}
            sectionName={facts.sectionName}
            variant="inline"
            canEdit={canEdit}
            open={command === "bucket"}
            onOpenChange={(o) => (o ? onRequestCommand(task.id, "bucket") : onClearCommand())}
            actions={actions}
          />
        ) : null}
        <PriorityMark level={priority} />
        <EnergyMark level={energy} />
        {date || dateCommand ? (
          <DateCell
            task={task}
            kind="row"
            canEdit={canEdit}
            command={dateCommand}
            today={today}
            onRequestCommand={(kind) => onRequestCommand(task.id, kind)}
            onClearCommand={onClearCommand}
            actions={actions}
          />
        ) : null}
        <TaskCounts task={task} facts={facts} waitingColumn={detailed} />
        {statusName ? <span className="shrink-0 whitespace-nowrap">{statusName}</span> : null}
        {parentTitle !== null ? (
          <span className="flex min-w-0 items-center gap-1">
            <CornerDownRight className="size-icon-xs shrink-0 opacity-70" aria-hidden />
            <span className="min-w-0 break-words">{parentTitle}</span>
          </span>
        ) : null}
        <span className="ms-auto flex shrink-0 items-center gap-1.5">
          {showQueue ? (
            <QueueToggle
              task={task}
              queued={facts.queued}
              claims={facts.claims}
              onToggle={actions.toggleQueue}
              canEdit={canEdit}
              revealOnHover
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
          ) : waitingTeam ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="flex items-center"
                  role="img"
                  aria-label={`For ${waitingTeam.name}, not taken yet`}
                >
                  <TeamMark
                    name={waitingTeam.name}
                    id={waitingTeam.id}
                    letters={waitingTeam.mark}
                    color={waitingTeam.color}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>For {waitingTeam.name} · not taken yet</TooltipContent>
            </Tooltip>
          ) : null}
        </span>
        {/* `b` and "Move to project…" open here where the project is implied:
            an anchor that takes no width and no pointer (R6). */}
        {!showBucket && canEdit ? (
          <ProjectMenu
            task={task}
            inboxId={inboxId}
            projectName={bucketName}
            sectionName={facts.sectionName}
            variant="implied"
            canEdit={canEdit}
            open={command === "bucket"}
            onOpenChange={(o) => (o ? onRequestCommand(task.id, "bucket") : onClearCommand())}
            actions={actions}
          />
        ) : null}
      </ItemCardMeta>

      {second ? (
        <ItemCardMeta>
          {tagNames ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-1.5">
              {facts.tags.slice(0, 3).map((t) => (
                <span key={t.id}>#{t.name}</span>
              ))}
              {facts.tags.length > 3 ? <span>+{facts.tags.length - 3}</span> : null}
            </span>
          ) : null}
          {time ? <span className="shrink-0 whitespace-nowrap">{time}</span> : null}
          {facts.waiting ? (
            <span className="min-w-0 break-words">Waiting {facts.waiting}</span>
          ) : null}
        </ItemCardMeta>
      ) : null}
    </>
  );
}
