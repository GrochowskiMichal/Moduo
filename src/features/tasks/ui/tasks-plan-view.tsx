import { isOpenTaskStatus } from "@contracts/vocabularies";
import {
  type CollisionDetection,
  closestCenter,
  closestCorners,
  DndContext,
  type DragEndEvent,
  pointerWithin,
} from "@dnd-kit/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { onCreateNew } from "../../../components/app/create-events";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { RightPanel } from "../../../components/app/right-panel";
import { truncationNotice } from "../../../components/app/truncation-notice";
import { Button } from "../../../components/ui/button";
import { restoreNavFocus } from "../../../components/ui/nav-row";
import {
  asDragPayload,
  asDropLinkTarget,
  isSelfDrop,
  targetAccepts,
} from "../../../lib/drag-payload";
import type { EntityRef } from "../../../lib/entity-links";
import { ENTITY_OPEN_EVENT, takeEntityOpenIntent } from "../../../lib/entity-open";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { undoToast } from "../../../lib/undo-toast";
import { HubDropZone } from "../../contacts/ui/hub-drop-zone";
import { consumeFocusViewRequest, FOCUS_VIEW_REQUEST_EVENT } from "../../focus/view-request";
import { createLinkWithToast } from "../../spine/ui/drop-link-toast";
import { useAssignees } from "../assignees";
import {
  timeBlockByBucket as invertTimeBlocks,
  myTasksScope,
  openCount,
  resolveDefaultSelection,
  showsMyTasks,
} from "../default-view";
import type { TaskLayout } from "../display";
import {
  asRailDropTarget,
  isSideDroppable,
  projectMoveWrite,
  RAIL_DROP_PREFIX,
  type RailDropTarget,
  railCollision,
  railDropAction,
} from "../dnd/rail-drop";
import { type CaptureSeed, showsArchived, statusesLetThrough } from "../filters";
import { groupsByBucket, STATUS_LABELS } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { isDrifted, PRIVATE_PROJECT_LABEL, type Task, type TaskStatus } from "../model";
import { showsSortedNote, sortedByLabel } from "../order";
import { resolveTasksDeepLink } from "../search";
import { sanitizeTimelineZoom, type TimelineZoom } from "../timeline-geometry";
import { BucketRail, parseCollapsedSections, type TasksMode } from "./bucket-rail";
import { CaptureModal } from "./capture-modal";
import { asTaskDrag, taskDragAnnouncements, useTaskDndSensors } from "./dnd/task-dnd";
import { DriftTriageDialog } from "./drift-triage-dialog";
import { ExecuteView } from "./execute-view";
import { FrontierOfferDialog } from "./frontier-offer-dialog";
import { type PlanHeaderControls, type PlanView, SortedOrderLine } from "./plan-view-header";
import { TaskBoardView } from "./task-board-view";
import { PrivateItemPanel, TASK_DETAIL_REFRESH_EVENT, TaskDetailPanel } from "./task-detail-panel";
import { TaskListView } from "./task-list-view";
import { TaskTimelineView } from "./task-timeline-view";
import { useTasksDisplay } from "./use-tasks-display";
import { useTasksFilters } from "./use-tasks-filters";

type Props = {
  api: TasksModuleApi;
  workspaceId: string;
  /** Spine runtime — powers the task detail panel's linked-entity hub (DF-8). */
  runtime: ModuoRuntime | null;
  /** URL-held task selection (?id=, DF-1) — the page owns the router coupling. */
  urlTaskId: string | null;
  onUrlTaskIdChange: (id: string | null) => void;
};

// The selection→URL mirror writes only at rest (see the mirror effect).
const URL_MIRROR_DEBOUNCE_MS = 250;

// Per-workspace UI state (selection / mode / zoom) persisted locally — these
// are view preferences, not synced data. Layout, grouping and filters are
// per scope, in Display (use-tasks-display.tsx).
function lsKey(workspaceId: string, part: string): string {
  return `moduo:tasks:${part}:${workspaceId}`;
}
function readLS(workspaceId: string, part: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(lsKey(workspaceId, part));
  } catch {
    return null;
  }
}
function writeLS(workspaceId: string, part: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(lsKey(workspaceId, part), value);
  } catch {
    /* ignore */
  }
}

export function TasksPlanView({ api, workspaceId, runtime, urlTaskId, onUrlTaskIdChange }: Props) {
  const { canEdit, buckets, inbox, tasks } = api;

  const [mode, setMode] = useState<TasksMode>(() =>
    readLS(workspaceId, "mode") === "execute" ? "execute" : "plan",
  );
  // The workspace-wide view from before layouts were per scope: a scope
  // that doesn't remember a layout yet starts with it.
  const [legacyLayout] = useState<TaskLayout>(() => {
    const stored = readLS(workspaceId, "view");
    return stored === "board" || stored === "timeline" ? stored : "list";
  });
  // Provisional selection (last-opened bucket, never "all"); the time-block-aware
  // default is resolved once the bucket bundle has loaded (see effect below).
  const [selection, setSelection] = useState<string>(
    () => readLS(workspaceId, "lastBucket") ?? "inbox",
  );
  const [timelineZoom, setTimelineZoom] = useState<TimelineZoom>(() =>
    sanitizeTimelineZoom(readLS(workspaceId, "timelineZoom")),
  );
  // Which right-panel view is showing (views: features/tasks/panel-views.ts).
  const [panelView, setPanelView] = useState("details");
  // Rail sections the user collapsed stay collapsed (tasks-v2 §11).
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<string>>(() =>
    parseCollapsedSections(readLS(workspaceId, "collapsedSections")),
  );
  const toggleSection = useCallback((name: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [triageBucketId, setTriageBucketId] = useState<string | null>(null);
  // Triage opens from a rail row and has no trigger to hand focus back to.
  const railNavRef = useRef<HTMLElement | null>(null);
  const triageFromRef = useRef<string | null>(null);
  // Queuing a blocked task offers its unblocked frontier first (spec §5c).
  const [frontierOfferTaskId, setFrontierOfferTaskId] = useState<string | null>(null);
  // Task-level selection (distinct from `selection`, which is the bucket scope).
  // Lifted here so the right-rail detail panel can bind to it across List/Board.
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  // DF-1 — URL sync bookkeeping. Selection is STATE mirrored into the URL —
  // not URL-derived like notes NO-3 — because this selection is a j/k
  // key-repeat cursor: it must not ride the router on every press, and WebKit
  // hard-throttles history.replaceState (~100/30s), so the mirror below is
  // debounced. Two refs discriminate who an id in the URL came from:
  // `processedUrlIdRef` marks ids this component already honored,
  // `selfWroteUrlIdRef` marks ids the mirror wrote itself. A `urlTaskId`
  // matching neither is an INBOUND deep link (widget row, contact rollup, note
  // chip, notification, refresh, back/forward). Two refs, not one: the
  // mirror's write commits to the router async, so a single marker would get
  // clobbered while the URL still holds the previous id — and background
  // bundle churn in that window would re-apply the OLD id as a fake deep
  // link. While an inbound id awaits its post-load apply, the selection
  // backstops must not steal it and the mirror must not overwrite it — all
  // gate on `inboundPending` (computed at render, so every effect in the
  // arrival flush sees the same verdict).
  const processedUrlIdRef = useRef<string | null>(null);
  const selfWroteUrlIdRef = useRef<string | null>(null);
  const scrollTargetRef = useRef<string | null>(null);
  const inboundPending =
    urlTaskId !== null &&
    processedUrlIdRef.current !== urlTaskId &&
    selfWroteUrlIdRef.current !== urlTaskId;
  // One-shot reveal request for the List view: expand a collapsed group ONCE
  // for a deep-link target — ordinary selection fallbacks never touch
  // collapse state (a group the user closes stays closed).
  const [revealRequest, setRevealRequest] = useState<{ id: string; seq: number } | null>(null);
  // An opened link to a task you can't see: the panel says "Private item"
  // until you move to another task (TV-P0, AC1.10). The scope's first pick on
  // arrival (from no selection) doesn't count as moving.
  const [privateLinkId, setPrivateLinkId] = useState<string | null>(null);
  const prevSelectedRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevSelectedRef.current;
    prevSelectedRef.current = selectedTaskId;
    if (prev !== null && prev !== selectedTaskId) setPrivateLinkId(null);
  }, [selectedTaskId]);

  // Focus time is saved by the app shell's sink (TV-P0, use-focus-time-saver.ts),
  // from any page; the module shows each saved total (FOCUS_TIME_SAVED_EVENT).

  // The chrome chip's "open Focus" request → enter Execute mode. The one-shot
  // flag covers the fresh-mount case (chip clicked from another route, event
  // fired before this listener existed); the event covers the already-mounted
  // case (chip clicked while /tasks is open in Plan mode).
  useEffect(() => {
    if (consumeFocusViewRequest()) setMode("execute");
    // Consume the flag here too: the event fires synchronously inside
    // requestFocusView (before navigation), so an already-mounted /tasks clears
    // it now — otherwise a stale flag would force Execute on the next unrelated
    // /tasks visit that reaches the mount branch above.
    const onRequest = () => {
      consumeFocusViewRequest();
      setMode("execute");
    };
    window.addEventListener(FOCUS_VIEW_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(FOCUS_VIEW_REQUEST_EVENT, onRequest);
  }, []);

  // Persist preferences.
  useEffect(() => writeLS(workspaceId, "mode", mode), [workspaceId, mode]);
  useEffect(() => writeLS(workspaceId, "timelineZoom", timelineZoom), [workspaceId, timelineZoom]);
  useEffect(
    () => writeLS(workspaceId, "collapsedSections", JSON.stringify([...collapsedSections])),
    [workspaceId, collapsedSections],
  );

  // Remember the last concrete bucket scope (never "all" / "mine" / "today") so
  // the next open can land back on it (spec §9.2).
  useEffect(() => {
    if (selection === "all" || selection === "mine" || selection === "today") return;
    writeLS(workspaceId, "lastBucket", selection);
  }, [workspaceId, selection]);

  // Time-blocks are workspace data, loaded with the bundle (api.timeBlocks).
  const timeBlocks = api.timeBlocks;

  const inboxId = inbox?.id ?? null;

  // Default-view resolution (spec §9), run once per workspace after the bundle
  // loads: time-block bucket → last-opened bucket → Inbox. Never the full list.
  const resolvedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (api.loading) return;
    if (resolvedForRef.current === workspaceId) return;
    // DF-1: an inbound deep link owns the entry scope — skip the time-block/
    // last-bucket default rather than race the apply effect below for it
    // (both would queue setSelection in the same flush; the default must not
    // win over the deep link's bucket).
    if (inboundPending) {
      resolvedForRef.current = workspaceId;
      return;
    }
    resolvedForRef.current = workspaceId;
    const bucketIds = [inboxId, ...buckets.map((b) => b.id)].filter(Boolean) as string[];
    setSelection(
      resolveDefaultSelection({
        timeBlocks,
        lastBucket: readLS(workspaceId, "lastBucket"),
        bucketIds,
        inboxId,
      }),
    );
  }, [api.loading, workspaceId, inboxId, buckets, timeBlocks, inboundPending]);

  // "My tasks" is only in the rail of workspaces with two or more members
  // (tasks-v2 §1): with fewer, every task is yours, so All says the same.
  const { assignees, currentUserId } = useAssignees();
  const showMyTasks = showsMyTasks(assignees.length);

  // Keep selection valid; "inbox" resolves against the seeded Inbox bucket.
  useEffect(() => {
    if (selection === "all" || selection === "inbox" || selection === "today") return;
    if (selection === "mine") {
      // Members load with the workspace; wait for them before ruling.
      if (!showMyTasks && assignees.length > 0) setSelection("inbox");
      return;
    }
    if (inboxId && selection === inboxId) return;
    if (!buckets.some((b) => b.id === selection)) setSelection("inbox");
  }, [selection, buckets, inboxId, showMyTasks, assignees.length]);

  const isAll = groupsByBucket(selection);

  // A task can sit in a project you can't see (it was assigned to you): that
  // project reads "Private project", never "Inbox" (TV-P0, AC1.10).
  const bucketNameById = useCallback(
    (id: string) => {
      if (inbox && id === inbox.id) return "Inbox";
      return buckets.find((b) => b.id === id)?.name ?? PRIVATE_PROJECT_LABEL;
    },
    [buckets, inbox],
  );

  // Won't do (archived) tasks leave every scope, except the one you're looking
  // at: it stays listed, and in the panel with Reopen, until you change scope
  // (TV-P0, AC1.4 — the TV-U1 rule for a task you check off). While the
  // selected task is open the pin follows the scope; once it's Won't do the
  // pin freezes there. Read at render so the backstops below see it at once.
  const selectedTaskForScope = selectedTaskId
    ? (tasks.find((t) => t.id === selectedTaskId) ?? null)
    : null;
  const archivedPinRef = useRef<{ id: string; scope: string } | null>(null);
  if (
    selectedTaskForScope &&
    (archivedPinRef.current?.id !== selectedTaskForScope.id ||
      selectedTaskForScope.status !== "archived")
  ) {
    archivedPinRef.current = { id: selectedTaskForScope.id, scope: selection };
  }
  const keptArchivedId =
    selectedTaskForScope?.status === "archived" &&
    archivedPinRef.current?.id === selectedTaskForScope.id &&
    archivedPinRef.current.scope === selection
      ? selectedTaskForScope.id
      : null;

  // Display and filters (tasks-v2 §7), remembered per workspace and scope on
  // this device; a task checked off or deep-linked here stays listed until
  // the scope changes (TV-U1). A deep link's target (and its parent) stays
  // listed in this scope even when Display hides completed tasks, while it's
  // the one selected.
  const linkedTaskId =
    revealRequest && revealRequest.id === selectedTaskId ? revealRequest.id : null;
  const tasksDisplay = useTasksDisplay(workspaceId, selection, tasks, linkedTaskId, legacyLayout);
  const isHiddenByDisplay = tasksDisplay.isHidden;
  const view: PlanView = tasksDisplay.display.layout;
  const setView = useCallback(
    (layout: PlanView) => tasksDisplay.setDisplay({ ...tasksDisplay.display, layout }),
    [tasksDisplay.setDisplay, tasksDisplay.display],
  );
  // Won't do tasks join a scope when Filter → Status asks for them (TV-U2,
  // AC1.4), besides the one kept above.
  const withArchived = showsArchived(tasksDisplay.filters);
  const statusFilter = useMemo(
    () => statusesLetThrough(tasksDisplay.filters),
    [tasksDisplay.filters],
  );

  const scopeTasksAll = useMemo(() => {
    if (selection === "today") return api.queuedTasks;
    const live = (t: Task) => t.status !== "archived" || withArchived || t.id === keptArchivedId;
    if (selection === "all") return tasks.filter(live);
    if (selection === "mine") {
      if (!withArchived && !keptArchivedId) return myTasksScope(tasks, currentUserId);
      if (!currentUserId) return myTasksScope(tasks, currentUserId);
      // My tasks' rule (assigned to me, not Won't do), plus the Won't do ones
      // a Status filter asks for, plus the kept one.
      return tasks.filter((t) => t.assigneeId === currentUserId && live(t));
    }
    const bucketId = selection === "inbox" ? inboxId : selection;
    if (!bucketId) return [];
    return tasks.filter((t) => t.bucketId === bucketId && live(t));
  }, [selection, tasks, inboxId, api.queuedTasks, currentUserId, keptArchivedId, withArchived]);

  // Filters and search narrow the center list/board/timeline (rail counts
  // stay whole).
  const filtering = useTasksFilters({
    workspaceId,
    scope: selection,
    scopeTasks: scopeTasksAll,
    conditions: tasksDisplay.filters,
    onConditionsChange: tasksDisplay.setFilters,
    api,
    runtime,
    assignees,
    enabled: mode === "plan",
    // A deep-linked task, or the selected one just marked Won't do, stays
    // listed past this scope's filters and search while it's selected; a link
    // never clears saved filters (TV-U2).
    keepTaskId: linkedTaskId ?? keptArchivedId,
  });
  const scopeTasks = filtering.tasks;
  // What New pre-fills: the filters you can see (none in Focus), and never
  // someone who can't take the task (a former member a stored filter still
  // names: the server would refuse the save).
  const captureSeed = useMemo<CaptureSeed>(() => {
    if (mode === "execute") return { tagIds: [] };
    const seed = filtering.seed;
    const id = seed.assigneeId;
    if (id && !assignees.some((a) => a.userId === id && a.canTakeTasks)) {
      const { assigneeId: _dropped, ...rest } = seed;
      return rest;
    }
    return seed;
  }, [mode, filtering.seed, assignees]);

  const scopeTitle =
    selection === "all"
      ? "All"
      : selection === "mine"
        ? "My tasks"
        : selection === "today"
          ? "Queue"
          : selection === "inbox"
            ? "Inbox"
            : bucketNameById(selection);

  // The Queue is one ordered line-up, so its List view is never grouped.
  const effectiveGroupBy = selection === "today" ? "none" : tasksDisplay.display.group;

  // Where a captured task lands: the selected bucket, else Inbox.
  const captureBucketId =
    isAll || selection === "today" ? inboxId : selection === "inbox" ? inboxId : selection;
  // New in Focus or the Queue lands in Up next (TV-P0, AC1.9): created and
  // queued at the end of my line-up. The top of Up next is TV-U14's (call 90).
  const captureQueues = mode === "execute" || selection === "today";
  const createCaptured = captureQueues ? api.createQueuedTask : api.createTask;

  const totalOpenCount = useMemo(
    () => tasks.filter((t) => isOpenTaskStatus(t.status)).length,
    [tasks],
  );
  const myOpenCount = useMemo(
    () => (showMyTasks ? openCount(myTasksScope(tasks, currentUserId)) : 0),
    [showMyTasks, tasks, currentUserId],
  );

  const timeBlocksByBucket = useMemo(() => invertTimeBlocks(timeBlocks), [timeBlocks]);

  // Drifted tasks for the bucket currently being triaged (recomputed live so the
  // dialog empties as the user triages).
  const driftTasks = useMemo(() => {
    if (!triageBucketId) return [];
    const now = new Date();
    return tasks.filter((t) => t.bucketId === triageBucketId && isDrifted(t, now));
  }, [triageBucketId, tasks]);

  const openCapture = useCallback(() => {
    if (canEdit) setCaptureOpen(true);
  }, [canEdit]);

  // cmd+n / global "+" → capture (this listener is only mounted on /tasks).
  useEffect(() => onCreateNew(openCapture), [openCapture]);

  const exitExecute = useCallback(() => setMode("plan"), []);

  // ── blocked-by: frontier offer on queuing (spec §5c) ────────────────────────
  // One interception point for every queue affordance (row/card toggles and
  // context menus, detail panel, list keyboard): queuing a *blocked* task opens
  // the quiet frontier dialog instead — with "Queue anyway" as the escape hatch
  // (never a wall). Removing from the queue always goes straight through.
  const guardedToggleQueue = useCallback(
    (id: string) => {
      if (
        !api.queuedTaskIds.has(id) &&
        api.blockedTaskIds.has(id) &&
        api.frontierFor(id).length > 0
      ) {
        setFrontierOfferTaskId(id);
        return;
      }
      api.toggleQueue(id);
    },
    [api],
  );
  // The views see the guarded toggle through an otherwise-unchanged api facade.
  const viewApi = useMemo<TasksModuleApi>(
    () => ({ ...api, toggleQueue: guardedToggleQueue }),
    [api, guardedToggleQueue],
  );

  const frontierOfferTask = useMemo(
    () => (frontierOfferTaskId ? (tasks.find((t) => t.id === frontierOfferTaskId) ?? null) : null),
    [frontierOfferTaskId, tasks],
  );
  const frontierOffer = useMemo(
    () => (frontierOfferTaskId ? api.frontierFor(frontierOfferTaskId) : []),
    [frontierOfferTaskId, api],
  );

  // Quiet "waiting on …" note for blocked tasks in Execute (mirror, not a wall —
  // a committed-anyway task stays fully actionable).
  const blockedNoteFor = useCallback(
    (task: Task) => {
      if (!api.blockedTaskIds.has(task.id)) return null;
      const open = (api.blockersByTask.get(task.id) ?? []).filter((b) =>
        isOpenTaskStatus(b.status),
      );
      if (open.length === 0) return null;
      return open.length === 1
        ? `Waiting on “${open[0].title || "Untitled"}”`
        : `Waiting on ${open.length} tasks`;
    },
    [api],
  );

  // Quiet "↳ parent" context for committed subtasks in the Execute queue.
  const parentTitleFor = useCallback(
    (task: { parentId: string | null }) => {
      if (!task.parentId) return null;
      const parent = tasks.find((t) => t.id === task.parentId);
      return parent ? parent.title || "Untitled" : null;
    },
    [tasks],
  );

  // ── TV-U4: rail drop targets ──────────────────────────────────────────────
  // A task dropped on a project row moves there (subtasks follow, to the
  // project's end), on Queue joins my queue (through the blocked-by frontier
  // offer, like every queue affordance), on My tasks is assigned to me; on the
  // Inbox row nothing happens (a shared task never turns private by a drop).
  // A row tints only when the drop would change something (railDropAction),
  // and every drop that saved offers Undo.
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const railCtx = useMemo(
    () => ({ queuedTaskIds: api.queuedTaskIds, currentUserId, inboxId: inbox?.id ?? null }),
    [api.queuedTaskIds, currentUserId, inbox],
  );
  const railAccepts = useCallback(
    (target: RailDropTarget, taskId: string) => {
      const task = taskById.get(taskId);
      return !!task && canEdit && railDropAction(target, task, railCtx) !== null;
    },
    [taskById, canEdit, railCtx],
  );
  const onRailDragEnd = useCallback(
    (event: DragEndEvent) => {
      const target = asRailDropTarget(event.over?.data.current);
      const drag = asTaskDrag(event.active.data.current);
      if (!target || !drag || !canEdit) return;
      const task = taskById.get(drag.taskId);
      if (!task) return;
      const action = railDropAction(target, task, railCtx);
      if (!action) return;
      switch (action.kind) {
        case "move": {
          const parent = task.parentId ? (taskById.get(task.parentId) ?? null) : null;
          void api.dropTask(
            projectMoveWrite(task, action.bucketId, parent),
            `Moved to ${bucketNameById(action.bucketId)}`,
          );
          return;
        }
        case "queue": {
          // A blocked task opens the frontier offer (its own explicit choice).
          const blocked =
            api.blockedTaskIds.has(action.taskId) && api.frontierFor(action.taskId).length > 0;
          if (blocked) {
            guardedToggleQueue(action.taskId);
            return;
          }
          api.addToQueue(action.taskId, "end", () =>
            undoToast("Added to your queue", {
              onUndo: () => api.removeFromQueue(action.taskId),
            }),
          );
          return;
        }
        case "assign-me":
          void api.dropTask(
            { taskId: action.taskId, assigneeId: action.userId },
            "Assigned to you",
          );
          return;
      }
    },
    [canEdit, taskById, railCtx, api, bucketNameById, guardedToggleQueue],
  );

  const left = (
    <BucketRail
      mode={mode}
      onModeChange={setMode}
      selection={selection}
      onSelect={setSelection}
      buckets={buckets}
      inbox={inbox}
      openCountByBucket={api.openTaskCountByBucket}
      taskCountByBucket={api.taskCountByBucket}
      driftCountByBucket={api.driftCountByBucket}
      totalOpenCount={totalOpenCount}
      queueCount={api.queueCount}
      myTasksCount={showMyTasks ? myOpenCount : null}
      canEdit={canEdit}
      onCreateBucket={api.createBucket}
      onRenameBucket={api.renameBucket}
      onDeleteBucket={api.deleteBucket}
      onTriageBucket={(id) => {
        triageFromRef.current = id;
        setTriageBucketId(id);
      }}
      timeBlockByBucket={timeBlocksByBucket}
      onSetTimeBlock={api.setTimeBlock}
      onSetBucketGroup={api.setBucketGroup}
      collapsedSections={collapsedSections}
      onToggleSection={toggleSection}
      navRef={railNavRef}
      dropAccepts={railAccepts}
    />
  );

  // Resolve the selected task live from the bundle so the rail follows edits and
  // empties when the task is deleted.
  const selectedTask = useMemo(
    () => (selectedTaskId ? (tasks.find((t) => t.id === selectedTaskId) ?? null) : null),
    [selectedTaskId, tasks],
  );

  // Scope-level selection validity (the state lives here, so its backstop does
  // too): when the selected task leaves the scope (archived, moved, deleted,
  // scope/workspace switch), fall back to the first task in scope. The List view
  // refines this against its collapse-aware visible rows; Board has no own logic
  // and relies on this entirely. A subtask whose *parent* is in scope also
  // counts as in-scope — it can be selected from under the parent (expanded
  // list rows, the detail panel's subtask list) even from another bucket.
  useEffect(() => {
    if (api.loading || inboundPending) return;
    if (selectedTaskId && scopeTasks.some((t) => t.id === selectedTaskId)) return;
    if (selectedTask?.parentId && scopeTasks.some((t) => t.id === selectedTask.parentId)) return;
    // Never a completed task Display hides (TV-U1): the Board has no
    // fallback of its own, so it would open the panel on a card it doesn't show.
    setSelectedTaskId(scopeTasks.find((t) => !isHiddenByDisplay(t))?.id ?? null);
  }, [api.loading, inboundPending, selectedTaskId, selectedTask, scopeTasks, isHiddenByDisplay]);

  // ── DF-1: URL-held selection ─────────────────────────────────────────────────
  // Inbound apply — honor a deep-link target once the bundle is CLEANLY loaded
  // (a failed fetch leaves an empty bundle with api.error set; resolving
  // against that would wrongly strip a valid id — hold until Retry succeeds).
  // A fresh external open (marked by the app-chrome listener) gets the full
  // "take me there" treatment: plan mode. Filters and search are never
  // cleared (they're saved per scope): the target stays listed past them
  // while it's selected (`keepTaskId`, TV-U2). A mirrored id arriving back on
  // refresh/back-forward restores the selection quietly and keeps the user's
  // mode. Scope snaps to the
  // task's bucket unless the current scope already shows it. A bucket id (a
  // `project` link) scopes the rail; a stale or archived id clears quietly and
  // the backstop above picks the default (AC: no crash).
  useEffect(() => {
    if (api.loading || api.error) return;
    if (!urlTaskId) {
      processedUrlIdRef.current = null;
      return;
    }
    if (processedUrlIdRef.current === urlTaskId) return;
    if (selfWroteUrlIdRef.current === urlTaskId) {
      processedUrlIdRef.current = urlTaskId;
      return;
    }
    processedUrlIdRef.current = urlTaskId;
    const external = takeEntityOpenIntent(urlTaskId);
    // Won't do tasks open too: the selected one stays in scope with Reopen
    // (see `keptArchivedId`). A task in a project you can't see opens in All.
    const target = resolveTasksDeepLink(urlTaskId, { tasks, buckets, inboxId });
    if (target.kind === "none") {
      // A link someone followed (a notification, a chip) to a task you can't
      // open says so, never lands on another task (AC1.10). A stale id that
      // only comes back on refresh or back/forward clears quietly.
      if (external) setPrivateLinkId(urlTaskId);
      onUrlTaskIdChange(null);
      return;
    }
    setPrivateLinkId(null);
    if (external) setMode("plan");
    if (target.kind === "bucket") {
      setSelection(target.scope);
      // Hand the URL to the backstop's fresh pick — the mirror must not
      // re-publish the previous scope's selection over the project link.
      setSelectedTaskId(null);
      return;
    }
    if (!scopeTasksAll.some((t) => t.id === target.taskId)) setSelection(target.scope);
    setSelectedTaskId(target.taskId);
    setRevealRequest((prev) => ({ id: target.taskId, seq: (prev?.seq ?? 0) + 1 }));
    scrollTargetRef.current = target.taskId;
  }, [
    api.loading,
    api.error,
    urlTaskId,
    tasks,
    buckets,
    inboxId,
    scopeTasksAll,
    onUrlTaskIdChange,
  ]);

  // Mirror selection → URL (replace) so refresh keeps it. Trailing-debounced:
  // the URL only needs to be right at rest, and WebKit throttles
  // history.replaceState (~100 calls/30s) — an undebounced j/k key-repeat
  // cursor would trip a SecurityError in the desktop webview. Suspended while
  // an inbound id awaits apply — never overwrite a target before honoring it.
  useEffect(() => {
    if (api.loading || inboundPending) return;
    if ((selectedTaskId ?? null) === (urlTaskId ?? null)) return;
    const handle = window.setTimeout(() => {
      selfWroteUrlIdRef.current = selectedTaskId;
      onUrlTaskIdChange(selectedTaskId);
    }, URL_MIRROR_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [api.loading, inboundPending, selectedTaskId, urlTaskId, onUrlTaskIdChange]);

  // Reveal the deep-linked row/card/bar once it exists in the DOM — the scope
  // snap, a collapsed group's reveal, and a nested subtask's parent
  // auto-expand settle over a few frames, so poll briefly instead of assuming
  // one. Instant scroll: a programmatic reveal, not an animation. `inline`
  // reveals horizontally too (the Timeline canvas scrolls sideways).
  useEffect(() => {
    const id = scrollTargetRef.current;
    if (!id || api.loading) return;
    scrollTargetRef.current = null;
    let tries = 0;
    const reveal = () => {
      const el = document.querySelector(`[data-task-id="${CSS.escape(id)}"]`);
      if (el) {
        el.scrollIntoView({ block: "center", inline: "center" });
        return;
      }
      if (++tries < 24) requestAnimationFrame(reveal);
    };
    requestAnimationFrame(reveal);
  }, [api.loading, urlTaskId]);

  // The toolbar's page-owned pieces, passed to every view as nodes so List,
  // Board and Timeline stay unaware of the filter and Display machinery. The
  // count is the scope's open tasks, as in the rail.
  // Manual order lives inside one project (default m): a sorted project view
  // says so and goes back in one click; a drag there asks the same.
  const order = tasksDisplay.display.order;
  const setDisplay = tasksDisplay.setDisplay;
  const display = tasksDisplay.display;
  const backToManualOrder = useCallback(
    () => setDisplay({ ...display, order: "manual" }),
    [setDisplay, display],
  );
  const header: PlanHeaderControls = {
    count: openCount(scopeTasksAll),
    search: filtering.search,
    filter: filtering.filter,
    display: tasksDisplay.displayControl,
    activeFilters: filtering.activeFilters,
    sortedNote:
      view !== "timeline" && order !== "manual" && showsSortedNote(selection, order) ? (
        <SortedOrderLine label={sortedByLabel(order)} onManualOrder={backToManualOrder} />
      ) : null,
  };

  const sharedViewProps = {
    tasks: scopeTasks,
    scopeTitle,
    selection,
    view,
    onViewChange: setView,
    buckets,
    inbox,
    bucketNameById,
    canEdit,
    onRequestCapture: openCapture,
    selectedTaskId,
    onSelectTask: setSelectedTaskId,
    header,
    filterActive: filtering.active,
    onClearFilters: filtering.clear,
    api: viewApi,
  };
  // List and Board follow Display; the Timeline keeps its own rules.
  const displayProps = tasksDisplay.viewProps;

  // Execute mode is enclosed in the center panel (rails stay visible).
  const body =
    mode === "execute" ? (
      <ExecuteView
        workspaceId={workspaceId}
        queuedTasks={api.queuedTasks}
        bucketNameById={bucketNameById}
        parentTitleFor={parentTitleFor}
        blockedNoteFor={blockedNoteFor}
        onMarkDone={api.markDone}
        onSkip={api.moveQueuedToEnd}
        onAddTime={(taskId, seconds) => void api.logTimeAdjustment(taskId, seconds)}
        onSetTime={api.setTimeSpent}
        tagsFor={(id) => api.tagsByTask.get(id) ?? []}
        subtasksFor={(id) => api.subtasksByParent.get(id) ?? []}
        onToggleSubtask={api.toggleDone}
        onExit={exitExecute}
        loading={api.loading}
        canEdit={canEdit}
        onCaptureToQueue={api.captureToQueue}
      />
    ) : view === "board" ? (
      <TaskBoardView
        {...sharedViewProps}
        {...displayProps}
        dndMode="external"
        boardGroupBy={tasksDisplay.display.boardGroup}
        statusFilter={statusFilter}
        onManualOrder={backToManualOrder}
      />
    ) : view === "timeline" ? (
      <TaskTimelineView {...sharedViewProps} zoom={timelineZoom} onZoomChange={setTimelineZoom} />
    ) : (
      <TaskListView
        {...sharedViewProps}
        {...displayProps}
        dndMode="external"
        groupBy={effectiveGroupBy}
        reorderable={selection === "today"}
        onReorder={api.reorderQueue}
        onManualOrder={backToManualOrder}
        revealRequest={revealRequest}
      />
    );

  // The hosted Supabase project may not have the tasks tables yet (web only).
  const notMigrated = /schema cache|could not find the table|does not exist/i.test(api.error ?? "");
  const center = (
    <div className="flex h-full min-h-0 flex-col">
      {api.error ? (
        <div className="mb-3 flex shrink-0 items-start justify-between gap-3 rounded-md border border-border bg-muted px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 font-sans text-muted-foreground">
            {notMigrated
              ? "Tasks aren’t set up on this database yet — apply the Supabase migrations, or use the desktop app."
              : `Couldn’t load tasks: ${api.error}`}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={api.loading}
            onClick={() => void api.reload()}
          >
            {api.loading ? "Retrying…" : "Retry"}
          </Button>
        </div>
      ) : null}
      <div className="min-h-0 flex-1">{body}</div>
    </div>
  );

  // ── DF-22: one app-level DndContext across the whole shell ──────────────────
  // Unifies the center views' reorder/nest with the right-pane hub (DF-8 shipped
  // the hub as a ready-but-sourceless drop target) so a task dragged from the
  // List or Board can be dropped on the selected task's hub to link it. The List
  // & Board render as `useDndMonitor` consumers (dndMode="external", the NO-7b
  // pattern); the Timeline keeps its OWN nested context — its tray→axis drag
  // needs autoScroll off and a keyboard-disabled, pointer-derived drop that
  // genuinely conflict with a shared context, and it has no cross-pane drop
  // target (bars are custom pointer engines, not dnd-kit). Nested = the inner
  // timeline context claims tray drags, so the hub handler never sees them.
  const pageSensors = useTaskDndSensors();
  // Refs so the collision fn (stable, empty-deps) always reads the live surface;
  // neither can change mid-drag (switching view/scope remounts the body).
  const viewRef = useRef(view);
  const selectionRef = useRef(selection);
  useEffect(() => {
    viewRef.current = view;
    selectionRef.current = selection;
  });
  // One collision for every surface. The hub (`link:*`) and the rail
  // (`rail:*`, TV-U4) win whenever the pointer is actually over one of their
  // droppables — prefix-filtered `pointerWithin`, so a drag near them never
  // snaps to them by distance. Otherwise each centre view keeps its OWN native
  // strategy over its OWN droppables (hub and rail filtered out): Board =
  // closestCorners; Queue reorder = closestCenter (NOT pointer-first — the
  // whole row is the drag activator, so an off-center grab makes the
  // dragged-rect-centre and the pointer diverge, changing the drop index). The
  // List has no droppables: it resolves reorder/nest/group from the raw
  // pointer itself (dnd/drop-mode.ts), so it finds nothing here.
  const appCollision = useCallback<CollisionDetection>((args) => {
    const linkContainers = args.droppableContainers.filter((c) => String(c.id).startsWith("link:"));
    if (linkContainers.length > 0) {
      const hubHits = pointerWithin({ ...args, droppableContainers: linkContainers });
      if (hubHits.length > 0) return hubHits;
    }
    const railHits = railCollision(args);
    if (railHits.length > 0) return railHits;
    const centerContainers = args.droppableContainers.filter((c) => !isSideDroppable(c.id));
    if (viewRef.current === "board") {
      return closestCorners({ ...args, droppableContainers: centerContainers });
    }
    if (selectionRef.current === "today") {
      return closestCenter({ ...args, droppableContainers: centerContainers });
    }
    return [];
  }, []);

  // What a screen reader hears during a drag, for every surface on the page:
  // titles and the names of the rows and columns, never ids (TV-U4).
  const dragAnnouncements = useMemo(() => {
    const taskName = (id: string) => {
      const task = taskById.get(id);
      return task ? `“${task.title || "Untitled"}”` : null;
    };
    const targetName = (id: string): string | null => {
      if (id.startsWith(`${RAIL_DROP_PREFIX}bucket:`)) {
        return bucketNameById(id.slice(`${RAIL_DROP_PREFIX}bucket:`.length));
      }
      if (id === `${RAIL_DROP_PREFIX}queue`) return "the Queue";
      if (id === `${RAIL_DROP_PREFIX}mine`) return "My tasks";
      if (id.startsWith("link:")) return "the open task, to link them";
      if (id.startsWith("col:status:")) {
        return STATUS_LABELS[id.slice("col:status:".length) as TaskStatus] ?? null;
      }
      if (id.startsWith("col:bucket:")) return bucketNameById(id.slice("col:bucket:".length));
      return taskName(id);
    };
    return taskDragAnnouncements({ taskName: (id) => taskName(id) ?? "the task", targetName });
  }, [taskById, bucketNameById]);

  // Opening a linked task selects it in place; other entity types deep-link out.
  const handleOpenEntity = useCallback(
    (ref: EntityRef) => {
      if (ref.type === "task") {
        // Route through the DF-1 deep-link path (URL ?id=), not a raw
        // setSelectedTaskId: a linked task may live outside the current bucket
        // scope (spine links cross buckets), and the scope-validity backstop
        // would bounce a raw selection back to the first in-scope task. The
        // inbound-apply effect snaps scope to the target's bucket first.
        onUrlTaskIdChange(ref.id);
        return;
      }
      window.dispatchEvent(
        new CustomEvent(ENTITY_OPEN_EVENT, { detail: { type: ref.type, id: ref.id } }),
      );
    },
    [onUrlTaskIdChange],
  );
  const onHubDragEnd = useCallback(
    (event: DragEndEvent) => {
      const payload = asDragPayload(event.active.data.current);
      const target = asDropLinkTarget(event.over?.data.current);
      if (!payload || !target) return;
      if (!runtime || !canEdit) return;
      if (isSelfDrop(payload, target)) {
        toast("You can’t link a task to itself");
        return;
      }
      if (!targetAccepts(target, payload)) return;
      void (async () => {
        // Guard a pre-existing edge: a fresh Undo toast on an already-linked pair
        // would delete a link the user didn't make in THIS gesture (FX-9 parity).
        try {
          const links = await runtime.spine.listLinks({
            workspaceId,
            entityType: target.entityType,
            entityId: target.entityId,
          });
          const already = links.some(
            (l) =>
              (l.sourceType === payload.entityType && l.sourceId === payload.entityId) ||
              (l.targetType === payload.entityType && l.targetId === payload.entityId),
          );
          if (already) {
            toast("Already linked");
            return;
          }
        } catch {
          // a failed pre-check must not block a legitimate link
        }
        await createLinkWithToast({
          runtime,
          workspaceId,
          source: payload,
          target,
          origin: "drag",
          onChanged: () => window.dispatchEvent(new CustomEvent(TASK_DETAIL_REFRESH_EVENT)),
        });
      })();
    },
    [runtime, workspaceId, canEdit],
  );

  const detailPanel = (
    <TaskDetailPanel
      task={selectedTask}
      buckets={buckets}
      inbox={inbox}
      canEdit={canEdit}
      onRequestCapture={openCapture}
      onSelectTask={setSelectedTaskId}
      api={viewApi}
      runtime={runtime}
      workspaceId={workspaceId}
      onOpenEntity={handleOpenEntity}
    />
  );
  // The hub is a drop target within the ONE page-level DndContext (below); no
  // own context — that's exactly what let center rows reach it (DF-22).
  const details = privateLinkId ? (
    <PrivateItemPanel onBack={() => setPrivateLinkId(null)} />
  ) : selectedTask ? (
    <HubDropZone target={{ type: "task", id: selectedTask.id }} disabled={!canEdit}>
      {detailPanel}
    </HubDropZone>
  ) : (
    detailPanel
  );
  // The right panel's title row names and switches its views (SH-1): Details
  // today; Project, In flight and No date register in panel-views.ts later.
  const right = (
    <RightPanel
      module="tasks"
      views={{ details: () => details }}
      activeId={panelView}
      onChange={setPanelView}
    />
  );

  return (
    <>
      <DndContext
        sensors={pageSensors}
        collisionDetection={appCollision}
        accessibility={{ announcements: dragAnnouncements }}
        onDragEnd={(event) => {
          // Spatially disjoint: each acts only when `over` is its own target.
          onHubDragEnd(event);
          onRailDragEnd(event);
        }}
      >
        <FeaturePanelsShell
          feature="tasks"
          notice={truncationNotice(api.truncated)}
          left={left}
          center={center}
          right={right}
        />
      </DndContext>
      <CaptureModal
        open={captureOpen}
        onOpenChange={setCaptureOpen}
        buckets={buckets}
        inbox={inbox}
        defaultBucketId={captureBucketId}
        // New inside a filtered scope pre-fills the filter's tag, assignee and
        // priority (U2-5); never in Focus, whose filters aren't on screen.
        seed={captureSeed}
        tags={api.tags}
        onCreate={(fields, { tagIds }) => {
          const created = createCaptured(fields);
          for (const id of tagIds) {
            const tag = api.tags.find((t) => t.id === id);
            if (tag) api.createTagForTask(tag.name, created);
          }
        }}
      />
      <DriftTriageDialog
        open={triageBucketId !== null}
        onOpenChange={(o) => !o && setTriageBucketId(null)}
        bucketName={triageBucketId ? bucketNameById(triageBucketId) : ""}
        tasks={driftTasks}
        canEdit={canEdit}
        onReschedule={(id, days) => api.rescheduleScheduledAt(id, days)}
        onArchive={api.archiveTask}
        onIgnore={api.unscheduleTask}
        onCloseAutoFocus={(event) =>
          restoreNavFocus(event, railNavRef.current, triageFromRef.current)
        }
      />
      <FrontierOfferDialog
        open={frontierOfferTaskId !== null}
        onOpenChange={(o) => !o && setFrontierOfferTaskId(null)}
        task={frontierOfferTask}
        frontier={frontierOffer}
        bucketNameById={bucketNameById}
        onQueueTask={api.addToQueue}
        onQueueAnyway={() => {
          if (frontierOfferTaskId) api.addToQueue(frontierOfferTaskId);
        }}
      />
    </>
  );
}
