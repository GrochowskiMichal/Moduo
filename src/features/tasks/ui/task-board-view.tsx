import {
  closestCorners,
  type DragEndEvent,
  DragOverlay,
  type DragStartEvent,
  useDroppable,
} from "@dnd-kit/core";
import {
  SortableContext,
  type SortingStrategy,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { DROP_TARGET, DragOverlaySurface } from "../../../components/ui/drag-visuals";
import { EmptyState } from "../../../components/ui/empty-state";
import { cn } from "../../../lib/utils";
import { useAssignees } from "../assignees";
import {
  type BoardColumn,
  type BoardContext,
  type BoardLane,
  buildBoardColumns,
  buildBoardLanes,
  effectiveBoardGroup,
  effectiveLanes,
} from "../board-columns";
import { type CompletedMode, partitionCompleted } from "../completed";
import {
  type BoardGroupBy,
  type BoardLanes,
  type OrderDirection,
  orderTasks,
  type SubtaskMode,
  type TaskOrder,
} from "../display";
import { type BoardCellRef, planBoardDrop, targetAccepts } from "../dnd/board-drop";
import { positionNextTo } from "../dnd/drop-mode";
import { manyLabel, multiDropWrites } from "../dnd/multi-drop";
import { isUnfinished, nestedSubtaskIds, showBucketPill } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import type { GroupAdd } from "../list-group-add";
import type { Bucket, Task } from "../model";
import { BACK_TO_MANUAL_ORDER, dragOrderFor, sortedByLabel } from "../order";
import { DEFAULT_ROW_PROPERTIES, type RowPreset } from "../row-layout";
import { inViewOrder, PLAIN_SELECT, type SelectMods } from "../selection";
import type { StatusKey } from "../statuses";
import { useToday } from "../use-today";
import { boardKeyActionFor, moveInGrid } from "./board-keys";
import {
  AddSectionButton,
  AddStatusButton,
  BoardColumnHeader,
  BoardLaneHeader,
  FoldedColumn,
  HiddenColumnsLine,
} from "./board-parts";
import { DndBoundary, taskDragAnnouncements, useTaskDndSensors } from "./dnd/task-dnd";
import type { PlanHeaderControls, PlanView } from "./plan-view-header";
import { PlanViewHeader } from "./plan-view-header";
import { ProjectChoicesProvider, StatusChoicesProvider } from "./project-choices";
import { useTaskFileDrop } from "./row-drop";
import {
  type FactsSource,
  type TaskFacts,
  type TaskRowActions,
  taskFactsOf,
  useRowActions,
  waitingLabelsOf,
} from "./row-facts";
import { CardBody, type CardTeam, TaskCard } from "./task-card";
import { activateTask, type TaskCommand } from "./task-context-menu";
import type { GroupMarkContext } from "./task-list-parts";
import { CompletedLine } from "./task-meta";
import { TaskBoardSkeleton, TasksNoMatch } from "./task-view-states";
import { registerBoardDropNames, useBoardFolds } from "./use-board-folds";
import type { MultiSelect } from "./use-task-selection";
import { VirtualStack } from "./virtual-stack";

export type { BoardGroupBy };

const NO_SELECTED: ReadonlySet<string> = new Set();
type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "mine" | "inbox" | "today" | "upcoming" | bucketId
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  /** Display → Group by (call 22; it always opens by status, 86). */
  boardGroupBy: BoardGroupBy;
  /** Display → Lanes (call 85), off by default. */
  lanes?: BoardLanes;
  /** Display → Description: a two-line preview on cards (AC7.4). */
  description?: boolean;
  /** Display → Rows: Detailed cards add the handle and a second meta line. */
  rows?: RowPreset;
  buckets: Bucket[];
  inbox: Bucket | null;
  bucketNameById: (id: string) => string;
  canEdit: boolean;
  /** ⌘N, "+ New", `c` and a column's "+" (with its value, default n). */
  onRequestCapture: (add?: GroupAdd) => void;
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /** Several selected (TV-U12): ⇧/⌘-click, ⇧↑↓, ⌘A and Esc, in the board's order. */
  multiSelect?: MultiSelect;
  /** Filled with the card ids in the order the keys walk them (TV-U12). */
  orderRef?: { current: readonly string[] };
  /**
   * The page's keys asked first (the bulk row's on a selection, TV-U12):
   * true when it handled the key. Never from a field or a portaled menu.
   */
  onViewKey?: (event: React.KeyboardEvent<HTMLDivElement>, selected: Task | null) => boolean;
  /** ⏎ opens the selected task's full page (decision 22). */
  onOpenTask?: (id: string) => void;
  /** The toolbar's search, Filter, Display and count (built by the page). */
  header?: PlanHeaderControls;
  /** A filter is narrowing the scope: an empty result reads "No tasks match". */
  filterActive?: boolean;
  onClearFilters?: () => void;
  /** The statuses Filter → Status lets through (null: no Status filter). */
  statusFilter?: ReadonlySet<StatusKey> | null;
  /**
   * "+ Add status" at the end of one project's board grouped by status
   * (REPLAN 53a), and a status's ⋯ "Edit statuses…": the project's
   * Statuses. Absent elsewhere.
   */
  onAddStatus?: () => void;
  onEditStatuses?: () => void;
  /** Display → Completed (tasks-v2 §6). Default: hidden. */
  completed?: CompletedMode;
  /** Display → "Show on cards". */
  properties?: readonly string[];
  /** Display → Order by, inside each column, and its direction (TV-U10). */
  order?: TaskOrder;
  orderDir?: OrderDirection;
  /** Display → Order by back to Manual: the sorted drop toast's action. */
  onManualOrder?: () => void;
  /** Display → Subtasks: on their parent's card, or cards of their own. */
  subtasks?: SubtaskMode;
  /**
   * Tasks that stay listed whatever Display says, until the scope changes:
   * checked off here, or opened here (selected, deep-linked).
   */
  stayingIds?: ReadonlySet<string>;
  /** "external" = an ancestor owns the DndContext (DF-22: so a card can be
   * dragged onto the right-pane hub to link it); board move/reorder binds via a
   * monitor. Default "internal" (own DndContext) keeps standalone mounts working. */
  dndMode?: "internal" | "external";
  /** The workspace's task key ("MOD"): Detailed cards' handle. */
  taskKey?: string | null;
  /** Where folds are remembered on this device (null: not remembered). */
  foldKey?: string | null;
  api: TasksModuleApi;
};

const NO_IDS: ReadonlySet<string> = new Set();

/** Cards stay put while dragging where the board has no manual order (sorted,
 *  or across projects): parting them would promise a reorder the drop won't
 *  make. */
const NO_SHIFT: SortingStrategy = () => null;

/** A column draws only the cards on screen from this many (TV-D11b, AC12.4). */
const VIRTUALIZE_CARDS_FROM = 40;
/** A first guess at a card's height (px), corrected once it's drawn. */
const CARD_ESTIMATE = 60;
/** The column's `gap-1.5`, for the drawn-on-screen layout. */
const CARD_GAP = 6;
/** With lanes, a cell shows this many cards, then "+ n more" (research §3). */
const LANE_CELL_CARDS = 20;

/** One column as the board draws it: completed cards split out. */
type ViewColumn = BoardColumn & {
  /** The cards it lists (completed ones only while revealed or kept). */
  shown: Task[];
  /** Completed cards Display hides, behind the column's "N completed" line. */
  hidden: Task[];
  folded: boolean;
};

/** One place a card can sit: a column, or a column's part of a lane. */
type Cell = {
  id: string;
  column: ViewColumn;
  lane: BoardLane | null;
  /** Every task in the cell, in order (completed included): drops place among these. */
  all: Task[];
  shown: Task[];
  hidden: Task[];
};

export function TaskBoardView({
  tasks,
  scopeTitle,
  selection,
  view,
  onViewChange,
  boardGroupBy,
  lanes = "none",
  description = false,
  rows = "standard",
  buckets,
  inbox,
  bucketNameById,
  canEdit,
  onRequestCapture,
  selectedTaskId,
  onSelectTask,
  multiSelect,
  orderRef,
  onViewKey,
  onOpenTask,
  header,
  filterActive = false,
  onClearFilters,
  statusFilter = null,
  completed = "hidden",
  properties = DEFAULT_ROW_PROPERTIES,
  order = "manual",
  orderDir = "asc",
  onManualOrder,
  subtasks = "nested",
  stayingIds = NO_IDS,
  dndMode = "internal",
  onAddStatus,
  onEditStatuses,
  taskKey = null,
  foldKey = null,
  api,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [command, setCommand] = useState<{ taskId: string; kind: TaskCommand } | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  // Columns whose hidden completed cards were asked for ("· show"), and lane
  // cells opened past their first 20; forgotten when the scope changes (the
  // sets belong to the scope they were made in).
  const [reveal, setReveal] = useState<{ scope: string; ids: ReadonlySet<string> }>({
    scope: selection,
    ids: NO_IDS,
  });
  const revealed = reveal.scope === selection ? reveal.ids : NO_IDS;
  const [more, setMore] = useState<{ scope: string; ids: ReadonlySet<string> }>({
    scope: selection,
    ids: NO_IDS,
  });
  const moreOpen = more.scope === selection ? more.ids : NO_IDS;

  const inboxId = inbox?.id ?? null;
  const today = useToday();
  const { assignees, byId } = useAssignees();
  const detailed = rows === "detailed";

  // Subtasks whose parent is on this board stay off it — the parent card
  // carries the quiet n/m mirror and the detail panel lists them — unless
  // Display says Flat. The Queue stays flat (queued subtasks are first-class
  // queue items), and a subtask whose parent isn't on the board renders as a
  // normal card (never invisible). Cards follow Display → Order by.
  const nestedIds = useMemo(
    () => nestedSubtaskIds(tasks, selection !== "today" && subtasks === "nested"),
    [tasks, selection, subtasks],
  );
  const sorted = order !== "manual" && selection !== "today";
  const boardTasks = useMemo(() => {
    const top = nestedIds.size === 0 ? tasks : tasks.filter((t) => !nestedIds.has(t.id));
    return sorted ? orderTasks(top, order, orderDir) : top;
  }, [tasks, nestedIds, sorted, order, orderDir]);

  // ── columns and lanes (board-columns.ts) ──────────────────────────────────
  const ctxBuckets = useMemo(
    () => (inbox ? [inbox, ...buckets.filter((b) => b.id !== inbox.id)] : buckets),
    [inbox, buckets],
  );
  const boardCtx = useMemo<BoardContext>(
    () => ({
      scope: selection,
      groupBy: boardGroupBy,
      inboxId,
      canEdit,
      today,
      statuses: api.statuses ?? [],
      buckets: ctxBuckets,
      bucketName: bucketNameById,
      sections: api.sections,
      teams: api.teams,
      assignees,
      areas: api.areas,
      statusFilter,
      waiting: api.waiting,
    }),
    [
      selection,
      boardGroupBy,
      inboxId,
      canEdit,
      today,
      api.statuses,
      ctxBuckets,
      bucketNameById,
      api.sections,
      api.teams,
      assignees,
      api.areas,
      statusFilter,
      api.waiting,
    ],
  );
  const groupDim = effectiveBoardGroup(boardCtx);
  const laneBy = effectiveLanes(lanes, selection);
  const showBucketTag = showBucketPill(selection, groupDim === "bucket" ? "bucket" : "none");
  // In My tasks every card is mine, so cards leave the avatar out (D4-4).
  const showAssignee = selection !== "mine";

  const taskById = useMemo(() => new Map(api.tasks.map((t) => [t.id, t])), [api.tasks]);
  const folds = useBoardFolds(foldKey);
  const [showEmpty, setShowEmpty] = useState<{ scope: string; on: boolean }>({
    scope: selection,
    on: false,
  });
  const emptyShown = showEmpty.scope === selection && showEmpty.on;

  const allColumns = useMemo(() => buildBoardColumns(boardTasks, boardCtx), [boardTasks, boardCtx]);
  const columns = useMemo<ViewColumn[]>(() => {
    const now = new Date();
    // Kept even when done: staying (checked off or opened in this scope); the
    // selected card and its parent (a deep link or the panel must never point
    // at a card that isn't there); a parent with open subtasks (they live on
    // its card's n/m).
    const selectedParentId = selectedTaskId
      ? (taskById.get(selectedTaskId)?.parentId ?? null)
      : null;
    const keep = (t: Task) =>
      stayingIds.has(t.id) ||
      t.id === selectedTaskId ||
      t.id === selectedParentId ||
      (api.subtasksByParent.get(t.id) ?? []).some(isUnfinished);
    return allColumns.map((c) => {
      const { shown, hidden } = partitionCompleted(c.tasks, { mode: completed, now, keep });
      // A folded column opens for the card you select in it (a deep link,
      // the panel), without changing what you chose (53b).
      const holdsSelection = !!selectedTaskId && c.tasks.some((t) => t.id === selectedTaskId);
      // While revealed, the column lists its completed cards too; its line
      // still counts them (and hides them again).
      return {
        ...c,
        shown: revealed.has(c.id) ? c.tasks : shown,
        hidden,
        folded: (folds.get(c.id) ?? c.startsFolded) && !holdsSelection,
      };
    });
  }, [
    allColumns,
    completed,
    stayingIds,
    selectedTaskId,
    revealed,
    taskById,
    api.subtasksByParent,
    folds,
  ]);
  // Empty people, teams, projects and areas hide (default o), "n hidden · Show".
  const keptColumns = useMemo(
    () => columns.filter((c) => c.persistent || c.tasks.length > 0),
    [columns],
  );
  const hiddenEmpty = columns.length - keptColumns.length;
  const visibleColumns = emptyShown ? columns : keptColumns;

  const laneList = useMemo(
    () => (laneBy === "none" ? null : buildBoardLanes(boardTasks, laneBy, boardCtx)),
    [laneBy, boardTasks, boardCtx],
  );

  // Every cell: a column, or each column's part of each lane.
  const cells = useMemo(() => {
    const out = new Map<string, Cell>();
    for (const column of visibleColumns) {
      if (!laneList) {
        out.set(column.id, {
          id: column.id,
          column,
          lane: null,
          all: column.tasks,
          shown: column.shown,
          hidden: column.hidden,
        });
        continue;
      }
      for (const lane of laneList) {
        const inLane = new Set(lane.tasks.map((t) => t.id));
        const id = `${column.id}|lane:${lane.key}`;
        out.set(id, {
          id,
          column,
          lane,
          all: column.tasks.filter((t) => inLane.has(t.id)),
          shown: column.shown.filter((t) => inLane.has(t.id)),
          hidden: column.hidden.filter((t) => inLane.has(t.id)),
        });
      }
    }
    return out;
  }, [visibleColumns, laneList]);
  const cellOfTask = useMemo(() => {
    const out = new Map<string, Cell>();
    for (const cell of cells.values()) for (const t of cell.all) out.set(t.id, cell);
    return out;
  }, [cells]);
  const laneFolded = useCallback(
    (lane: BoardLane) =>
      (folds.get(`lane:${laneBy}:${lane.key}`) ?? false) &&
      !(selectedTaskId && lane.tasks.some((t) => t.id === selectedTaskId)),
    [folds, selectedTaskId, laneBy],
  );
  // Folding or unfolding unmounts the control you used: the keys come back
  // to the board (a frame later, after a menu hands focus back).
  const setFold = (id: string, folded: boolean) => {
    folds.set(id, folded);
    if (typeof window === "undefined") return;
    window.requestAnimationFrame(() => boardRef.current?.focus({ preventScroll: true }));
  };
  /** The cards a cell draws (a lane cell stops at 20 until "+ n more"). */
  const drawnIn = useCallback(
    (cell: Cell) => {
      if (!cell.lane || moreOpen.has(cell.id) || cell.shown.length <= LANE_CELL_CARDS) {
        return cell.shown;
      }
      const first = cell.shown.slice(0, LANE_CELL_CARDS);
      // The selected card is always drawn.
      const selected = cell.shown.find((t) => t.id === selectedTaskId);
      return selected && !first.includes(selected) ? [...first, selected] : first;
    },
    [moreOpen, selectedTaskId],
  );

  // What a screen reader hears for each drop target: its name, never an id.
  useEffect(() => {
    registerBoardDropNames(
      [...cells.values()].map((c) => [
        c.id,
        c.lane ? `${c.column.label} · ${c.lane.label}` : c.column.label,
      ]),
    );
  }, [cells]);

  const toggleIn = (
    set: (next: { scope: string; ids: ReadonlySet<string> }) => void,
    current: ReadonlySet<string>,
    id: string,
  ) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    set({ scope: selection, ids: next });
  };

  // ── the facts cards show (row-facts.ts, TV-D11b) ──────────────────────────
  const sectionNames = useMemo(
    () => new Map((api.sections ?? []).map((s) => [s.id, s.name])),
    [api.sections],
  );
  const waitingLabels = useMemo(
    () =>
      waitingLabelsOf(api.waiting ?? [], (id) => {
        const person = byId(id);
        return person ? (person.isMe ? "you" : person.name) : null;
      }),
    [api.waiting, byId],
  );
  const factsSource = useMemo<FactsSource>(
    () => ({
      queuedTaskIds: api.queuedTaskIds,
      queueClaims: api.queueClaims,
      blockedTaskIds: api.blockedTaskIds,
      blockersByTask: api.blockersByTask,
      tagsByTask: api.tagsByTask,
      subtaskProgressByTask: api.subtaskProgressByTask,
      statusById: api.statusById,
      sectionNames,
      waitingLabels,
      commentCounts: api.commentCounts,
      attachmentCounts: api.attachmentCounts,
      pendingTaskIds: api.pendingTaskIds,
    }),
    [
      api.queuedTaskIds,
      api.queueClaims,
      api.blockedTaskIds,
      api.blockersByTask,
      api.tagsByTask,
      api.subtaskProgressByTask,
      api.statusById,
      sectionNames,
      waitingLabels,
      api.commentCounts,
      api.attachmentCounts,
      api.pendingTaskIds,
    ],
  );
  const factsOf = (task: Task) => taskFactsOf(task, factsSource);
  const parentTitleOf = (task: Task): string | null => {
    if (!task.parentId) return null;
    const parent = taskById.get(task.parentId);
    return parent ? parent.title || "Untitled" : null;
  };
  // One object per team for the life of the team list (cards are memoised).
  const teamMarks = useMemo(
    () =>
      new Map<string, CardTeam>(
        (api.teams ?? []).map((t) => [
          t.id,
          { id: t.id, name: t.name, mark: t.mark, color: t.color },
        ]),
      ),
    [api.teams],
  );
  const markCtx = useMemo<GroupMarkContext>(
    () => ({
      bucketColor: (id) => ctxBuckets.find((b) => b.id === id)?.color ?? null,
      assignee: (userId) => byId(userId),
      team: (teamId) => {
        const team = teamMarks.get(teamId);
        return team ? { name: team.name, mark: team.mark, color: team.color } : null;
      },
    }),
    [ctxBuckets, byId, teamMarks],
  );

  // A card's facts and actions: each card redraws only when its own task or
  // facts change. Selecting a card hands the keys to the board.
  const actions = useRowActions(api);
  const fileDrop = useTaskFileDrop({
    canEdit,
    taskOf: (id) => taskById.get(id),
    userId: api.currentUserId,
    pendingTaskIds: api.pendingTaskIds,
    onOpen: (id) => onSelectTask(id),
  });
  // A click's ⇧ / ⌘ go to the page's selection (TV-U12) with the cards in
  // the order the keys walk them (column by column).
  const selectionRef = useRef<{ multiSelect?: MultiSelect; order: readonly string[] }>({
    multiSelect,
    order: [],
  });
  const selectCard = useCallback(
    (id: string, mods?: SelectMods) => {
      const { multiSelect: multi, order } = selectionRef.current;
      if (multi) multi.select(id, mods ?? PLAIN_SELECT, order);
      else onSelectTask(id);
      boardRef.current?.focus({ preventScroll: true });
    },
    [onSelectTask],
  );
  const multiIds = multiSelect?.ids ?? NO_SELECTED;
  const endEdit = useCallback(() => {
    setEditingId(null);
    boardRef.current?.focus({ preventScroll: true });
  }, []);
  const requestCommand = useCallback(
    (taskId: string, kind: TaskCommand) => setCommand({ taskId, kind }),
    [],
  );
  const clearCommand = useCallback(() => {
    setCommand(null);
    // Back to the board, unless closing came from clicking into another field.
    const active = document.activeElement;
    const leftForElsewhere =
      active instanceof HTMLElement &&
      active !== document.body &&
      !boardRef.current?.contains(active) &&
      !active.closest('[data-slot="popover-content"], [data-slot="dropdown-menu-content"]');
    if (!leftForElsewhere) boardRef.current?.focus({ preventScroll: true });
  }, []);

  // Each new selection is brought into view once in its column (a deep link,
  // the panel's subtask list), again when selected again.
  const [selectionSeq, setSelectionSeq] = useState({ id: selectedTaskId, seq: 0 });
  if (selectionSeq.id !== selectedTaskId) {
    setSelectionSeq({ id: selectedTaskId, seq: selectionSeq.seq + 1 });
  }
  // …and sideways: a key that walks to (or moves the card into) a column
  // off screen brings that column into view (the column's own scroller
  // handles up and down). A frame later, once the card is drawn there.
  const selectedColumnId = selectedTaskId
    ? (cellOfTask.get(selectedTaskId)?.column.id ?? null)
    : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection or column asks again.
  useEffect(() => {
    if (!selectedTaskId || typeof window === "undefined") return;
    const frame = window.requestAnimationFrame(() => {
      const card = boardRef.current?.querySelector<HTMLElement>(
        `[role="button"][data-task-id="${selectedTaskId}"]`,
      );
      card?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedTaskId, selectedColumnId]);

  // ── drag and drop ─────────────────────────────────────────────────────────
  const sensors = useTaskDndSensors();
  // Manual order lives inside one project (order.ts, default m): only a
  // project's or the Inbox's board, under Manual, takes a reorder.
  const dragOrder = dragOrderFor(selection, order);
  const askManualOrder = useCallback(() => {
    if (order === "manual") return;
    toast(sortedByLabel(order), {
      action: onManualOrder ? { label: BACK_TO_MANUAL_ORDER, onClick: onManualOrder } : undefined,
    });
  }, [order, onManualOrder]);
  const statusesFor = useCallback(
    (bucketId: string) => api.statusesForBucket?.(bucketId) ?? [],
    [api.statusesForBucket],
  );
  const cellRef = (cell: Cell): BoardCellRef => ({
    id: cell.id,
    column: { id: cell.column.id, label: cell.column.label, target: cell.column.target },
    lane: cell.lane
      ? { key: cell.lane.key, label: cell.lane.label, target: cell.lane.target }
      : null,
    all: cell.all,
  });
  const dropContext = (task: Task) => ({
    inboxId,
    statusesFor,
    parent: task.parentId ? (taskById.get(task.parentId) ?? null) : null,
  });

  // Screen readers hear titles and column names, never ids (standalone
  // mounts; on the tasks page the page's one context speaks).
  const announcements = useMemo(() => {
    const cardName = (id: string) => {
      const task = taskById.get(id);
      return task ? `“${task.title || "Untitled"}”` : null;
    };
    return taskDragAnnouncements({
      taskName: (id) => cardName(id) ?? "the task",
      targetName: (id) => {
        const cell = cells.get(id);
        if (cell)
          return cell.lane ? `${cell.column.label} · ${cell.lane.label}` : cell.column.label;
        return cardName(id);
      },
    });
  }, [taskById, cells]);

  const onDragStart = (e: DragStartEvent) => {
    if (!canEdit) return;
    setActiveId(String(e.active.id));
  };

  // A drop resolves to a cell (a card's, or the cell itself for an end-drop),
  // then to one write (board-drop.ts): a reorder within the cell, or the
  // column's (and lane's) field.
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!canEdit || !over) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    if (activeKey === overKey) return;
    const task = taskById.get(activeKey);
    const source = cellOfTask.get(activeKey);
    const overIsCell = cells.has(overKey);
    const dest = overIsCell ? cells.get(overKey) : cellOfTask.get(overKey);
    if (!task || !source || !dest) return;
    const decision = planBoardDrop({
      task,
      source: cellRef(source),
      dest: cellRef(dest),
      overId: overIsCell ? null : overKey,
      order: dragOrder,
      ctx: dropContext(task),
    });
    if (decision.kind === "ask-manual") askManualOrder();
    else if (decision.kind === "waiting") {
      // A Waiting on column: the task (or the selection) waits on it too, with Undo.
      const multi = selectionRef.current.multiSelect;
      const ids =
        multi && multi.ids.size >= 2 && multi.ids.has(task.id)
          ? inViewOrder(multi.ids, selectionRef.current.order)
          : [task.id];
      void api.bulkWaiting(ids, decision.entry, dest.column.label, api.waiting);
    } else if (decision.kind === "write") {
      // A card of a selection carries the selection (TV-U12): one write, one Undo.
      const multi = selectionRef.current.multiSelect;
      if (multi && multi.ids.size >= 2 && multi.ids.has(task.id)) {
        const ids = inViewOrder(multi.ids, selectionRef.current.order);
        const writes = multiDropWrites(decision.write, task, ids, api.tasks);
        if (writes.length > 0) {
          void api.bulkWrite(writes, { label: (n) => manyLabel(decision.label, n) });
        }
        return;
      }
      void api.dropTask(decision.write, decision.label);
    }
  };

  const activeTask = activeId ? (taskById.get(activeId) ?? null) : null;
  // Where the dragged card comes from: a cell lights up only if it takes it.
  const activeCell = activeId ? (cellOfTask.get(activeId) ?? null) : null;

  // ── keys (board-keys.ts) ──────────────────────────────────────────────────
  // The cards you can walk to, column by column (folded columns and lanes,
  // and cards a lane cell hasn't drawn yet, are skipped).
  const grid = useMemo(
    () =>
      visibleColumns
        .filter((c) => !c.folded)
        .map((c) => ({
          id: c.id,
          ids: laneList
            ? laneList
                .filter((l) => !laneFolded(l))
                .flatMap((l) => {
                  const cell = cells.get(`${c.id}|lane:${l.key}`);
                  return cell ? drawnIn(cell).map((t) => t.id) : [];
                })
            : c.shown.map((t) => t.id),
        })),
    [visibleColumns, laneList, laneFolded, cells, drawnIn],
  );
  const selectedTask = selectedTaskId ? (taskById.get(selectedTaskId) ?? null) : null;
  const selectedCell = selectedTaskId ? (cellOfTask.get(selectedTaskId) ?? null) : null;
  const gridOrder = useMemo(() => grid.flatMap((c) => c.ids), [grid]);
  useLayoutEffect(() => {
    selectionRef.current = { multiSelect, order: gridOrder };
    if (orderRef) orderRef.current = gridOrder;
  });

  /** ⌥⇧←/→: to the next unfolded column that takes it (its field changes). */
  const moveToColumn = (task: Task, step: -1 | 1) => {
    const source = cellOfTask.get(task.id);
    if (!source) return;
    const order = visibleColumns.filter((c) => !c.folded);
    const from = order.findIndex((c) => c.id === source.column.id);
    for (let i = from + step; i >= 0 && i < order.length; i += step) {
      const column = order[i];
      if (!column || !targetAccepts(column.target, task, inboxId)) continue;
      const dest = cells.get(source.lane ? `${column.id}|lane:${source.lane.key}` : column.id);
      if (!dest) continue;
      const decision = planBoardDrop({
        task,
        source: cellRef(source),
        dest: cellRef(dest),
        overId: null,
        // A key move keeps the card's place in the order.
        order: "none",
        ctx: dropContext(task),
      });
      if (decision.kind === "write") void api.dropTask(decision.write, decision.label);
      if (decision.kind === "waiting") {
        void api.bulkWaiting([task.id], decision.entry, column.label, api.waiting);
      }
      return;
    }
  };
  /** ⌥⇧↑/↓: one place up or down among its cell's cards (manual order only). */
  const moveInCell = (task: Task, step: -1 | 1) => {
    if (dragOrder !== "manual") {
      if (dragOrder === "sorted") askManualOrder();
      return;
    }
    const cell = cellOfTask.get(task.id);
    if (!cell) return;
    const at = cell.shown.findIndex((t) => t.id === task.id);
    const neighbour = cell.shown[at + step];
    if (at < 0 || !neighbour) return;
    const position = positionNextTo(
      api.tasks,
      { id: neighbour.id, edge: step < 0 ? "before" : "after" },
      task.id,
    );
    if (position === null) return;
    void api.dropTask({ taskId: task.id, position }, step < 0 ? "Moved up" : "Moved down");
  };
  /** `c`: a new task in the selected card's column, with its value. */
  const captureHere = () => {
    const column =
      selectedCell?.column ?? visibleColumns.find((c) => !c.folded && c.add.kind === "add");
    if (column?.add.kind === "add") onRequestCapture(column.add.add);
    else onRequestCapture();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (editingId || activeId) return;
    // The page's keys first (a selection's bulk row), from the board itself.
    if (
      onViewKey &&
      e.target instanceof Node &&
      e.currentTarget.contains(e.target) &&
      !(
        e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]")
      ) &&
      onViewKey(e, selectedTask)
    ) {
      e.preventDefault();
      return;
    }
    const action = boardKeyActionFor(e, e.currentTarget);
    if (!action) return;
    if (e.target !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
    const go = (dir: "up" | "down" | "left" | "right") => {
      e.preventDefault();
      multiSelect?.clear();
      const next = moveInGrid(grid, selectedTaskId, dir);
      if (next) onSelectTask(next);
    };
    switch (action) {
      case "extend-next":
      case "extend-prev":
        if (!multiSelect) return;
        e.preventDefault();
        multiSelect.extend(action === "extend-next" ? 1 : -1, gridOrder);
        return;
      case "select-all":
        if (!multiSelect) return;
        e.preventDefault();
        multiSelect.selectAll(gridOrder);
        return;
      case "clear-selection":
        if (multiSelect?.clear()) e.preventDefault();
        return;
      case "next":
        return go("down");
      case "prev":
        return go("up");
      case "left":
        return go("left");
      case "right":
        return go("right");
      case "capture":
        e.preventDefault();
        if (canEdit) captureHere();
        return;
    }
    if (!selectedTask) return;
    switch (action) {
      case "open":
        e.preventDefault();
        if (onOpenTask) onOpenTask(selectedTask.id);
        else if (canEdit) setEditingId(selectedTask.id);
        return;
      case "edit":
        if (!canEdit) return;
        e.preventDefault();
        setEditingId(selectedTask.id);
        return;
      case "toggle-done":
        if (!canEdit) return;
        e.preventDefault();
        activateTask(selectedTask, actions);
        return;
      case "bucket":
      case "schedule":
      case "due":
      case "status":
        if (!canEdit) return;
        e.preventDefault();
        setCommand({ taskId: selectedTask.id, kind: action });
        return;
      case "queue":
        if (!canEdit) return;
        e.preventDefault();
        api.toggleQueue(selectedTask.id);
        return;
      case "delete":
        if (!canEdit) return;
        e.preventDefault();
        api.deleteTask(selectedTask.id);
        return;
      case "move-up":
      case "move-down":
        if (!canEdit) return;
        e.preventDefault();
        moveInCell(selectedTask, action === "move-up" ? -1 : 1);
        return;
      case "move-left":
      case "move-right":
        if (!canEdit) return;
        e.preventDefault();
        moveToColumn(selectedTask, action === "move-left" ? -1 : 1);
        return;
    }
  };

  // ── the board's end: "+ Add status" / "+ Add section", "n hidden" ────────
  const projectBoard = selection !== "all" && selection !== "mine" && selection !== "today";
  const addAtEnd =
    !canEdit || filterActive ? null : groupDim === "status" && onAddStatus ? (
      <AddStatusButton onAdd={onAddStatus} />
    ) : groupDim === "section" && projectBoard ? (
      <AddSectionButton onAdd={(name) => void api.createSection(selection, name)} />
    ) : null;
  const sectionEdits = (column: ViewColumn) =>
    canEdit && column.sectionId
      ? {
          onRename: (name: string) => api.renameSection(column.sectionId as string, name),
          onDelete: () => api.deleteSection(column.sectionId as string),
        }
      : null;

  const cardProps = (cell: Cell, task: Task) => ({
    task,
    bucketName: bucketNameById(task.bucketId),
    inboxId,
    showBucket: showBucketTag,
    showAssignee,
    properties,
    detailed,
    description,
    columnStatus: groupDim === "status" ? cell.column.label : null,
    canEdit,
    selected: task.id === selectedTaskId || multiIds.has(task.id),
    editing: task.id === editingId,
    command: command?.taskId === task.id ? command.kind : null,
    onSelect: selectCard,
    onStartEdit: setEditingId,
    onEndEdit: endEdit,
    onRequestCommand: requestCommand,
    onClearCommand: clearCommand,
    facts: factsOf(task),
    parentTitle: parentTitleOf(task),
    actions,
    today,
    taskKey,
    team: task.teamId ? (teamMarks.get(task.teamId) ?? null) : null,
    dropTarget: task.id === fileDrop.targetId,
  });

  const header_ = (column: ViewColumn) =>
    column.folded ? (
      <FoldedColumn
        key={column.id}
        label={column.label}
        count={column.tasks.length}
        mark={column.mark}
        markCtx={markCtx}
        onUnfold={() => setFold(column.id, false)}
      />
    ) : (
      <BoardColumnHeader
        label={column.label}
        count={column.tasks.length}
        mark={column.mark}
        markCtx={markCtx}
        add={column.add}
        onAdd={onRequestCapture}
        onFold={() => setFold(column.id, true)}
        section={sectionEdits(column)}
        onEditStatuses={canEdit && column.statusId ? onEditStatuses : null}
      />
    );

  const loading = !api.loaded;
  const noMatch = !loading && filterActive && tasks.length === 0;

  const body = loading ? (
    <TaskBoardSkeleton />
  ) : noMatch ? (
    <TasksNoMatch onClearFilters={onClearFilters} />
  ) : laneList ? (
    <LaneBoard
      columns={visibleColumns}
      lanes={laneList}
      cells={cells}
      laneFolded={laneFolded}
      onToggleLane={(lane) => setFold(`lane:${laneBy}:${lane.key}`, !laneFolded(lane))}
      headerOf={header_}
      drawnIn={drawnIn}
      moreOpen={moreOpen}
      onMore={(id) => toggleIn(setMore, moreOpen, id)}
      revealed={revealed}
      onToggleReveal={(id) => toggleIn(setReveal, revealed, id)}
      markCtx={markCtx}
      canEdit={canEdit}
      activeTask={activeTask}
      activeCell={activeCell}
      reorderable={dragOrder === "manual"}
      inboxId={inboxId}
      cardProps={cardProps}
      end={
        <>
          {addAtEnd}
          <HiddenColumnsLine
            hidden={hiddenEmpty}
            shown={emptyShown}
            onToggle={() => setShowEmpty({ scope: selection, on: !emptyShown })}
          />
        </>
      }
    />
  ) : (
    <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1">
      {visibleColumns.map((column) => {
        const cell = cells.get(column.id);
        // A folded column is its small button, in the column's place (53b).
        if (column.folded || !cell) return <Fragment key={column.id}>{header_(column)}</Fragment>;
        return (
          <BoardColumnView
            key={column.id}
            cell={cell}
            header={header_(column)}
            canEdit={canEdit}
            revealed={revealed.has(column.id)}
            onToggleReveal={() => toggleIn(setReveal, revealed, column.id)}
            activeTask={activeTask}
            activeCell={activeCell}
            reorderable={dragOrder === "manual"}
            inboxId={inboxId}
            selectedTaskId={selectedTaskId}
            selectionSeq={selectionSeq.seq}
            cardProps={cardProps}
          />
        );
      })}
      <div className="flex shrink-0 flex-col items-start gap-1 pt-0.5">
        {addAtEnd}
        <HiddenColumnsLine
          hidden={hiddenEmpty}
          shown={emptyShown}
          onToggle={() => setShowEmpty({ scope: selection, on: !emptyShown })}
        />
      </div>
    </div>
  );

  return (
    // The projects and statuses a card's menus offer, read only by an open
    // menu (TV-D11b).
    <ProjectChoicesProvider projects={buckets} inboxId={inboxId}>
      <StatusChoicesProvider statusesFor={statusesFor} any={(api.statuses?.length ?? 0) > 0}>
        <div className="flex h-full min-h-0 flex-col">
          <PlanViewHeader
            title={scopeTitle}
            view={view}
            onViewChange={onViewChange}
            controls={header}
            canEdit={canEdit}
            onRequestCapture={() => onRequestCapture()}
          />

          {/* One boundary: a self-owned context ("internal") or a monitor bound to
            the tasks page's app-level context ("external", DF-22 — so a card can
            be dropped on the right-pane hub). onDragEnd early-returns unless the
            drop resolves to a board cell or card, so a hub drop falls through to
            the page's link handler. */}
          <DndBoundary
            dndMode={dndMode}
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onDragCancel={() => setActiveId(null)}
            announcements={announcements}
          >
            {/* The board takes the keys (board-keys.ts): a card click hands
              focus here. */}
            <div
              ref={boardRef}
              tabIndex={0}
              // The keys' home, like the List's grid (↑↓←→ walk the cards).
              role="grid"
              aria-roledescription="board"
              aria-label={`${scopeTitle} board`}
              onKeyDown={onKeyDown}
              // Files dropped on a card attach to its task (AT-3, AT3-1).
              {...fileDrop.handlers}
              // As on the List: after a mouse click on a card's button, focus
              // comes back to the board, so the next Space/⏎ acts on the
              // selected card; a button that opens a menu keeps it.
              onClickCapture={(e) => {
                if (e.detail === 0 || !e.currentTarget.contains(e.target as Node)) return;
                const button = e.target instanceof Element ? e.target.closest("button") : null;
                if (!button || button.hasAttribute("aria-haspopup")) return;
                e.currentTarget.focus({ preventScroll: true });
              }}
              className="flex min-h-0 flex-1 flex-col outline-none"
            >
              {body}
            </div>
          </DndBoundary>

          {typeof document !== "undefined"
            ? createPortal(
                <DragOverlay>
                  {activeTask ? (
                    // DS-4's overlay surface, card-shaped (U4-5: one drag look).
                    <DragOverlaySurface className="w-full flex-col items-stretch gap-1 rounded-lg px-(--pad-x-sm) py-(--pad-y-sm) text-sm">
                      <CardBody
                        task={activeTask}
                        bucketName={bucketNameById(activeTask.bucketId)}
                        inboxId={inboxId}
                        showBucket={showBucketTag}
                        showAssignee={showAssignee}
                        properties={properties}
                        detailed={detailed}
                        description={description}
                        canEdit={false}
                        facts={factsOf(activeTask)}
                        parentTitle={parentTitleOf(activeTask)}
                        actions={actions}
                        today={today}
                        taskKey={taskKey}
                      />
                      {/* A card of a selection carries the others (the List's "+3"). */}
                      {multiIds.size >= 2 && multiIds.has(activeTask.id) ? (
                        <span
                          data-slot="drag-count"
                          className="self-end font-sans text-xs text-muted-foreground"
                        >
                          +{multiIds.size - 1}
                        </span>
                      ) : null}
                    </DragOverlaySurface>
                  ) : null}
                </DragOverlay>,
                document.body,
              )
            : null}
        </div>
      </StatusChoicesProvider>
    </ProjectChoicesProvider>
  );
}

type CardPropsOf = (cell: Cell, task: Task) => Parameters<typeof TaskCard>[0];

/** Whether a cell takes the dragged card (lights up only then). */
function cellTakes(
  cell: Cell,
  task: Task | null,
  inboxId: string | null,
  from: Cell | null,
): boolean {
  if (!task) return true;
  if (from && from.id === cell.id) return true;
  const columnOk =
    (from && from.column.id === cell.column.id) || targetAccepts(cell.column.target, task, inboxId);
  const laneOk =
    !cell.lane ||
    (from?.lane && from.lane.key === cell.lane.key) ||
    targetAccepts(cell.lane.target, task, inboxId);
  return Boolean(columnOk && laneOk);
}

/** One column without lanes: header, then its own scroller (virtualized from 40). */
function BoardColumnView({
  cell,
  header,
  canEdit,
  revealed,
  onToggleReveal,
  activeTask,
  activeCell,
  reorderable,
  inboxId,
  selectedTaskId,
  selectionSeq,
  cardProps,
}: {
  cell: Cell;
  header: React.ReactNode;
  canEdit: boolean;
  revealed: boolean;
  onToggleReveal: () => void;
  activeTask: Task | null;
  activeCell: Cell | null;
  reorderable: boolean;
  inboxId: string | null;
  selectedTaskId: string | null;
  selectionSeq: number;
  cardProps: CardPropsOf;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: cell.id,
    disabled: !canEdit || !cell.column.target,
  });
  // The column scrolls on its own and draws only the cards on screen once it
  // is long (TV-D11b): its droppable box is also its scroller.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const setColumnRef = useCallback(
    (el: HTMLDivElement | null) => {
      scrollRef.current = el;
      setNodeRef(el);
    },
    [setNodeRef],
  );
  const from = activeCell;
  const accepting = isOver && cellTakes(cell, activeTask, inboxId, from);
  const ids = useMemo(() => cell.shown.map((t) => t.id), [cell.shown]);
  // The card being dragged stays drawn while its column scrolls (dnd-kit
  // loses a draggable that unmounts mid-drag).
  const activeIndex = activeTask ? ids.indexOf(activeTask.id) : -1;
  const pinned = useMemo(() => (activeIndex >= 0 ? [activeIndex] : []), [activeIndex]);
  // The selected card is brought into view once (a deep link into a long column).
  const scrollTo = useMemo(
    () => (selectedTaskId ? { key: selectedTaskId, seq: selectionSeq } : null),
    [selectedTaskId, selectionSeq],
  );

  return (
    // A fixed width per density (default o): the board never reflows.
    <section
      data-board-column={cell.column.label}
      className="flex h-full w-(--board-col-w) shrink-0 flex-col"
    >
      <header className="mb-1.5 px-1">{header}</header>
      <div
        ref={setColumnRef}
        className={cn(
          // Linear-quiet: columns are transparent on the canvas; cards carry the
          // elevation (bg-card + hairline). Only a drag-over state lights up.
          "flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto rounded-md p-1 transition-colors duration-(--motion-fade) ease-(--ease-out)",
          accepting ? DROP_TARGET : "bg-transparent",
        )}
      >
        <SortableContext
          items={ids}
          strategy={reorderable ? verticalListSortingStrategy : NO_SHIFT}
        >
          {cell.shown.length === 0 && cell.hidden.length === 0 ? (
            <EmptyState
              size="inline"
              title={canEdit && cell.column.target ? "Drop tasks here" : "Empty"}
            />
          ) : (
            <VirtualStack
              items={cell.shown}
              itemKey={(task) => task.id}
              estimateSize={() => CARD_ESTIMATE}
              scrollRef={scrollRef}
              gap={CARD_GAP}
              gapClassName="gap-1.5"
              virtualizeFrom={VIRTUALIZE_CARDS_FROM}
              pinned={pinned}
              scrollTo={scrollTo}
              render={(task) => <TaskCard {...cardProps(cell, task)} />}
            />
          )}
        </SortableContext>
        <CompletedLine
          count={cell.hidden.length}
          shown={revealed}
          onToggle={onToggleReveal}
          className="px-1"
        />
      </div>
    </section>
  );
}

/**
 * The board with lanes (call 85): the column headers on top, then each lane
 * — a full-width header that folds, and a row of cells — and the whole board
 * scrolls as one. Each cell shows 20 cards, then "+ n more" (research §3).
 */
function LaneBoard({
  columns,
  lanes,
  cells,
  laneFolded,
  onToggleLane,
  headerOf,
  drawnIn,
  moreOpen,
  onMore,
  revealed,
  onToggleReveal,
  markCtx,
  canEdit,
  activeTask,
  activeCell,
  reorderable,
  inboxId,
  cardProps,
  end,
}: {
  columns: ViewColumn[];
  lanes: BoardLane[];
  cells: ReadonlyMap<string, Cell>;
  laneFolded: (lane: BoardLane) => boolean;
  onToggleLane: (lane: BoardLane) => void;
  headerOf: (column: ViewColumn) => React.ReactNode;
  drawnIn: (cell: Cell) => Task[];
  moreOpen: ReadonlySet<string>;
  onMore: (cellId: string) => void;
  revealed: ReadonlySet<string>;
  onToggleReveal: (columnId: string) => void;
  markCtx: GroupMarkContext;
  canEdit: boolean;
  activeTask: Task | null;
  activeCell: Cell | null;
  reorderable: boolean;
  inboxId: string | null;
  cardProps: CardPropsOf;
  end: React.ReactNode;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-auto pb-1">
      <div className="flex w-max flex-col">
        <div className="sticky top-0 z-(--z-sticky) flex gap-3 bg-background pb-1.5">
          {columns.map((column) =>
            column.folded ? (
              headerOf(column)
            ) : (
              <div key={column.id} className="w-(--board-col-w) shrink-0 px-1">
                {headerOf(column)}
              </div>
            ),
          )}
          <div className="flex shrink-0 items-start gap-1 pt-0.5">{end}</div>
        </div>
        {lanes.map((lane) => {
          const folded = laneFolded(lane);
          return (
            <div key={lane.key} data-board-lane-key={lane.key} className="flex flex-col pt-2">
              <BoardLaneHeader
                label={lane.label}
                count={lane.tasks.length}
                mark={lane.mark}
                markCtx={markCtx}
                collapsed={folded}
                onToggle={() => onToggleLane(lane)}
              />
              {folded ? null : (
                <div className="flex gap-3 border-b border-hairline pt-1 pb-2">
                  {columns.map((column) => {
                    const cell = cells.get(`${column.id}|lane:${lane.key}`);
                    if (column.folded || !cell) {
                      // Folded columns keep their place in every lane.
                      return <span key={column.id} aria-hidden className="w-8 shrink-0" />;
                    }
                    return (
                      <LaneCell
                        key={cell.id}
                        cell={cell}
                        drawn={drawnIn(cell)}
                        moreShown={moreOpen.has(cell.id)}
                        onMore={() => onMore(cell.id)}
                        revealed={revealed.has(column.id)}
                        onToggleReveal={() => onToggleReveal(column.id)}
                        canEdit={canEdit}
                        activeTask={activeTask}
                        activeCell={activeCell}
                        reorderable={reorderable}
                        inboxId={inboxId}
                        cardProps={cardProps}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LaneCell({
  cell,
  drawn,
  moreShown,
  onMore,
  revealed,
  onToggleReveal,
  canEdit,
  activeTask,
  activeCell,
  reorderable,
  inboxId,
  cardProps,
}: {
  cell: Cell;
  drawn: Task[];
  moreShown: boolean;
  onMore: () => void;
  revealed: boolean;
  onToggleReveal: () => void;
  canEdit: boolean;
  activeTask: Task | null;
  activeCell: Cell | null;
  reorderable: boolean;
  inboxId: string | null;
  cardProps: CardPropsOf;
}) {
  const takes = !!cell.column.target || !!cell.lane?.target;
  const { setNodeRef, isOver } = useDroppable({ id: cell.id, disabled: !canEdit || !takes });
  const from = activeCell;
  const accepting = isOver && cellTakes(cell, activeTask, inboxId, from);
  const ids = useMemo(() => drawn.map((t) => t.id), [drawn]);
  const rest = cell.shown.length - drawn.length;
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-12 w-(--board-col-w) shrink-0 flex-col gap-1.5 rounded-md p-1 transition-colors duration-(--motion-fade) ease-(--ease-out)",
        accepting ? DROP_TARGET : "bg-transparent",
      )}
    >
      <SortableContext items={ids} strategy={reorderable ? verticalListSortingStrategy : NO_SHIFT}>
        {drawn.map((task) => (
          <TaskCard key={task.id} {...cardProps(cell, task)} />
        ))}
      </SortableContext>
      {rest > 0 || moreShown ? (
        <button
          type="button"
          onClick={onMore}
          className="self-start rounded-sm px-1 font-sans text-xs text-muted-foreground tabular-nums transition-colors duration-(--motion-fade) ease-(--ease-out) hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          {moreShown ? "Show fewer" : `+ ${rest} more`}
        </button>
      ) : null}
      <CompletedLine
        count={cell.hidden.length}
        shown={revealed}
        onToggle={onToggleReveal}
        className="px-1"
      />
    </div>
  );
}

// Re-exported for the stories and tests that built boards on the old shape.
export type { TaskFacts, TaskRowActions };
