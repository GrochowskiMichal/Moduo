import { isBacklogTask, isClosedTask, isOpenTask } from "@contracts/vocabularies";
import {
  type Announcements,
  closestCenter,
  type DragEndEvent,
  type DraggableSyntheticListeners,
  DragOverlay,
  type DragStartEvent,
  pointerWithin,
} from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";

import {
  DROP_TARGET,
  DragOverlaySurface,
  InsertionLine,
  NestPreview,
  SortedNote,
} from "../../../components/ui/drag-visuals";
import { formatDate } from "../../../lib/time-format";
import { undoToast } from "../../../lib/undo-toast";
import { cn } from "../../../lib/utils";
import { type AgentSession, agentRowMarks, agentWho } from "../../spine/agent-session";
import { useAssignees } from "../assignees";
import { type CompletedMode, partitionCompleted } from "../completed";
import {
  type OrderDirection,
  orderTasks,
  type RowPreset,
  type SubtaskMode,
  type TaskOrder,
} from "../display";
import {
  canMoveInto,
  groupAccepts,
  type ListDropHover,
  type ListDropPlan,
  type ListPointerTarget,
  NEST_INDENT_PX,
  planListDrop,
  positionNextTo,
  resolveListHover,
} from "../dnd/drop-mode";
import { type DropNames, dropLabel, type TaskDropWrite, writeFromPlan } from "../dnd/drop-write";
import { multiDropLabel, multiDropWrites } from "../dnd/multi-drop";
import { isSideDroppable } from "../dnd/rail-drop";
import { readFolds, writeFold } from "../folds";
import {
  canNestUnder,
  type GroupBy,
  groupKeyFor,
  groupTasks,
  isProjectScope,
  isUnfinished,
  nestedSubtaskIds,
  showBucketPill,
} from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { type GroupAdd, type GroupAddState, groupAddState } from "../list-group-add";
import type { Bucket, ProjectStatus, Section, Task, Team } from "../model";
import { BACK_TO_MANUAL_ORDER, dragOrderFor, sortedByLabel } from "../order";
import {
  columnVar,
  columnWidths,
  DEFAULT_CH_PX,
  DEFAULT_ROW_PROPERTIES,
  dueLabel,
  fitColumns,
  handleLabel,
  projectLabel,
  type RowTexts,
  rowColumns,
  rowDate,
  rowTime,
  SIZED_COLUMNS,
  sessionLabel,
  updatedLabel,
} from "../row-layout";
import { inViewOrder, PLAIN_SELECT, type SelectMods } from "../selection";
import { statusNameOf } from "../statuses";
import { nowOn, useMinuteTick, useToday } from "../use-today";
import {
  asTaskDrag,
  DndBoundary,
  type DragActivatorRef,
  DraggableTask,
  overlayBesideCursor,
  SortableTask,
  taskDragAnnouncements,
  useTaskDndSensors,
} from "./dnd/task-dnd";
import type { ListExtraGroup, ListGrouping } from "./list-extensions";
import { listKeyActionFor } from "./list-keys";
import { type PlanHeaderControls, type PlanView, PlanViewHeader } from "./plan-view-header";
import { ProjectChoicesProvider, StatusChoicesProvider } from "./project-choices";
import { useTaskFileDrop } from "./row-drop";
import { type FactsSource, taskFactsOf, useRowActions, waitingLabelsOf } from "./row-facts";
import { type SortColumn, TaskListHeader } from "./task-list-header";
import {
  AddSectionLine,
  BacklogLine,
  groupMark,
  ListGroupHeader,
  ShowMoreLine,
} from "./task-list-parts";
import { CompletedLine } from "./task-meta";
import { activateGlyph, type RowCommand, TaskRow } from "./task-row";
import { TaskListSkeleton, TasksEmptyScope, TasksNoMatch } from "./task-view-states";
import type { MultiSelect } from "./use-task-selection";
import { VirtualStack } from "./virtual-stack";

const NO_AGENT_SESSIONS: readonly AgentSession[] = [];

type Props = {
  tasks: Task[];
  scopeTitle: string;
  selection: string; // "all" | "mine" | "today" | "inbox" | bucketId
  view: PlanView;
  onViewChange: (view: PlanView) => void;
  /** Display → Group by (the Queue is never grouped). */
  groupBy: GroupBy;
  buckets: Bucket[];
  inbox: Bucket | null;
  bucketNameById: (id: string) => string;
  canEdit: boolean;
  /**
   * Open the app's capture "here" (⌘N, `c`, New): with a group's value when
   * a group header's "+" asks (TV-U10, default n).
   */
  onRequestCapture: (add?: GroupAdd) => void;
  /** Lifted task selection — drives the keyboard cursor and the detail rail. */
  selectedTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  /**
   * Several selected (TV-U12): ⇧/⌘-click, ⇧↑↓, ⌘A and Esc go to the page's
   * selection with this view's order. Absent: one task at a time.
   */
  multiSelect?: MultiSelect;
  /** Filled with the task ids in the order drawn (folded groups left out): the
   *  page's Inbox cursor, a selection's order and the page's backstop read it
   *  (TV-U12, MOD-124). */
  orderRef?: { current: readonly string[] };
  /**
   * Told when the List goes from showing rows to showing none while it has
   * tasks (every group that holds them folded) and back, and `false` when it
   * goes away: the page's panel then shows what it shows with nothing
   * selected, not a task you can't see (MOD-123).
   */
  onShowsNothing?: (nothing: boolean) => void;
  /** The toolbar's search, Filter, Display and count (built by the page). */
  header?: PlanHeaderControls;
  /** A filter is narrowing the scope: an empty result reads "No tasks match". */
  filterActive?: boolean;
  onClearFilters?: () => void;
  /** How many of the scope's tasks the filters hide, and how many filters. */
  filteredOut?: { hidden: number; filters: number };
  /** Display → Completed (tasks-v2 §6). Default: hidden. The Queue ignores it. */
  completed?: CompletedMode;
  /** Display → "Show on rows". */
  properties?: readonly string[];
  /** Display → Rows: Standard · Detailed. */
  rows?: RowPreset;
  /**
   * Display → Order by, inside each group. The Queue keeps its line-up. Only
   * Manual takes a drag reorder; a sorted list shows a quiet note instead of
   * the line, while nesting and cross-group drops still work.
   */
  order?: TaskOrder;
  /** The sort's direction (a Detailed header clicked twice). */
  orderDir?: OrderDirection;
  /** A Detailed column header clicked (asc → desc → the view's own order). */
  onSort?: (column: SortColumn) => void;
  /** Display → Subtasks: nested under their parent, or rows of their own. */
  subtasks?: SubtaskMode;
  /**
   * Tasks that stay listed whatever Display says, until the scope changes:
   * checked off here, or opened here (selected, deep-linked).
   */
  stayingIds?: ReadonlySet<string>;
  /** Enable drag-to-reorder (the Queue): a flat, ungrouped, ordered list. */
  reorderable?: boolean;
  /** Persist a reorder — receives the task ids in their new order, and runs
   *  `onSaved` once the server has it (the drop's Undo toast). */
  onReorder?: (orderedIds: string[], onSaved?: () => void) => void;
  /** Display → Order by back to Manual: the sorted drop toast's action. */
  onManualOrder?: () => void;
  /** One-shot deep-link reveal (DF-1): when the selection was set from outside
   * and sits in a collapsed group, expand that group exactly once. */
  revealRequest?: { id: string; seq: number } | null;
  /** "external" = an ancestor owns the DndContext (DF-22: so a center-pane task
   * row can be dragged onto the right-pane hub to link it); reorder/nest bind
   * via a monitor. Default "internal" (own DndContext) keeps stories/standalone
   * mounts working. */
  dndMode?: "internal" | "external";
  /** The workspace's task key ("MOD"): Detailed's handles. */
  taskKey?: string | null;
  /** The workspace's sections (Section grouping reads the scope project's). */
  sections?: readonly Section[];
  /** The workspace's teams (Team grouping). */
  teams?: readonly Team[];
  /** A project grouped by section: "+ Add section", and a section's ⋯. */
  onAddSection?: (name: string) => void;
  onRenameSection?: (sectionId: string, name: string) => void;
  onDeleteSection?: (sectionId: string) => void;
  /** ⏎ on the selected row: open it full (absent: ⏎ edits its title). */
  onOpenTask?: (taskId: string) => void;
  /**
   * Where the groups you fold are remembered (per person, view and grouping,
   * following the person: `listFoldKey`, TV-U8). Null: not remembered.
   */
  collapseKey?: string | null;
  /**
   * A view that groups its own way (Upcoming's days, TV-U15): these groups
   * replace Group by's, empty ones included, and a drop into one is the
   * view's to write.
   */
  grouping?: ListGrouping | null;
  /** Groups the view adds on top or at the end (My tasks' team block, the
   *  Inbox's snoozed tasks; TV-U15). */
  extraGroups?: readonly ListExtraGroup[];
  /**
   * The view's own keys (Upcoming's ⌥←/→, the Inbox's triage keys), asked
   * before the List's: true when the view handled it.
   */
  onViewKey?: (event: React.KeyboardEvent<HTMLDivElement>, selected: Task | null) => boolean;
  /** "Take it" on a team's unclaimed task (`extraGroups`' rows, TV-U15). */
  onTake?: (taskId: string) => void;
  /** Tasks a row offers "Take it" on. */
  takeableIds?: ReadonlySet<string>;
  /** Where a row's task came from (the Inbox's "from Mike"). */
  sourceOf?: (task: Task) => string | null;
  /** What this view says with nothing in it (a scope-aware teaching state). */
  emptyState?: ReactNode;
  /** A quiet line under the toolbar (the Inbox's "Only you see your Inbox…"). */
  note?: ReactNode;
  /** Groups that start folded in this view (All's On hold and Done projects). */
  defaultFolded?: (groupKey: string) => boolean;
  /** A group header's quiet line in this view (All: the project's area, "On hold"). */
  groupSub?: (groupKey: string) => ReactNode;
  /** What a group header counts: its open tasks (default), or all of them (Won't do). */
  countEvery?: boolean;
  api: TasksModuleApi;
};

const NO_IDS: ReadonlySet<string> = new Set();
const NO_SECTIONS: readonly Section[] = [];
const NO_TEAMS: readonly Team[] = [];
const NO_STATUS_NAMES: ReadonlyMap<string, ProjectStatus> = new Map<string, ProjectStatus>();
const NO_EXTRA_GROUPS: readonly ListExtraGroup[] = [];
const NO_ADD: GroupAddState = { kind: "none" };

/**
 * One line of the List as drawn (TV-D11b): the groups flattened, so the
 * stack can draw only what's on screen. A row knows its block (a top-level
 * task and its nested subtasks), whose last row carries the "Make subtask"
 * preview while a drag would nest into the block's parent.
 */
type ListItem =
  | { kind: "header"; key: string; groupKey: string }
  | {
      kind: "row";
      key: string;
      task: Task;
      depth: 0 | 1;
      groupKey: string;
      /** The block's top-level task. */
      blockId: string;
      /** The block's last drawn row. */
      blockEnd: boolean;
    }
  /** The group's "N completed · show" line (an extra group's "Show n more") and the gap after it. */
  | { kind: "end"; key: string; groupKey: string }
  /** The group's folded "Backlog · n" line (REPLAN 53b). */
  | { kind: "backlog"; key: string; groupKey: string }
  /** A project's "+ Add section" line. */
  | { kind: "add-section"; key: string };

/** First guesses at heights (px), corrected once an item is drawn. */
const ITEM_HEIGHT = { header: 28, row: 34, end: 4, backlog: 28, "add-section": 28 } as const;

/** A group as the List draws it. */
type ListGroup = {
  key: string;
  label: string;
  /** The rows shown (Display may hide completed ones, Backlog sits out). */
  tasks: Task[];
  /** Every task of the group in order, hidden ones included (drops land among them). */
  all: Task[];
  /** Completed tasks Display hides ("N completed · show"). */
  hidden: Task[];
  /** Backlog tasks folded behind "Backlog · n". */
  backlog: Task[];
  /** A group the view added (TV-U15): its own header, no drops. */
  extra?: ListExtraGroup;
  /** An extra group's rows past its limit ("Show n more"). */
  more?: Task[];
};

export function TaskListView({
  tasks,
  scopeTitle,
  selection,
  view,
  onViewChange,
  groupBy: chosenGroupBy,
  buckets,
  inbox,
  bucketNameById,
  canEdit,
  onRequestCapture,
  selectedTaskId,
  onSelectTask,
  multiSelect,
  orderRef,
  onShowsNothing,
  header,
  filterActive = false,
  onClearFilters,
  filteredOut,
  completed = "hidden",
  properties = DEFAULT_ROW_PROPERTIES,
  rows: rowPreset = "standard",
  order = "manual",
  orderDir = "asc",
  onSort,
  subtasks = "nested",
  stayingIds = NO_IDS,
  reorderable = false,
  onReorder,
  onManualOrder,
  revealRequest = null,
  dndMode = "internal",
  taskKey = null,
  sections = NO_SECTIONS,
  teams = NO_TEAMS,
  onAddSection,
  onRenameSection,
  onDeleteSection,
  onOpenTask,
  collapseKey = null,
  grouping = null,
  extraGroups = NO_EXTRA_GROUPS,
  onViewKey,
  onTake,
  takeableIds,
  sourceOf,
  emptyState,
  note,
  defaultFolded,
  groupSub,
  countEvery = false,
  api,
}: Props) {
  // Selection is owned by the parent (shared with the detail rail); these aliases
  // keep the keyboard-cursor logic below unchanged.
  const selectedId = selectedTaskId;
  const setSelectedId = onSelectTask;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [command, setCommand] = useState<{ taskId: string; kind: RowCommand } | null>(null);
  const [reordering, setReordering] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const dndSensors = useTaskDndSensors();
  // List drags have no SortableContext → the default keyboard sensor.
  const dragSensors = useTaskDndSensors({ sortable: false });
  const detailed = rowPreset === "detailed";

  // Standard names the project after the counts where it isn't implied;
  // Detailed has a column for it (tasks-v3 §4).
  const showBucketTag = !detailed && showBucketPill(selection, chosenGroupBy);
  // In My tasks every row is mine, so rows leave the avatar out (D4-4).
  const showAssignee = selection !== "mine";
  const { assignees, byId, currentUserId } = useAssignees();

  // Section grouping reads this project's sections; Team grouping the teams.
  const projectSections = useMemo(
    () =>
      isProjectScope(selection) ? sections.filter((s) => s.projectId === selection) : NO_SECTIONS,
    [sections, selection],
  );
  // A project with no sections yet, grouped by section, is the plain list:
  // ungrouped for every rule below (headers, drops, keys), so a drop never
  // writes a section that doesn't exist. Its "+ Add section" line stays.
  const groupBy: GroupBy =
    chosenGroupBy === "section" && projectSections.length === 0 ? "none" : chosenGroupBy;
  // The view's own grouping, or the List's; either way there are headers.
  const grouped = grouping !== null || groupBy !== "none";
  // Tasks the view's extra groups hold sit in none of the List's own groups.
  const extraIds = useMemo(() => new Set(extraGroups.flatMap((g) => g.taskIds)), [extraGroups]);
  const extraKeys = useMemo(() => new Set(extraGroups.map((g) => g.key)), [extraGroups]);

  // Subtasks nest under their parent (hidden from the top level) unless
  // Display says Flat, and never in the Queue — an ordered flat line-up whose
  // subtasks are queued one by one. A subtask whose parent isn't in this
  // scope renders as a normal top-level row instead (never invisible).
  const nest = selection !== "today" && subtasks === "nested";
  const nestedIds = useMemo(() => nestedSubtaskIds(tasks, nest), [tasks, nest]);
  const topLevelTasks = useMemo(
    () => (nestedIds.size === 0 ? tasks : tasks.filter((t) => !nestedIds.has(t.id))),
    [tasks, nestedIds],
  );
  // Per-parent expand state (collapsed by default — quiet until asked).
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  // Reserve the chevron gutter only when this scope actually nests something,
  // so subtask-free lists look exactly as before.
  const expandSlot = nestedIds.size > 0;
  // Parent titles for subtasks rendered flat (Today, or parent out of scope).
  const taskById = useMemo(() => new Map(api.tasks.map((t) => [t.id, t])), [api.tasks]);
  const parentTitleFor = (task: Task): string | null => {
    if (!task.parentId || nestedIds.has(task.id)) return null;
    const parent = taskById.get(task.parentId);
    return parent ? parent.title || "Untitled" : null;
  };

  // Groups whose hidden completed tasks were asked for ("· show"), and whose
  // folded Backlog was opened; both reset when the scope or grouping changes.
  const [revealedGroups, setRevealedGroups] = useState<ReadonlySet<string>>(NO_IDS);
  const [openBacklogs, setOpenBacklogs] = useState<ReadonlySet<string>>(NO_IDS);
  // The Backlog line you closed on the selection, with nowhere else to move
  // it: that line doesn't open again for it until the selection moves or you
  // open it yourself (MOD-124).
  const closedOnRef = useRef<{ key: string; id: string } | null>(null);

  // Completed tasks Display hides drop out of each group, behind its
  // "N completed · show" line (tasks-v2 §6), and Backlog tasks behind
  // "Backlog · n" (53b; grouped by status, Backlog is its own group, folded).
  // The Queue keeps its own rule: done leaves it, and a task checked off there
  // stays until the next load. The Date groups and "7 days" roll over at
  // midnight.
  const today = useToday();
  const groups = useMemo((): ListGroup[] => {
    const now = nowOn(today);
    // Sort, then group, so every group keeps the order (the Queue keeps its
    // line-up; a view's own grouping orders its own rows). Project groups
    // follow the rail; each task is in one group.
    const own =
      extraIds.size === 0 ? topLevelTasks : topLevelTasks.filter((t) => !extraIds.has(t.id));
    const ordered = grouping || selection === "today" ? [...own] : orderTasks(own, order, orderDir);
    const all = grouping
      ? grouping.groups(ordered, now)
      : groupTasks(ordered, groupBy, {
          bucketName: bucketNameById,
          bucketOrder: [...(inbox ? [inbox.id] : []), ...buckets.map((b) => b.id)],
          assignees,
          now,
          sections: projectSections,
          teams,
        });
    if (selection === "today") {
      return all.map((g) => ({ ...g, all: g.tasks, hidden: [], backlog: [] }));
    }
    // Kept even when done: staying (checked off or opened in this scope); the
    // selected task and its parent (a deep link or the panel must never point
    // at a row that isn't there, and a subtask nests under its parent); a
    // parent with open subtasks (they nest under it).
    const selectedParentId = selectedId ? (taskById.get(selectedId)?.parentId ?? null) : null;
    const keep = (t: Task) =>
      stayingIds.has(t.id) ||
      t.id === selectedId ||
      t.id === selectedParentId ||
      (api.subtasksByParent.get(t.id) ?? []).some(isUnfinished);
    // `all` keeps every task of the group in order, hidden ones included:
    // a drop is placed among them (TV-U1's rule, since `position` orders both).
    // Backlog stays in its line even when selected (the line opens for it
    // instead, so j/k walk the opened line in order); only a task checked off
    // here, or a parent with open subtasks, comes out of it.
    const keepOutOfBacklog = (t: Task) =>
      stayingIds.has(t.id) || (api.subtasksByParent.get(t.id) ?? []).some(isUnfinished);
    const mapped = all.map((g) => {
      const backlog =
        groupBy === "status" ? [] : g.tasks.filter((t) => isBacklogTask(t) && !keepOutOfBacklog(t));
      const rest = backlog.length === 0 ? g.tasks : g.tasks.filter((t) => !backlog.includes(t));
      const { shown, hidden } = partitionCompleted(rest, { mode: completed, now, keep });
      return {
        ...g,
        all: g.tasks,
        tasks: revealedGroups.has(g.key) ? rest : shown,
        hidden,
        backlog,
      };
    });
    if (extraGroups.length === 0) return mapped;
    // The view's own groups (TV-U15): their tasks in the given order, the
    // ones past the limit behind "Show n more"; an empty one isn't drawn.
    const listed = new Map(tasks.map((t) => [t.id, t]));
    const extra = (g: ListExtraGroup): ListGroup => {
      const list = g.taskIds.flatMap((id) => {
        const t = listed.get(id);
        return t ? [t] : [];
      });
      const limit = g.limit ?? list.length;
      return {
        key: g.key,
        label: g.label,
        all: list,
        tasks: revealedGroups.has(g.key) ? list : list.slice(0, limit),
        hidden: [],
        backlog: [],
        extra: g,
        more: list.slice(limit),
      };
    };
    const placed = (place: "lead" | "trail") =>
      extraGroups
        .filter((g) => g.place === place)
        .map(extra)
        .filter((g) => g.all.length > 0);
    return [...placed("lead"), ...mapped, ...placed("trail")];
  }, [
    grouping,
    extraGroups,
    extraIds,
    tasks,
    today,
    topLevelTasks,
    order,
    orderDir,
    groupBy,
    bucketNameById,
    inbox,
    buckets,
    assignees,
    projectSections,
    teams,
    selection,
    completed,
    stayingIds,
    selectedId,
    taskById,
    revealedGroups,
    api.subtasksByParent,
  ]);

  // ── folded groups, remembered (research §2) ─────────────────────────────────
  // Everything starts open except Backlog (grouped by status); what you fold
  // or open is remembered per person, view and grouping on this device.
  const defaultCollapsed = useCallback(
    (key: string) =>
      (groupBy === "status" && key === "backlog") ||
      (extraGroups.find((g) => g.key === key)?.folded ?? false) ||
      (defaultFolded?.(key) ?? false),
    [groupBy, extraGroups, defaultFolded],
  );
  const [choices, setChoices] = useState(() => ({
    key: collapseKey,
    folded: readFolds(collapseKey),
  }));
  let folded = choices.folded;
  if (choices.key !== collapseKey) {
    // Derive-on-render: the new view's choices replace the old in this render.
    folded = readFolds(collapseKey);
    setChoices({ key: collapseKey, folded });
  }
  const collapsed = useMemo(
    () => new Set(groups.map((g) => g.key).filter((k) => folded[k] ?? defaultCollapsed(k))),
    [groups, folded, defaultCollapsed],
  );
  const setFolded = useCallback((key: string, value: boolean) => {
    setChoices((prev) => {
      const next = { ...prev.folded, [key]: value };
      writeFold(prev.key, key, value);
      return { key: prev.key, folded: next };
    });
  }, []);

  // A new scope or grouping starts with every parent folded and every
  // "completed" and "Backlog" line closed.
  const viewSignature = `${selection}:${groupBy}`;
  const lastSignature = useRef(viewSignature);
  useEffect(() => {
    if (lastSignature.current === viewSignature) return;
    lastSignature.current = viewSignature;
    setExpandedParents(new Set());
    setRevealedGroups(NO_IDS);
    setOpenBacklogs(NO_IDS);
    closedOnRef.current = null;
  }, [viewSignature]);

  const toggleRevealGroup = useCallback((key: string) => {
    setRevealedGroups((prev) => toggled(prev, key));
  }, []);

  // ── the facts rows show (row-facts.ts, TV-D11b) ─────────────────────────────
  const sectionNames = useMemo(
    () => new Map((api.sections ?? []).map((s) => [s.id, s.name])),
    [api.sections],
  );
  // Ages ("5m", "3h") move on by the minute where they show: Detailed's
  // Updated and the waiting lines.
  const ageTick = useMinuteTick(detailed || (api.waiting?.length ?? 0) > 0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: ageTick re-reads the ages each minute.
  const waitingLabels = useMemo(
    () =>
      waitingLabelsOf(
        api.waiting ?? [],
        (id) => {
          const person = byId(id);
          return person ? (person.isMe ? "you" : person.name) : null;
        },
        nowOn(today),
      ),
    [api.waiting, byId, today, ageTick],
  );
  // The view's own date words (Upcoming's "3:00 PM · 45m", a snoozed row's
  // "until Fri"): they move on by the minute ("missed" once a session ends).
  const whenTick = useMinuteTick(!!grouping?.whenOf);
  // biome-ignore lint/correctness/useExhaustiveDependencies: whenTick re-reads the words each minute.
  const whenOf = useMemo(() => {
    const byExtra = new Map<string, NonNullable<ListExtraGroup["whenOf"]>>();
    for (const g of extraGroups) {
      if (!g.whenOf) continue;
      for (const id of g.taskIds) byExtra.set(id, g.whenOf);
    }
    const viewWhen = grouping?.whenOf;
    if (!viewWhen && byExtra.size === 0) return undefined;
    const now = nowOn(today);
    return (t: Task): string | null => {
      const own = byExtra.get(t.id);
      if (own) return own(t);
      return viewWhen ? viewWhen(t, now) : null;
    };
  }, [grouping, extraGroups, today, whenTick]);
  // TV-D16: "Claude · working" on the rows an agent session you can see works
  // on ("Anna's Claude · working" when it's a teammate's, first name only).
  const agentMarks = useMemo(
    () =>
      agentRowMarks(
        api.agentSessions ?? NO_AGENT_SESSIONS,
        (id) => taskById.get(id) ?? null,
        (s) => agentWho(s, currentUserId, (id) => byId(id)?.fullName.trim().split(/\s+/)[0]),
      ),
    [api.agentSessions, taskById, currentUserId, byId],
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
      whenOf,
      takeableIds,
      sourceOf,
      agentMarks,
    }),
    [
      agentMarks,
      whenOf,
      takeableIds,
      sourceOf,
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

  // ── columns ──────────────────────────────────────────────────────────────────
  // From every row the view can show (the listed rows, their subtasks and the
  // folded Backlog), so the meta lines up and expanding never pops a column
  // in (tasks-v2 §6, U1-1).
  const listedRows = useMemo(() => {
    const out: Task[] = [];
    for (const group of groups) {
      for (const task of [...group.tasks, ...group.backlog]) {
        out.push(task);
        if (nest) out.push(...(api.subtasksByParent.get(task.id) ?? []));
      }
    }
    return out;
  }, [groups, nest, api.subtasksByParent]);
  const columns = useMemo(
    () =>
      rowColumns(listedRows, {
        properties,
        rows: rowPreset,
        showAssignee: showAssignee && assignees.length > 1,
        canEdit,
        isQueued: (id) => api.queuedTaskIds.has(id),
        isClaimed: (id) => (api.queueClaims.get(id)?.length ?? 0) > 0,
        taskKey,
        isWaiting: (id) => waitingLabels.has(id),
        hasWhen: whenOf ? (t) => !!whenOf(t) : undefined,
      }),
    [
      whenOf,
      listedRows,
      properties,
      rowPreset,
      showAssignee,
      assignees.length,
      canEdit,
      api.queuedTaskIds,
      api.queueClaims,
      taskKey,
      waitingLabels,
    ],
  );
  // Each sized column is as wide as its widest value in view (call 41), the
  // same on every row and the header: the frame's `--tl-col-*` variables.
  // Each task's words are kept per task object (the store keeps an unchanged
  // task's object), so an edit re-reads one row, not 10,000 (TV-D11b's
  // budget); anything else the words depend on starts the cache again.
  // biome-ignore lint/correctness/useExhaustiveDependencies: each dep is what the cached words depend on; a change starts a new cache.
  const textCache = useMemo(
    () => new WeakMap<Task, RowTexts>(),
    [
      whenOf,
      today,
      ageTick,
      detailed,
      byId,
      taskKey,
      bucketNameById,
      sectionNames,
      api.statusById,
      waitingLabels,
    ],
  );
  const widths = useMemo(() => {
    const now = nowOn(today);
    const statusById = api.statusById ?? NO_STATUS_NAMES;
    const cache = textCache;
    const textsOf = (t: Task): RowTexts => {
      const known = cache.get(t);
      if (known) return known;
      const person = t.assigneeId ? byId(t.assigneeId) : null;
      const texts: RowTexts = detailed
        ? {
            handle: handleLabel(taskKey, t.number),
            project: projectLabel(
              bucketNameById(t.bucketId),
              t.sectionId ? (sectionNames.get(t.sectionId) ?? null) : null,
            ),
            status: statusNameOf(t, statusById),
            due: dueLabel(t, now),
            session: sessionLabel(t, now),
            time: rowTime(t),
            waiting: waitingLabels.get(t.id) ?? null,
            assignee: person ? person.name.trim().split(/\s+/)[0] : null,
            updated: updatedLabel(t, now),
          }
        : // Standard sizes only its date column (most tasks have none).
          {
            date:
              whenOf?.(t) ?? (t.scheduledAt || t.dueDate ? (rowDate(t, now)?.label ?? null) : null),
          };
      cache.set(t, texts);
      return texts;
    };
    return columnWidths(listedRows.map(textsOf), { headers: detailed });
  }, [
    whenOf,
    listedRows,
    textCache,
    today,
    detailed,
    byId,
    taskKey,
    bucketNameById,
    sectionNames,
    api.statusById,
    waitingLabels,
  ]);
  // Detailed drops whole columns as the centre narrows (research §1). Only
  // Detailed measures, in 16 px steps, and only a real change is set: a set
  // to the same value still costs the list a draw on its next update.
  const [frameWidth, setFrameWidth] = useState(0);
  const measuredRef = useRef(0);
  // One `ch` of the cells' face, measured once (the columns' widths are in it).
  const [chPx, setChPx] = useState(DEFAULT_CH_PX);
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!detailed || !el || typeof ResizeObserver === "undefined") return;
    const probe = document.createElement("span");
    probe.className = "invisible absolute font-sans text-xs";
    probe.style.width = "100ch";
    el.appendChild(probe);
    const ch = probe.getBoundingClientRect().width / 100;
    probe.remove();
    if (ch > 0 && Math.abs(ch - DEFAULT_CH_PX) > 0.05) setChPx(ch);
    const measure = () => {
      const next = Math.floor(el.clientWidth / 16) * 16;
      if (next === measuredRef.current) return;
      measuredRef.current = next;
      setFrameWidth(next);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [detailed]);
  const fitted = useMemo(
    () => fitColumns(columns, widths, frameWidth, rowPreset, chPx),
    [columns, widths, frameWidth, rowPreset, chPx],
  );
  const frameStyle = useMemo(() => {
    const style: Record<string, string> = {};
    for (const col of SIZED_COLUMNS) style[columnVar(col)] = `${widths[col]}ch`;
    return style as CSSProperties;
  }, [widths]);

  const toggleExpandParent = useCallback((id: string) => {
    setExpandedParents((prev) => toggled(prev, id) as Set<string>);
  }, []);

  /** A group's rows as drawn: its shown tasks, then its Backlog when opened. */
  const rowsOf = useCallback(
    (group: ListGroup): Task[] =>
      openBacklogs.has(group.key) ? [...group.tasks, ...group.backlog] : group.tasks,
    [openBacklogs],
  );

  // Flat, visually-ordered list of navigable tasks (skips collapsed groups,
  // includes the children of expanded parents — keyboard order = visual order).
  // A task is one stop, at its first row (a guard: every grouping lists it once).
  const visibleTasks = useMemo(() => {
    const out: Task[] = [];
    const seen = new Set<string>();
    const push = (task: Task) => {
      if (seen.has(task.id)) return;
      seen.add(task.id);
      out.push(task);
    };
    for (const group of groups) {
      if (collapsed.has(group.key)) continue;
      for (const task of rowsOf(group)) {
        push(task);
        // Only nested subtasks sit under their parent; Flat lists them as
        // rows of their own, in their own place.
        if (nest && expandedParents.has(task.id)) {
          for (const child of api.subtasksByParent.get(task.id) ?? []) push(child);
        }
      }
    }
    return out;
  }, [groups, collapsed, rowsOf, expandedParents, nest, api.subtasksByParent]);

  const toggleBacklog = useCallback(
    (key: string) => {
      // Closing a line that holds the selection: the selection steps up to the
      // row above the line, else to the first row still shown outside it; with
      // none, it stays where it is (MOD-124). Never nothing: the page's
      // backstop would pick again, and its pick could be in this very line.
      const group = openBacklogs.has(key) ? groups.find((g) => g.key === key) : undefined;
      if (group && selectedId) {
        const parentId = taskById.get(selectedId)?.parentId ?? null;
        const holds = group.backlog.some((t) => t.id === selectedId || t.id === parentId);
        if (holds) {
          const closing = new Set(group.backlog.map((t) => t.id));
          const next =
            group.tasks[group.tasks.length - 1] ??
            visibleTasks.find((t) => !closing.has(t.id) && !closing.has(t.parentId ?? ""));
          if (next) setSelectedId(next.id);
          else {
            // It stays, inside the line you closed: the line mustn't open for it.
            closedOnRef.current = { key, id: selectedId };
            setOpenBacklogs((prev) => toggled(prev, key));
            return;
          }
        }
      }
      // Opening that same line again is yours to do; another line leaves it shut.
      if (closedOnRef.current?.key === key) closedOnRef.current = null;
      setOpenBacklogs((prev) => toggled(prev, key));
    },
    [openBacklogs, groups, selectedId, taskById, visibleTasks, setSelectedId],
  );

  // Keep the selection valid as tasks change. A selected subtask under a
  // visible-but-collapsed parent isn't stolen — its parent expands into view
  // instead (the detail panel's subtask list navigates selection this way).
  // A deep link may additionally target a task inside a collapsed group
  // (DF-1): the one-shot `revealRequest` expands that group exactly once.
  // Ordinary fallbacks (complete/archive into a collapsed group, scope
  // switches) never touch collapse state — a group the user closes stays
  // closed.
  const consumedRevealSeqRef = useRef(0);
  useEffect(() => {
    const reveal =
      revealRequest &&
      revealRequest.id === selectedId &&
      consumedRevealSeqRef.current !== revealRequest.seq
        ? revealRequest
        : null;
    if (reveal) consumedRevealSeqRef.current = reveal.seq;
    // The line you closed on the selection stays closed for it, until the
    // selection moves (MOD-124).
    const closedOn = closedOnRef.current?.id === selectedId ? closedOnRef.current : null;
    if (!closedOn) closedOnRef.current = null;
    if (selectedId && visibleTasks.some((t) => t.id === selectedId)) return;
    if (selectedId) {
      const parentId = taskById.get(selectedId)?.parentId;
      if (parentId && visibleTasks.some((t) => t.id === parentId)) {
        if (nest) {
          setExpandedParents((prev) => (prev.has(parentId) ? prev : new Set(prev).add(parentId)));
        }
        return;
      }
      const holds = (t: Task) => t.id === selectedId || (!!parentId && t.id === parentId);
      if (reveal) {
        const collapsedGroup = groups.find((g) => collapsed.has(g.key) && g.tasks.some(holds));
        if (collapsedGroup) {
          setFolded(collapsedGroup.key, false);
          return;
        }
      }
      // A selected task in a folded Backlog line (a search, a link, its status
      // set to Backlog): the line opens for it, unless you just closed it on it.
      const inBacklog = groups.find(
        (g) =>
          !collapsed.has(g.key) &&
          !openBacklogs.has(g.key) &&
          g.backlog.some(holds) &&
          (reveal || closedOn?.key !== g.key),
      );
      if (inBacklog) {
        setOpenBacklogs((prev) => new Set(prev).add(inBacklog.key));
        return;
      }
    }
    // Nothing to show (every group with tasks folded): the page's own choice
    // stands. Its backstop picked again whenever this cleared it, and the two
    // flipped the selection back and forth until React gave up (MOD-122); the
    // page's panel shows the project meanwhile (`onShowsNothing`, MOD-123).
    if (visibleTasks.length === 0) return;
    setSelectedId(visibleTasks[0].id);
  }, [
    visibleTasks,
    selectedId,
    setSelectedId,
    taskById,
    nest,
    groups,
    collapsed,
    openBacklogs,
    revealRequest,
    setFolded,
  ]);

  // Keyboard-first: focus the list once on mount so j/k work immediately —
  // unless focus is already somewhere intentional (an input, an open dialog).
  // Quietly: a browser counts a script's focus on a fresh load as keyboard
  // focus and would ring the whole list, so the ring waits for a key on the
  // list or for focus to come back by keyboard (MOD-121; onKeyDown, onBlur).
  useEffect(() => {
    const active = document.activeElement;
    const list = containerRef.current;
    if (!list || (active && active !== document.body)) return;
    list.dataset.quietFocus = "";
    list.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (visibleTasks.length === 0) return;
      const idx = visibleTasks.findIndex((t) => t.id === selectedId);
      const nextIdx = idx < 0 ? 0 : Math.min(visibleTasks.length - 1, Math.max(0, idx + delta));
      setSelectedId(visibleTasks[nextIdx]?.id ?? null);
    },
    [visibleTasks, selectedId, setSelectedId],
  );

  const selectedTask = visibleTasks.find((t) => t.id === selectedId) ?? null;

  // Multi-select (TV-U12): a row hands its click's ⇧ / ⌘ to the page's
  // selection with the order on screen (folded groups left out), so a range
  // is what you see; a row scrolled away stays selected (it's a set of ids).
  const visibleOrder = useMemo(() => visibleTasks.map((t) => t.id), [visibleTasks]);
  const selectionRef = useRef({ multiSelect, visibleOrder });
  useLayoutEffect(() => {
    selectionRef.current = { multiSelect, visibleOrder };
    if (orderRef) orderRef.current = visibleOrder;
  });
  // No row shown while there are tasks (every group that holds them folded):
  // the page's panel shows the project, not a task you can't see (MOD-123).
  // Said only when it changes, so the page draws once more only then, and
  // taken back when the List goes away.
  const showsNothing = api.loaded && tasks.length > 0 && visibleOrder.length === 0;
  const saidNothingRef = useRef(false);
  const onShowsNothingRef = useRef(onShowsNothing);
  useLayoutEffect(() => {
    onShowsNothingRef.current = onShowsNothing;
    if (saidNothingRef.current === showsNothing) return;
    saidNothingRef.current = showsNothing;
    onShowsNothing?.(showsNothing);
  });
  useLayoutEffect(
    () => () => {
      if (saidNothingRef.current) onShowsNothingRef.current?.(false);
    },
    [],
  );
  const onRowSelect = useCallback(
    (id: string, mods?: SelectMods) => {
      const { multiSelect: multi, visibleOrder: order } = selectionRef.current;
      if (multi) multi.select(id, mods ?? PLAIN_SELECT, order);
      else setSelectedId(id);
    },
    [setSelectedId],
  );
  const multiIds = multiSelect?.ids ?? NO_IDS;

  // ── drops and move keys (TV-U4) ──────────────────────────────────────────────
  // Manual order lives inside one project (order.ts, default m): a drag or a
  // move key writes a position only in a project or the Inbox under Manual.
  // Every drop ends in one Undo toast, shown once it saved (api.dropTask).
  const dragOrder = dragOrderFor(selection, order);
  const inboxId = inbox?.id ?? null;
  const assignableIds = useMemo(
    () => new Set(assignees.filter((a) => a.canTakeTasks).map((a) => a.userId)),
    [assignees],
  );
  const dropNames = useMemo<DropNames>(
    () => ({
      bucketName: bucketNameById,
      assigneeName: (id) => {
        const person = assignees.find((a) => a.userId === id);
        return person ? (person.isMe ? "you" : person.name) : "a former member";
      },
      taskTitle: (id) => taskById.get(id)?.title || "Untitled",
      sectionName: (id) => (id ? (sectionNames.get(id) ?? "a section") : "No section"),
      teamName: (id) => (id ? (teams.find((t) => t.id === id)?.name ?? "a team") : "No team"),
    }),
    [bucketNameById, assignees, taskById, sectionNames, teams],
  );
  const drop = useCallback(
    (write: TaskDropWrite, before: Task, label?: string) => {
      void api.dropTask(write, label ?? dropLabel(write, dropNames, before));
    },
    [api, dropNames],
  );
  // A sorted project view asks to switch back before a reorder (default m).
  const askManualOrder = useCallback(() => {
    if (order === "manual") return;
    toast(sortedByLabel(order), {
      action: onManualOrder ? { label: BACK_TO_MANUAL_ORDER, onClick: onManualOrder } : undefined,
    });
  }, [order, onManualOrder]);
  const refuseReorder = useCallback(() => {
    if (dragOrder === "sorted") askManualOrder();
    else toast("Tasks keep their order inside each project.");
  }, [dragOrder, askManualOrder]);

  // The task's siblings as listed: its parent's subtasks when nested here,
  // else the top-level rows of its group.
  const siblingsOf = useCallback(
    (task: Task): Task[] => {
      if (task.parentId && nestedIds.has(task.id)) {
        return api.subtasksByParent.get(task.parentId) ?? [];
      }
      const group = groups.find((g) => rowsOf(g).some((t) => t.id === task.id));
      return group ? rowsOf(group) : [];
    },
    [nestedIds, api.subtasksByParent, groups, rowsOf],
  );

  /** `>`: a subtask of the row above (one level; a subtask lives in its
   *  parent's project, so across projects it moves there). */
  const nestUnderAbove = useCallback(
    (task: Task) => {
      if (nestedIds.has(task.id)) return; // already a subtask here
      const siblings = siblingsOf(task);
      const above = siblings[siblings.findIndex((t) => t.id === task.id) - 1];
      if (!above) return;
      const hasKids = (id: string) => (api.subtasksByParent.get(id)?.length ?? 0) > 0;
      if (!canNestUnder(task, above, hasKids)) {
        toast(
          hasKids(task.id)
            ? "Subtasks are one level — this task has subtasks of its own."
            : "Subtasks are one level — that task is already a subtask.",
        );
        return;
      }
      if (!canMoveInto(above.bucketId, task, inboxId)) {
        toast("A project’s task can’t become a subtask of an Inbox task.");
        return;
      }
      const write: TaskDropWrite = { taskId: task.id, parentId: above.id };
      if (above.bucketId !== task.bucketId) write.bucketId = above.bucketId;
      if (nest) setExpandedParents((prev) => new Set(prev).add(above.id));
      drop(write, task);
    },
    [nestedIds, siblingsOf, api.subtasksByParent, inboxId, nest, drop],
  );

  /** `<`: out of its parent, to the top level right after the parent (where
   *  the order is manual; elsewhere it keeps its place in the order). */
  const unnest = useCallback(
    (task: Task) => {
      if (!task.parentId) return;
      const write: TaskDropWrite = { taskId: task.id, parentId: null };
      if (dragOrder === "manual") {
        const position = positionNextTo(api.tasks, { id: task.parentId, edge: "after" }, task.id);
        if (position !== null) write.position = position;
      }
      drop(write, task);
    },
    [dragOrder, api.tasks, drop],
  );

  /** ⌥⇧↑/↓: one place up or down among its siblings, in the manual order
   *  (a nested subtask in any order: its parent's subtasks keep their own). */
  const moveInOrder = useCallback(
    (task: Task, delta: 1 | -1) => {
      if (dragOrder !== "manual" && !nestedIds.has(task.id)) {
        refuseReorder();
        return;
      }
      const siblings = siblingsOf(task);
      const neighbour = siblings[siblings.findIndex((t) => t.id === task.id) + delta];
      if (!neighbour) return;
      const position = positionNextTo(
        api.tasks,
        { id: neighbour.id, edge: delta < 0 ? "before" : "after" },
        task.id,
      );
      if (position === null) return;
      drop({ taskId: task.id, position }, task, delta < 0 ? "Moved up" : "Moved down");
    },
    [dragOrder, refuseReorder, siblingsOf, api.tasks, drop, nestedIds],
  );

  // The Queue's line-up is the queue's own (`task_queue`): a drag or a move
  // key there reorders it, with the same Undo once it saved.
  const reorderQueueWithUndo = useCallback(
    (previous: string[], next: string[], label: string) => {
      onReorder?.(next, () => undoToast(label, { onUndo: () => onReorder?.(previous) }));
    },
    [onReorder],
  );
  const moveInQueue = useCallback(
    (task: Task, delta: 1 | -1) => {
      if (!reorderable) return;
      const ids = (groups[0]?.tasks ?? []).map((t) => t.id);
      const from = ids.indexOf(task.id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= ids.length) return;
      reorderQueueWithUndo(ids, arrayMove(ids, from, to), delta < 0 ? "Moved up" : "Moved down");
    },
    [reorderable, groups, reorderQueueWithUndo],
  );

  // Row props, shared by the grouped and the reorderable (Queue) renders.
  // Every callback takes the task's id and keeps its identity, and the
  // actions object never changes, so a memoised row redraws only when its
  // own task, facts or state do (TV-D11b: one edit, one row).
  const actions = useRowActions(api);

  // Files dropped on a row attach to its task (AT-3, AT3-1).
  const fileDrop = useTaskFileDrop({
    canEdit,
    taskOf: (id) => taskById.get(id),
    userId: api.currentUserId,
    pendingTaskIds: api.pendingTaskIds,
    onOpen: (id) => onSelectTask(id),
  });

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Typing on the list (not a ⌘/⌃/⌥ shortcut out of it) is keyboard use:
      // the mount's quiet focus shows its ring from here on (MOD-121).
      if (!e.metaKey && !e.ctrlKey && !e.altKey) delete e.currentTarget.dataset.quietFocus;
      // While inline-editing a title, the Input stops propagation. During a
      // keyboard reorder the dnd sensor owns the arrows — don't also move the cursor.
      if (editingId || reordering) return;
      // The view's own keys first (Upcoming's ⌥←/→, the Inbox's triage keys,
      // TV-U15): only from the list itself, never a field or a row's portaled
      // surface (React bubbles those here too).
      if (
        onViewKey &&
        e.target instanceof Node &&
        e.currentTarget.contains(e.target) &&
        !(e.target instanceof HTMLElement && e.target.closest("input, textarea, [contenteditable]"))
      ) {
        const selectedNow = visibleTasks.find((t) => t.id === selectedId) ?? null;
        if (onViewKey(e, selectedNow)) {
          e.preventDefault();
          return;
        }
      }
      // Keys from a row's portaled popover or context menu, modified keys (⌘K,
      // ⌘⇧K, ⌘C… stay the app's and the OS's) and a row button's own Space/Enter
      // aren't the list's — see list-keys.ts.
      const action = listKeyActionFor(e, e.currentTarget);
      if (!action) return;
      // A list key pressed while focus sits on something inside the list (a
      // button Chromium focused on click, a title) hands focus back to the
      // list, so the next Space/Enter acts on the selected row, not that button.
      if (e.target !== e.currentTarget) e.currentTarget.focus({ preventScroll: true });
      switch (action) {
        case "next":
          e.preventDefault();
          multiSelect?.clear();
          move(1);
          return;
        case "prev":
          e.preventDefault();
          multiSelect?.clear();
          move(-1);
          return;
        case "extend-next":
        case "extend-prev":
          if (!multiSelect) return;
          e.preventDefault();
          multiSelect.extend(action === "extend-next" ? 1 : -1, visibleOrder);
          return;
        case "select-all":
          if (!multiSelect) return;
          e.preventDefault();
          multiSelect.selectAll(visibleOrder);
          return;
        case "clear-selection":
          if (multiSelect?.clear()) e.preventDefault();
          return;
        case "toggle-done":
          // The status icon's click (default k): finish, or reopen a closed one.
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          activateGlyph(selectedTask, actions);
          return;
        case "open":
          if (!selectedTask) return;
          // A host with no full page (a story) keeps ⏎ as edit.
          if (onOpenTask) {
            e.preventDefault();
            onOpenTask(selectedTask.id);
            return;
          }
          if (!canEdit) return;
          e.preventDefault();
          setEditingId(selectedTask.id);
          return;
        case "edit":
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          setEditingId(selectedTask.id);
          return;
        case "capture":
          e.preventDefault();
          onRequestCapture();
          return;
        case "bucket":
        case "schedule":
        case "due":
        case "status":
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          setCommand({ taskId: selectedTask.id, kind: action });
          return;
        case "queue":
          // Queue/unqueue the selected task (Round D: `q` is the queue key — was
          // `t` from when the queue was "Today"; the rename makes `q` canonical).
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          api.toggleQueue(selectedTask.id);
          return;
        case "focus-on":
          // ⇧F: on top of Up next, with the one clock (call 31).
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          api.focusOnTask(selectedTask.id);
          return;
        case "expand":
          // expand the selected parent's subtasks
          if (!selectedTask || !nest) return;
          if ((api.subtasksByParent.get(selectedTask.id)?.length ?? 0) > 0) {
            e.preventDefault();
            setExpandedParents((prev) => new Set(prev).add(selectedTask.id));
          }
          return;
        case "collapse":
          // collapse the selected parent — or jump from a subtask to its parent
          if (!selectedTask) return;
          if (expandedParents.has(selectedTask.id)) {
            e.preventDefault();
            toggleExpandParent(selectedTask.id);
          } else if (selectedTask.parentId && nestedIds.has(selectedTask.id)) {
            e.preventDefault();
            setSelectedId(selectedTask.parentId);
          }
          return;
        case "delete":
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          api.deleteTask(selectedTask.id);
          return;
        // The Queue keeps its own line-up: these keys are the lists' (TV-U4).
        case "nest":
          if (!selectedTask || !canEdit || selection === "today") return;
          e.preventDefault();
          nestUnderAbove(selectedTask);
          return;
        case "unnest":
          if (!selectedTask || !canEdit || selection === "today") return;
          e.preventDefault();
          unnest(selectedTask);
          return;
        case "move-up":
        case "move-down":
          if (!selectedTask || !canEdit) return;
          e.preventDefault();
          if (selection === "today") moveInQueue(selectedTask, action === "move-up" ? -1 : 1);
          else moveInOrder(selectedTask, action === "move-up" ? -1 : 1);
          return;
      }
    },
    [
      editingId,
      reordering,
      move,
      selectedTask,
      canEdit,
      actions,
      api,
      onRequestCapture,
      nest,
      nestedIds,
      expandedParents,
      toggleExpandParent,
      setSelectedId,
      selection,
      nestUnderAbove,
      unnest,
      moveInOrder,
      moveInQueue,
      onOpenTask,
      onViewKey,
      visibleTasks,
      selectedId,
      multiSelect,
      visibleOrder,
    ],
  );

  const toggleGroup = (key: string) => setFolded(key, !collapsed.has(key));

  const endEdit = useCallback(() => {
    setEditingId(null);
    containerRef.current?.focus();
  }, []);
  const clearCommand = useCallback(() => {
    setCommand(null);
    // Back to the list, unless closing came from clicking into another field.
    const active = document.activeElement;
    const leftForElsewhere =
      active instanceof HTMLElement &&
      active !== document.body &&
      !containerRef.current?.contains(active) &&
      // The row's own editors: the date popovers and the bucket menu.
      !active.closest('[data-slot="popover-content"], [data-slot="dropdown-menu-content"]');
    if (!leftForElsewhere) containerRef.current?.focus();
  }, []);
  const requestCommand = useCallback(
    (taskId: string, kind: RowCommand) => setCommand({ taskId, kind }),
    [],
  );
  const inboxIdForRows = inbox?.id ?? null;
  const buildRowProps = (t: Task) => ({
    task: t,
    bucketName: bucketNameById(t.bucketId),
    inboxId: inboxIdForRows,
    showBucket: showBucketTag,
    showAssignee,
    selected: t.id === selectedId || multiIds.has(t.id),
    editing: t.id === editingId,
    command: command?.taskId === t.id ? command.kind : null,
    canEdit,
    facts: taskFactsOf(t, factsSource),
    actions,
    today,
    ageTick: fitted.updated ? ageTick : 0,
    onSelect: onRowSelect,
    onStartEdit: setEditingId,
    onEndEdit: endEdit,
    onClearCommand: clearCommand,
    onRequestCommand: requestCommand,
    columns: fitted,
    taskKey,
    onTake,
  });

  // ── drag and drop (tasks-v2 §8, TV-U4) ──────────────────────────────────────
  // Every row is a drag source (the Queue keeps its own sortable below). The
  // List has no droppables: where a drop lands is resolved from the raw
  // pointer against the rows' boxes (drop-mode.ts) — left of the indent
  // reorders (insertion line), right of it nests (the row tints, a "Make
  // subtask" preview shows), a group header takes it into the group. The
  // rail and the hub are droppables of the page's one context; a drop on
  // them is the page's, so this list stands back.
  const canDrag = canEdit && selection !== "today";
  const [dragId, setDragId] = useState<string | null>(null);
  const [hover, setHover] = useState<ListDropHover | null>(null);
  const pointerRef = useRef<{ x: number; y: number } | null>(null);

  const hasChildren = useCallback(
    (id: string) => (api.subtasksByParent.get(id)?.length ?? 0) > 0,
    [api.subtasksByParent],
  );

  // Every row on screen, with what a drop needs to know about it.
  const rowIndex = useMemo(() => {
    const index = new Map<
      string,
      { task: Task; depth: 0 | 1; groupKey: string; lastChildId: string | null }
    >();
    for (const group of groups) {
      if (collapsed.has(group.key)) continue;
      for (const task of rowsOf(group)) {
        const children =
          nest && expandedParents.has(task.id) ? (api.subtasksByParent.get(task.id) ?? []) : [];
        index.set(task.id, {
          task,
          depth: 0,
          groupKey: group.key,
          lastChildId: children[children.length - 1]?.id ?? null,
        });
        for (const child of children) {
          index.set(child.id, { task: child, depth: 1, groupKey: group.key, lastChildId: null });
        }
      }
    }
    return index;
  }, [groups, collapsed, rowsOf, nest, expandedParents, api.subtasksByParent]);

  const dragTask = dragId ? (taskById.get(dragId) ?? null) : null;

  // What's under (x, y) in this list: a row, a group header, `undefined`
  // inside a row's block but off its rows (the "Make subtask" preview, which
  // takes no pointer events — the hover stays), or null anywhere else (empty
  // space, outside the list): releasing there drops nothing.
  const targetAt = useCallback(
    (x: number, y: number): ListPointerTarget | null | undefined => {
      const container = containerRef.current;
      if (!container) return null;
      const stack = document.elementsFromPoint(x, y);
      if (!stack.some((el) => container.contains(el))) return null;
      for (const el of stack) {
        if (!container.contains(el)) continue;
        const rowEl = el.closest<HTMLElement>("[data-list-row]");
        if (rowEl && container.contains(rowEl)) {
          const info = rowIndex.get(rowEl.dataset.listRow ?? "");
          if (!info) return undefined;
          const r = rowEl.getBoundingClientRect();
          return { type: "row", ...info, rect: { left: r.left, top: r.top, height: r.height } };
        }
        const groupEl = el.closest<HTMLElement>("[data-list-group]");
        if (groupEl && container.contains(groupEl)) {
          return { type: "group", groupKey: groupEl.dataset.listGroup ?? "" };
        }
        const blockEl = el.closest("[data-list-block]");
        if (blockEl && container.contains(blockEl)) return undefined;
      }
      return null;
    },
    [rowIndex],
  );

  const hoverAt = useCallback(
    (x: number, y: number, previous: ListDropHover | null): ListDropHover | null => {
      // A view's extra groups (a team block, the snoozed) neither give nor take.
      if (!dragTask || extraIds.has(dragTask.id)) return null;
      const over = targetAt(x, y);
      if (over === undefined) return previous;
      const now = nowOn(today);
      const next = resolveListHover({
        active: dragTask,
        activeNested: rowIndex.get(dragTask.id)?.depth === 1,
        activeGroupKey: grouping
          ? grouping.keyOf(dragTask, now)
          : groupKeyFor(dragTask, groupBy, now),
        hasChildren,
        pointer: { x, y },
        over,
        order: dragOrder,
        accepts: (key) =>
          !extraKeys.has(key) &&
          (grouping
            ? grouping.accepts(key, dragTask)
            : groupAccepts(groupBy, key, dragTask, { inboxId, assignableIds })),
        // A view's own grouping is about its days, never about subtasks.
        canNestInto: (parent) =>
          !grouping && !extraIds.has(parent.id) && canMoveInto(parent.bucketId, dragTask, inboxId),
      });
      // A drop "into the group" is drawn on the group's header; an ungrouped
      // list has none, so it would happen unseen (a subtask quietly coming out
      // of its parent in a sorted list): no drop. `<` still un-nests.
      return !grouped && next?.kind === "group" ? null : next;
    },
    [
      dragTask,
      targetAt,
      rowIndex,
      groupBy,
      grouping,
      grouped,
      extraIds,
      extraKeys,
      today,
      hasChildren,
      dragOrder,
      inboxId,
      assignableIds,
    ],
  );

  // Track the raw pointer while dragging and re-resolve on every move and on
  // scroll (auto-scroll moves rows under a still pointer). The drop resolves
  // again from the same coordinates, never from dnd-kit's delta (gotchas/ui.md).
  useEffect(() => {
    if (!dragId) return;
    const update = () => {
      const p = pointerRef.current;
      if (!p) return;
      setHover((prev) => {
        const next = hoverAt(p.x, p.y, prev);
        return sameHover(prev, next) ? prev : next;
      });
    };
    const onMove = (e: PointerEvent) => {
      pointerRef.current = { x: e.clientX, y: e.clientY };
      update();
    };
    document.addEventListener("pointermove", onMove, { capture: true });
    const container = containerRef.current;
    container?.addEventListener("scroll", update, { passive: true });
    return () => {
      document.removeEventListener("pointermove", onMove, { capture: true });
      container?.removeEventListener("scroll", update);
    };
  }, [dragId, hoverAt]);

  const onListDragStart = useCallback(
    (e: DragStartEvent) => {
      const drag = asTaskDrag(e.active.data.current);
      if (drag?.from !== "list" || !rowIndex.has(drag.taskId)) return;
      setReordering(true); // the dnd sensor owns the arrows during a keyboard drag
      const start = e.activatorEvent;
      pointerRef.current =
        start instanceof PointerEvent || start instanceof MouseEvent
          ? { x: start.clientX, y: start.clientY }
          : null;
      setDragId(drag.taskId);
      setHover(null);
    },
    [rowIndex],
  );
  const endListDrag = useCallback(() => {
    setReordering(false);
    setDragId(null);
    setHover(null);
  }, []);

  // A plan becomes one write, saved in order (field-level, then status, then
  // assignee: never two writes to the row at once) with one Undo.
  const applyPlan = useCallback(
    (plan: ListDropPlan, active: Task) => {
      const parentId = plan.parentId;
      if (parentId && nest) setExpandedParents((prev) => new Set(prev).add(parentId));
      const write = writeFromPlan(plan);
      // A row of a selection carries the selection (TV-U12): the same change
      // for each, behind the held row, as one write with one Undo.
      const { multiSelect: multi, visibleOrder: order } = selectionRef.current;
      if (multi && multi.ids.size >= 2 && multi.ids.has(active.id)) {
        const writes = multiDropWrites(write, active, inViewOrder(multi.ids, order), api.tasks);
        if (writes.length === 0) return;
        void api.bulkWrite(writes, {
          label: (n) =>
            n === 1 ? dropLabel(write, dropNames, active) : multiDropLabel(write, n, dropNames),
        });
        return;
      }
      drop(write, active);
    },
    [nest, drop, api, dropNames],
  );

  const onListDragEnd = useCallback(
    (e: DragEndEvent) => {
      const id = dragId;
      const last = hover;
      endListDrag();
      if (!id || String(e.active.id) !== id) return;
      // The rail and the hub take their own drops (the page handles them).
      if (e.over && isSideDroppable(e.over.id)) return;
      const active = taskById.get(id);
      const p = pointerRef.current;
      if (!active || !p) return;
      const final = hoverAt(p.x, p.y, last);
      if (!final) return;
      // Dragging while sorted asks to switch back first (default m).
      if (final.kind === "sorted") {
        askManualOrder();
        return;
      }
      // A view's own grouping writes its own drops (Upcoming: another day).
      if (grouping) {
        if (final.kind === "group") grouping.onDrop(final.groupKey, active);
        return;
      }
      const plan = planListDrop({
        hover: final,
        active,
        activeGroupKey: groupKeyFor(active, groupBy, nowOn(today)),
        groupBy,
        allByPosition: api.tasks,
        groupTasks: (key) => groups.find((g) => g.key === key)?.all ?? [],
      });
      if (plan) applyPlan(plan, active);
    },
    [
      dragId,
      hover,
      endListDrag,
      taskById,
      hoverAt,
      askManualOrder,
      grouping,
      groupBy,
      today,
      api.tasks,
      groups,
      applyPlan,
    ],
  );

  // A row as the List renders it: the row, plus the drag marks it carries
  // (the insertion line or the sorted note on its edge).
  const renderRow = (task: Task, depth: 0 | 1, extra?: Partial<Parameters<typeof TaskRow>[0]>) => {
    const line =
      hover && (hover.kind === "reorder" || hover.kind === "sorted") && hover.line.id === task.id
        ? hover.line
        : null;
    const row = (drag?: {
      dragListeners: DraggableSyntheticListeners;
      dragActivatorRef: DragActivatorRef;
    }) => (
      <div data-list-row={task.id} className="relative">
        <TaskRow
          {...buildRowProps(task)}
          nested={depth === 1}
          parentTitle={depth === 0 ? parentTitleFor(task) : null}
          dragListeners={drag?.dragListeners}
          dragActivatorRef={drag?.dragActivatorRef}
          dropTarget={
            (hover?.kind === "nest" && hover.targetId === task.id) || fileDrop.targetId === task.id
          }
          {...extra}
        />
        {line && hover?.kind === "reorder" ? (
          <InsertionLine edge={line.edge} indent={hover.depth * NEST_INDENT_PX} />
        ) : null}
        {line && hover?.kind === "sorted" && order !== "manual" ? (
          // Above the list's very first row the scroll box would clip it.
          <SortedNote
            edge={
              line.edge === "top" && groupBy === "none" && task.id === visibleTasks[0]?.id
                ? "bottom"
                : line.edge
            }
          >
            {sortedByLabel(order)}
          </SortedNote>
        ) : null}
      </div>
    );
    if (!canDrag) return <div key={task.id}>{row()}</div>;
    return (
      <DraggableTask
        key={task.id}
        id={task.id}
        from="list"
        render={({ dragListeners, dragActivatorRef }) => row({ dragListeners, dragActivatorRef })}
      />
    );
  };

  // A project grouped by section ends with "+ Add section".
  const addsSections =
    canEdit && chosenGroupBy === "section" && isProjectScope(selection) && !!onAddSection;

  // The List flattened (TV-D11b): a header per group, each top-level task
  // with its expanded subtasks, the group's end (its "N completed" line and
  // the gap after it), its folded "Backlog · n" line and, opened, its Backlog
  // rows. Collapsed groups keep their header.
  const items = useMemo(() => {
    const out: ListItem[] = [];
    const pushRows = (group: ListGroup, list: readonly Task[]) => {
      for (const task of list) {
        const children =
          nest && expandedParents.has(task.id) ? (api.subtasksByParent.get(task.id) ?? []) : [];
        out.push({
          kind: "row",
          key: `r:${group.key}:${task.id}`,
          task,
          depth: 0,
          groupKey: group.key,
          blockId: task.id,
          blockEnd: children.length === 0,
        });
        children.forEach((child, i) => {
          out.push({
            kind: "row",
            key: `r:${group.key}:${task.id}:${child.id}`,
            task: child,
            depth: 1,
            groupKey: group.key,
            blockId: task.id,
            blockEnd: i === children.length - 1,
          });
        });
      }
    };
    for (const group of groups) {
      if (grouped || group.extra)
        out.push({ kind: "header", key: `h:${group.key}`, groupKey: group.key });
      if (!collapsed.has(group.key)) {
        pushRows(group, group.tasks);
        out.push({ kind: "end", key: `e:${group.key}`, groupKey: group.key });
        if (group.backlog.length > 0) {
          out.push({ kind: "backlog", key: `b:${group.key}`, groupKey: group.key });
          if (openBacklogs.has(group.key)) pushRows(group, group.backlog);
        }
      }
    }
    if (addsSections) out.push({ kind: "add-section", key: "add-section" });
    return out;
  }, [
    groups,
    grouped,
    collapsed,
    nest,
    expandedParents,
    api.subtasksByParent,
    openBacklogs,
    addsSections,
  ]);

  const stickyIndexes = useMemo(
    () => items.flatMap((item, i) => (item.kind === "header" ? [i] : [])),
    [items],
  );
  const groupByKey = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups]);

  // The row being dragged stays drawn wherever the list scrolls (dnd-kit
  // loses a draggable that unmounts mid-drag); a moved selection is brought
  // into view (j/k past the edge, a deep link into a long list).
  const pinned = useMemo(() => {
    if (!dragId) return [];
    const index = items.findIndex((item) => item.kind === "row" && item.task.id === dragId);
    return index >= 0 ? [index] : [];
  }, [items, dragId]);
  const [selectionSeq, setSelectionSeq] = useState({ id: selectedId, seq: 0 });
  if (selectionSeq.id !== selectedId)
    setSelectionSeq({ id: selectedId, seq: selectionSeq.seq + 1 });
  const scrollTo = useMemo(() => {
    if (!selectedId) return null;
    const item = items.find((it) => it.kind === "row" && it.task.id === selectedId);
    return item ? { key: item.key, seq: selectionSeq.seq } : null;
  }, [items, selectedId, selectionSeq.seq]);

  // What each group header's "+" does (default n).
  const markContext = useMemo(
    () => ({
      bucketColor: (id: string) => buckets.find((b) => b.id === id)?.color ?? null,
      assignee: (id: string) => byId(id),
      team: (id: string) => teams.find((t) => t.id === id) ?? null,
    }),
    [buckets, byId, teams],
  );
  const sectionById = useMemo(
    () => new Map(projectSections.map((s) => [s.id, s])),
    [projectSections],
  );

  const renderItem = (item: ListItem) => {
    if (item.kind === "add-section") {
      return onAddSection ? <AddSectionLine onAdd={onAddSection} /> : null;
    }
    if (item.kind === "header") {
      const group = groupByKey.get(item.groupKey);
      if (!group) return null;
      const groupTarget = hover?.kind === "group" && hover.groupKey === group.key;
      if (group.extra) {
        // A group the view added (a team block, the snoozed): its own words.
        const extra = group.extra;
        return (
          <ListGroupHeader
            groupKey={group.key}
            label={extra.label}
            leading={extra.leading}
            count={extra.count === undefined ? group.all.length : (extra.count ?? undefined)}
            sub={extra.sub}
            onToggle={() => toggleGroup(group.key)}
            collapsed={collapsed.has(group.key)}
            addState={extra.add ?? NO_ADD}
            onAdd={onRequestCapture}
          />
        );
      }
      if (grouping) {
        // The view's own groups (Upcoming's days): its header line and "+".
        const whole = { key: group.key, label: group.label, tasks: group.all };
        const words = grouping.header(whole, nowOn(today));
        return (
          <ListGroupHeader
            groupKey={group.key}
            className={cn(groupTarget && DROP_TARGET)}
            label={group.label}
            count={words.count}
            sub={words.sub}
            onToggle={() => toggleGroup(group.key)}
            collapsed={collapsed.has(group.key)}
            addState={canEdit ? grouping.addState(group.key) : NO_ADD}
            onAdd={onRequestCapture}
            extraAction={canEdit ? grouping.headerAction?.(whole) : undefined}
          />
        );
      }
      const section = groupBy === "section" ? sectionById.get(group.key) : undefined;
      return (
        // The group's name as typed (a bucket, a status): sentence case,
        // never small caps (call 40). It's also the group's drop target
        // (TV-U4): it lights up when a drop would land in the group.
        <ListGroupHeader
          groupKey={group.key}
          className={cn(groupTarget && DROP_TARGET)}
          label={group.label}
          leading={groupMark(groupBy, group.key, markContext)}
          count={countEvery ? group.all.length : groupCount(groupBy, group)}
          sub={
            section?.endsOn
              ? `· ends ${formatDate(`${section.endsOn}T12:00:00`)}`
              : groupSub?.(group.key)
          }
          onToggle={() => toggleGroup(group.key)}
          collapsed={collapsed.has(group.key)}
          addState={groupAddState({
            scope: selection,
            groupBy,
            key: group.key,
            canEdit,
            today,
            inboxId,
          })}
          onAdd={onRequestCapture}
          section={
            section && canEdit && onRenameSection && onDeleteSection
              ? {
                  onRename: (name) => onRenameSection(section.id, name),
                  onDelete: () => onDeleteSection(section.id),
                }
              : null
          }
        />
      );
    }
    if (item.kind === "end") {
      const group = groupByKey.get(item.groupKey);
      if (!group) return null;
      if (group.extra) {
        // An extra group's rows past its limit: "Show 3 more" (research §8).
        const more = group.more?.length ?? 0;
        const open = revealedGroups.has(group.key);
        return (
          <div className="pb-1">
            {more > 0 ? (
              <ShowMoreLine
                count={more}
                shown={open}
                onToggle={() => toggleRevealGroup(group.key)}
              />
            ) : null}
          </div>
        );
      }
      return (
        <div className="pb-1">
          <CompletedLine
            count={group.hidden.length}
            shown={revealedGroups.has(group.key)}
            onToggle={() => toggleRevealGroup(group.key)}
          />
        </div>
      );
    }
    if (item.kind === "backlog") {
      const group = groupByKey.get(item.groupKey);
      if (!group) return null;
      return (
        <BacklogLine
          count={group.backlog.length}
          shown={openBacklogs.has(group.key)}
          onToggle={() => toggleBacklog(group.key)}
        />
      );
    }
    const { task, depth } = item;
    const children = depth === 0 && nest ? (api.subtasksByParent.get(task.id) ?? []) : [];
    const row = renderRow(
      task,
      depth,
      depth === 0
        ? {
            expandSlot,
            expandable: children.length > 0,
            expanded: expandedParents.has(task.id),
            onToggleExpand: toggleExpandParent,
          }
        : undefined,
    );
    const nestHere =
      item.blockEnd && hover?.kind === "nest" && hover.targetId === item.blockId && dragTask;
    const preview = nestHere ? (
      <NestPreview indent={NEST_INDENT_PX}>{dragTask.title || "Untitled"}</NestPreview>
    ) : null;
    // A top-level row starts its block (`data-list-block`: off a row but
    // inside a block, a drag keeps its hover); the "Make subtask" preview
    // under a block's last subtask is part of that block too.
    if (depth === 0) {
      return (
        <div data-list-block>
          {row}
          {preview}
        </div>
      );
    }
    if (!preview) return row;
    return (
      <>
        {row}
        <div data-list-block>{preview}</div>
      </>
    );
  };

  // The Queue is a single flat, ordered group — reorder is a vertical sort over
  // it. Disabled (falls through to the grouped render) unless the parent asked
  // for it and the user can edit.
  const queueTasks = groups[0]?.tasks ?? [];
  const queueIds = useMemo(() => queueTasks.map((t) => t.id), [queueTasks]);
  const canReorder = reorderable && canEdit && groupBy === "none" && queueTasks.length > 1;
  const [queueDragId, setQueueDragId] = useState<string | null>(null);
  const queueDragTask = queueDragId ? (taskById.get(queueDragId) ?? null) : null;

  const onQueueDragEnd = useCallback(
    (e: DragEndEvent) => {
      setReordering(false);
      setQueueDragId(null);
      const { active, over } = e;
      if (!over || active.id === over.id) return;
      const from = queueIds.indexOf(String(active.id));
      const to = queueIds.indexOf(String(over.id));
      if (from < 0 || to < 0) return;
      reorderQueueWithUndo(queueIds, arrayMove(queueIds, from, to), "Moved");
    },
    [queueIds, reorderQueueWithUndo],
  );

  // Screen readers hear titles, never ids (standalone mounts; on the tasks
  // page the page's one context speaks for every surface).
  const announcements = useMemo(() => {
    const name = (id: string) => {
      const task = taskById.get(id);
      return task ? `“${task.title || "Untitled"}”` : null;
    };
    return taskDragAnnouncements({ taskName: (id) => name(id) ?? "the task", targetName: name });
  }, [taskById]);

  const overlayTask = dragTask ?? queueDragTask;
  const dragOverlay =
    typeof document !== "undefined"
      ? createPortal(
          // A List drag's preview sits beside the pointer, never over the row
          // it points at; the Queue's stays where it was grabbed (its
          // closestCenter measures the dragged rect).
          <DragOverlay modifiers={dragTask ? [overlayBesideCursor] : undefined}>
            {overlayTask ? (
              <DragOverlaySurface className={dragTask ? "w-64" : undefined}>
                <span className="min-w-0 flex-1 truncate">{overlayTask.title || "Untitled"}</span>
                {dragTask && multiIds.size >= 2 && multiIds.has(dragTask.id) ? (
                  <span className="shrink-0 font-sans text-xs text-muted-foreground">
                    +{multiIds.size - 1}
                  </span>
                ) : null}
              </DragOverlaySurface>
            ) : null}
          </DragOverlay>,
          document.body,
        )
      : null;

  // The statuses a row's ⇧S menu offers, read only by an open menu.
  const statusesFor = useCallback(
    (bucketId: string) => api.statusesForBucket?.(bucketId) ?? [],
    [api.statusesForBucket],
  );
  const showHeader = detailed && api.loaded && tasks.length > 0 && selection !== "today";

  return (
    // The projects and statuses a row's menus offer, read only by an open
    // menu (TV-D11b).
    <ProjectChoicesProvider projects={buckets} inboxId={inbox?.id ?? null}>
      <StatusChoicesProvider statusesFor={statusesFor} any={(api.statuses?.length ?? 0) > 0}>
        <div className="flex h-full min-h-0 flex-col">
          <PlanViewHeader
            title={scopeTitle}
            view={view}
            onViewChange={onViewChange}
            canEdit={canEdit}
            onRequestCapture={onRequestCapture}
            controls={header}
          />
          {note ? (
            <p className="shrink-0 px-2.5 pb-1.5 font-sans text-xs text-muted-foreground">{note}</p>
          ) : null}

          {/* The rows and Detailed's headers share the columns' widths. */}
          <div ref={frameRef} style={frameStyle} className="flex min-h-0 flex-1 flex-col">
            {showHeader ? (
              // It doesn't scroll, but keeps the same scrollbar gutter as the
              // list below (a stable gutter), so a column's label stays over
              // its column where scrollbars take room.
              <div className="shrink-0 overflow-hidden [scrollbar-gutter:stable]">
                <TaskListHeader
                  columns={fitted}
                  expandSlot={expandSlot}
                  order={order}
                  orderDir={orderDir}
                  onSort={onSort ?? null}
                />
              </div>
            ) : null}

            {/* list */}
            <div
              ref={containerRef}
              tabIndex={0}
              onKeyDown={onKeyDown}
              // Once the mount's quiet focus leaves, a later focus rings as usual.
              onBlur={(e) => {
                if (e.target === e.currentTarget) delete e.currentTarget.dataset.quietFocus;
              }}
              {...fileDrop.handlers}
              // Chromium focuses a clicked button; after a mouse click on a row's
              // button, hand focus back to the list (as desktop WebKit does), so the
              // next Space/Enter acts on the selected row instead of re-clicking it.
              // Keyboard activation (detail 0), text fields and portaled popovers keep focus,
              // and so does a menu or picker a button just opened (a group's ⋯): focus
              // leaving it would close it again at once.
              onClickCapture={(e) => {
                if (e.detail === 0 || !e.currentTarget.contains(e.target as Node)) return;
                const button = e.target instanceof Element ? e.target.closest("button") : null;
                if (!button || button.hasAttribute("aria-haspopup")) return;
                e.currentTarget.focus({ preventScroll: true });
              }}
              role="grid"
              aria-label={`${scopeTitle} tasks`}
              className="pane-scroll min-h-0 flex-1 overflow-auto rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring data-[quiet-focus]:focus-visible:ring-0"
            >
              {!api.loaded ? (
                <TaskListSkeleton />
              ) : tasks.length === 0 ? (
                filterActive ? (
                  <TasksNoMatch
                    onClearFilters={onClearFilters}
                    hidden={filteredOut?.hidden}
                    filters={filteredOut?.filters}
                  />
                ) : (
                  (emptyState ?? (
                    <TasksEmptyScope
                      scopeTitle={scopeTitle}
                      canEdit={canEdit}
                      onRequestCapture={() => onRequestCapture()}
                      afterEmpty={
                        addsSections && onAddSection ? (
                          <AddSectionLine onAdd={onAddSection} />
                        ) : null
                      }
                    />
                  ))
                )
              ) : canReorder ? (
                // Queue reorder. In external mode (DF-22) the tasks page owns the one
                // DndContext (so a row can be dropped on the hub or the rail); we bind
                // our reorder handlers through a monitor. The handlers stay spatially
                // disjoint — onQueueDragEnd early-returns when `over` isn't a queue row.
                <DndBoundary
                  dndMode={dndMode}
                  sensors={dndSensors}
                  collisionDetection={closestCenter}
                  onDragStart={(e) => {
                    setReordering(true);
                    setQueueDragId(String(e.active.id));
                  }}
                  onDragEnd={onQueueDragEnd}
                  onDragCancel={() => {
                    setReordering(false);
                    setQueueDragId(null);
                  }}
                  announcements={announcements}
                >
                  <SortableContext items={queueIds} strategy={verticalListSortingStrategy}>
                    {queueTasks.map((task) => (
                      <SortableTask
                        key={task.id}
                        id={task.id}
                        from="queue"
                        render={({ dragListeners, dragActivatorRef }) => (
                          <TaskRow
                            {...buildRowProps(task)}
                            parentTitle={parentTitleFor(task)}
                            dragListeners={dragListeners}
                            dragActivatorRef={dragActivatorRef}
                            dropTarget={fileDrop.targetId === task.id}
                          />
                        )}
                      />
                    ))}
                  </SortableContext>
                  {dragOverlay}
                </DndBoundary>
              ) : (
                <MaybeDnd
                  enabled={canDrag}
                  dndMode={dndMode}
                  sensors={dragSensors}
                  onDragStart={onListDragStart}
                  onDragEnd={onListDragEnd}
                  onDragCancel={endListDrag}
                  announcements={announcements}
                >
                  {/* A little room above the first row, so an insertion line
                      on its top edge isn't clipped by the scroll box (TV-U4). */}
                  <div className="pt-1">
                    <VirtualStack
                      items={items}
                      itemKey={(item) => item.key}
                      estimateSize={(item) => ITEM_HEIGHT[item.kind]}
                      scrollRef={containerRef}
                      render={(item) => renderItem(item)}
                      stickyIndexes={stickyIndexes}
                      // The pane's own surface, above the rows that pass under it.
                      stickyClassName="z-(--z-sticky) bg-card"
                      pinned={pinned}
                      scrollTo={scrollTo}
                    />
                  </div>
                  {canDrag ? dragOverlay : null}
                </MaybeDnd>
              )}
            </div>
          </div>
        </div>
      </StatusChoicesProvider>
    </ProjectChoicesProvider>
  );
}

/**
 * A group header's count: a section's "2 of 5" (done of all, research §2), a
 * status group's size, else its open tasks (what's left to do).
 */
function groupCount(groupBy: GroupBy, group: ListGroup): ReactNode {
  if (groupBy === "section" && group.key !== "none") {
    const done = group.all.filter((t) => isClosedTask(t)).length;
    return `${done} of ${group.all.length}`;
  }
  if (groupBy === "status") return group.all.length;
  return group.all.filter((t) => isOpenTask(t)).length;
}

function toggled<T>(set: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

/** Two hovers that draw the same thing (so a pointer move doesn't re-render). */
function sameHover(a: ListDropHover | null, b: ListDropHover | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The drag boundary when this list can drag; just the children when it can't. */
function MaybeDnd({
  enabled,
  dndMode,
  sensors,
  onDragStart,
  onDragEnd,
  onDragCancel,
  announcements,
  children,
}: {
  enabled: boolean;
  dndMode: "internal" | "external";
  sensors: ReturnType<typeof useTaskDndSensors>;
  onDragStart: (e: DragStartEvent) => void;
  onDragEnd: (e: DragEndEvent) => void;
  onDragCancel: () => void;
  announcements: Announcements;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;
  return (
    <DndBoundary
      dndMode={dndMode}
      sensors={sensors}
      // The List has no droppables of its own (it resolves from the pointer);
      // on its own context this only ever finds nothing.
      collisionDetection={pointerWithin}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={onDragCancel}
      announcements={announcements}
    >
      {children}
    </DndBoundary>
  );
}
