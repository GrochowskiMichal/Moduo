import {
  isBacklogTask,
  isClosedTask,
  isOpenTask,
  type TaskStatusCategory,
} from "@contracts/vocabularies";
import {
  type CollisionDetection,
  closestCenter,
  closestCorners,
  DndContext,
  type DragEndEvent,
  pointerWithin,
} from "@dnd-kit/core";
import { CircleCheck } from "lucide-react";
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { dispatchOpenCapture } from "../../../components/app/capture-shell";
import { onCreateNew } from "../../../components/app/create-events";
import { FeaturePanelsShell } from "../../../components/app/feature-panels-shell";
import { type PanelItem, RightPanel, usePanelStack } from "../../../components/app/right-panel";
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
import {
  ENTITY_OPEN_EVENT,
  markEntityOpenIntent,
  takeEntityOpenIntent,
} from "../../../lib/entity-open";
import {
  type TasksSidebarHideable,
  updatePreferences,
  usePreferencesValue,
} from "../../../lib/preferences";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { undoToast } from "../../../lib/undo-toast";
import { HubDropZone } from "../../contacts/ui/hub-drop-zone";
import { consumeFocusViewRequest, FOCUS_VIEW_REQUEST_EVENT } from "../../focus/view-request";
import { looksLikeHandle } from "../../spine/grammar";
import {
  type ReferenceHost,
  ReferenceHostProvider,
  useReferenceStore,
  useReferences,
} from "../../spine/references/context";
import { referenceKey, referenceKind } from "../../spine/references/kinds";
import type { ReferenceRef } from "../../spine/references/types";
import {
  ReferencePanelBody,
  referencePanelOpen,
  referencePanelTitle,
} from "../../spine/references/ui/reference-panel";
import { createLinkWithToast } from "../../spine/ui/drop-link-toast";
import { WorkspaceContext } from "../../workspaces/workspace-context";
import { useAssignees } from "../assignees";
import { myTasksScope, openCount, resolveDefaultSelection, showsMyTasks } from "../default-view";
import type { TaskLayout } from "../display";
import {
  asRailDropTarget,
  isSideDroppable,
  projectMoveWrite,
  RAIL_DROP_PREFIX,
  type RailDropTarget,
  railCollision,
  railDropAction,
  railSortCollision,
} from "../dnd/rail-drop";
import { type CaptureSeed, showsArchived, showsBacklog, statusesLetThrough } from "../filters";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { type Bucket, isDrifted, PRIVATE_PROJECT_LABEL, type Task } from "../model";
import { showsSortedNote, sortedByLabel } from "../order";
import { resolveTasksDeepLink, taskIdForHandle } from "../search";
import { projectDeleteSummary, projectOpenWork } from "../sidebar";
import { STATUS_KEY_LABELS, type StatusKey } from "../statuses";
import { sanitizeTimelineZoom, type TimelineZoom } from "../timeline-geometry";
import { ArchivedProjectBanner, ArchivedProjectsView } from "./archived-projects-view";
import {
  ARCHIVED_SELECTION,
  asRailProject,
  BucketRail,
  parseCollapsedSections,
  type TasksMode,
  TRASH_SELECTION,
  UPCOMING_SELECTION,
} from "./bucket-rail";
import { ArchiveProjectDialog, DeleteBucketDialog } from "./delete-bucket-dialog";
import { asTaskDrag, taskDragAnnouncements, useTaskDndSensors } from "./dnd/task-dnd";
import { DriftTriageDialog } from "./drift-triage-dialog";
import { ExecuteView } from "./execute-view";
import { FrontierOfferDialog } from "./frontier-offer-dialog";
import { type PlanHeaderControls, type PlanView, SortedOrderLine } from "./plan-view-header";
import { RecentlyDeletedView } from "./recently-deleted-view";
import { StatusesDialog } from "./statuses-dialog";
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

const EMPTY_IDS: readonly string[] = [];

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
  // Sidebar groups you collapsed (Pinned and each area) stay collapsed,
  // remembered per person on this device (REPLAN 29e; Customize and Pin
  // follow the person everywhere, in preferences).
  const collapseKey = `collapsedGroups:${api.currentUserId ?? "anon"}`;
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() =>
    parseCollapsedSections(readLS(workspaceId, collapseKey)),
  );
  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const sidebarPrefs = usePreferencesValue().tasksSidebar;
  const hiddenRows = useMemo(() => new Set(sidebarPrefs.hidden), [sidebarPrefs.hidden]);
  const pinnedIds = sidebarPrefs.pinned[workspaceId] ?? EMPTY_IDS;
  const toggleHiddenRow = useCallback(
    (row: TasksSidebarHideable) => {
      const hidden = sidebarPrefs.hidden.includes(row)
        ? sidebarPrefs.hidden.filter((r) => r !== row)
        : [...sidebarPrefs.hidden, row];
      updatePreferences({ tasksSidebar: { ...sidebarPrefs, hidden } });
    },
    [sidebarPrefs],
  );
  const togglePin = useCallback(
    (projectId: string) => {
      const mine = sidebarPrefs.pinned[workspaceId] ?? [];
      const next = mine.includes(projectId)
        ? mine.filter((id) => id !== projectId)
        : [...mine, projectId];
      updatePreferences({
        tasksSidebar: { ...sidebarPrefs, pinned: { ...sidebarPrefs.pinned, [workspaceId]: next } },
      });
    },
    [sidebarPrefs, workspaceId],
  );
  // A project's Delete… and Archive… confirms (REPLAN 78), from the sidebar or
  // Archived projects. The project is kept while the dialog closes.
  const [projectDialog, setProjectDialog] = useState<{
    kind: "delete" | "archive";
    bucket: Bucket;
    open: boolean;
  } | null>(null);
  const [triageBucketId, setTriageBucketId] = useState<string | null>(null);
  // Statuses (TV-D9): a project's (its ⋯, or "+ Add status" on its board), or
  // the workspace default set (the Inbox's ⋯). Null = closed.
  const [statusesEditor, setStatusesEditor] = useState<{
    projectId: string | null;
    addingTo?: TaskStatusCategory | null;
  } | null>(null);
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
  // A handle deep link (`?id=MOD-142`, RF-1) being looked up, and the URL's
  // latest id (the lookup is dropped if the URL moved on meanwhile).
  const handlePendingRef = useRef<string | null>(null);
  const latestUrlIdRef = useRef(urlTaskId);
  useLayoutEffect(() => {
    latestUrlIdRef.current = urlTaskId;
  });
  const taskKey = useContext(WorkspaceContext)?.selectedWorkspace?.taskKey ?? null;
  const referenceStore = useReferenceStore();
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
    () => writeLS(workspaceId, collapseKey, JSON.stringify([...collapsedGroups])),
    [workspaceId, collapseKey, collapsedGroups],
  );

  // Remember where you were, so the next open lands back on it (REPLAN 30);
  // Archived projects and Recently deleted aren't places to reopen.
  useEffect(() => {
    if (selection === ARCHIVED_SELECTION || selection === TRASH_SELECTION) return;
    if (api.archivedBuckets.some((b) => b.id === selection)) return;
    writeLS(workspaceId, "lastBucket", selection);
  }, [workspaceId, selection, api.archivedBuckets]);

  const inboxId = inbox?.id ?? null;

  // Where Tasks opens, run once per workspace after the bundle loads: where
  // you left it, else the Inbox (REPLAN 30; "Open at" is retired). A place
  // picked in the sidebar before the bundle answered wins.
  const resolvedForRef = useRef<string | null>(null);
  const pickedForRef = useRef<string | null>(null);
  const pickSelection = useCallback(
    (next: string) => {
      pickedForRef.current = workspaceId;
      setSelection(next);
    },
    [workspaceId],
  );
  useEffect(() => {
    if (api.loading) return;
    if (resolvedForRef.current === workspaceId) return;
    if (pickedForRef.current === workspaceId) {
      resolvedForRef.current = workspaceId;
      return;
    }
    // DF-1: an inbound deep link owns the entry scope — skip the
    // last-place default rather than race the apply effect below for it
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
        lastBucket: readLS(workspaceId, "lastBucket"),
        bucketIds,
        inboxId,
      }),
    );
  }, [api.loading, workspaceId, inboxId, buckets, inboundPending]);

  // "My tasks" is only in the rail of workspaces with two or more members
  // (tasks-v2 §1): with fewer, every task is yours, so All says the same.
  const { assignees, currentUserId } = useAssignees();
  // Owners and admins edit the workspace's default statuses (TV-D9). Read
  // without useWorkspace so the page renders where no provider is mounted.
  const canManageWorkspace = useContext(WorkspaceContext)?.canManageWorkspace ?? false;
  const showMyTasks = showsMyTasks(assignees.length);

  // Keep selection valid; "inbox" resolves against the seeded Inbox bucket.
  useEffect(() => {
    if (
      selection === "all" ||
      selection === "inbox" ||
      selection === "today" ||
      selection === UPCOMING_SELECTION ||
      selection === ARCHIVED_SELECTION ||
      selection === TRASH_SELECTION
    )
      return;
    if (selection === "mine") {
      // Members load with the workspace; wait for them before ruling.
      if (!showMyTasks && assignees.length > 0) setSelection("inbox");
      return;
    }
    if (inboxId && selection === inboxId) return;
    // An archived project opens read-only from Archived projects (TV-U6).
    if (api.archivedBuckets.some((b) => b.id === selection)) return;
    if (!buckets.some((b) => b.id === selection)) setSelection("inbox");
  }, [selection, buckets, inboxId, showMyTasks, assignees.length, api.archivedBuckets]);
  /** The archived project open now (read-only), if any. */
  const archivedProject = useMemo(
    () => api.archivedBuckets.find((b) => b.id === selection) ?? null,
    [api.archivedBuckets, selection],
  );

  // A task can sit in a project you can't see (it was assigned to you): that
  // project reads "Private project", never "Inbox" (TV-P0, AC1.10).
  // An archived project's tasks show only when you open it or search, and
  // its name says so (REPLAN 78: search finds them, labelled "Archived").
  const bucketNameById = useCallback(
    (id: string) => {
      if (inbox && id === inbox.id) return "Inbox";
      const live = buckets.find((b) => b.id === id);
      if (live) return live.name;
      const archived = api.archivedBuckets.find((b) => b.id === id);
      return archived ? `${archived.name} · Archived` : PRIVATE_PROJECT_LABEL;
    },
    [buckets, inbox, api.archivedBuckets],
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
  // Backlog sits out of My tasks unless a Status filter asks for it (TV-D9).
  const withBacklog = showsBacklog(tasksDisplay.filters);
  const statusFilter = useMemo(
    () => statusesLetThrough(tasksDisplay.filters),
    [tasksDisplay.filters],
  );

  const scopeTasksAll = useMemo(() => {
    if (selection === "today") return api.queuedTasks;
    if (selection === ARCHIVED_SELECTION || selection === TRASH_SELECTION) return [];
    const live = (t: Task) => t.status !== "archived" || withArchived || t.id === keptArchivedId;
    if (selection === "all") return tasks.filter(live);
    if (selection === UPCOMING_SELECTION) {
      // Until TV-U15's Upcoming: your dated tasks and unassigned ones, by date
      // (spec §8). Backlog and finished ones sit out.
      return tasks.filter(
        (t) =>
          (t.dueDate || t.scheduledAt) &&
          (t.assigneeId === null || t.assigneeId === currentUserId) &&
          !isClosedTask(t) &&
          !isBacklogTask(t),
      );
    }
    if (archivedProject) {
      return api.archivedTasks.filter((t) => t.bucketId === archivedProject.id && live(t));
    }
    if (selection === "mine") {
      if (!withArchived && !withBacklog && !keptArchivedId)
        return myTasksScope(tasks, currentUserId);
      if (!currentUserId) return myTasksScope(tasks, currentUserId);
      // My tasks' rule (assigned to me, not Won't do, not Backlog), plus the
      // Won't do and Backlog ones a Status filter asks for, plus the kept one.
      return tasks.filter(
        (t) =>
          t.assigneeId === currentUserId &&
          live(t) &&
          (!isBacklogTask(t) || withBacklog || t.id === selectedTaskId),
      );
    }
    const bucketId = selection === "inbox" ? inboxId : selection;
    if (!bucketId) return [];
    return tasks.filter((t) => t.bucketId === bucketId && live(t));
  }, [
    selection,
    tasks,
    inboxId,
    api.queuedTasks,
    currentUserId,
    keptArchivedId,
    withArchived,
    withBacklog,
    selectedTaskId,
    archivedProject,
    api.archivedTasks,
  ]);
  // Search in All also finds archived projects' tasks, labelled (REPLAN 78).
  const archivedSearchTasks = useMemo(
    () => (selection === "all" ? api.archivedTasks.filter((t) => t.status !== "archived") : []),
    [selection, api.archivedTasks],
  );

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
    searchExtra: archivedSearchTasks,
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
          ? "Focus"
          : selection === UPCOMING_SELECTION
            ? "Upcoming"
            : selection === "inbox"
              ? "Inbox"
              : archivedProject
                ? archivedProject.name
                : bucketNameById(selection);

  // The Queue is one ordered line-up, so its List view is never grouped.
  const effectiveGroupBy = selection === "today" ? "none" : tasksDisplay.display.group;

  // ⌘N, "+ New" and `c` capture "here" (tasks-v3 call 90, TV-U14): in a
  // project, that project; with a task of a section selected there, that
  // section (TV-U10's group "+" passes its own); in Focus or the Queue, the
  // top of Up next. Anywhere else, the capture's own default: your Inbox.
  const captureHere = useMemo(() => {
    // An archived project's page, Upcoming, Archived and Recently deleted
    // aren't places to file into: the capture's own default (your Inbox).
    const project = archivedProject
      ? null
      : (buckets.find((b) => b.id === selection && !b.isSystem) ?? null);
    return {
      projectId: project?.id ?? null,
      queueTop: mode === "execute" || selection === "today",
    };
  }, [buckets, selection, mode, archivedProject]);

  const totalOpenCount = useMemo(() => tasks.filter((t) => isOpenTask(t)).length, [tasks]);
  const myOpenCount = useMemo(
    () => (showMyTasks ? openCount(myTasksScope(tasks, currentUserId)) : 0),
    [showMyTasks, tasks, currentUserId],
  );

  // Drifted tasks for the bucket currently being triaged (recomputed live so the
  // dialog empties as the user triages).
  const driftTasks = useMemo(() => {
    if (!triageBucketId) return [];
    const now = new Date();
    return tasks.filter((t) => t.bucketId === triageBucketId && isDrifted(t, now));
  }, [triageBucketId, tasks]);

  const openCapture = useCallback(
    (at?: { sectionId?: string | null }) => {
      if (!canEdit) return;
      const { projectId, queueTop } = captureHere;
      const open = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null;
      const sectionId =
        at?.sectionId ??
        (projectId && open?.bucketId === projectId ? (open.sectionId ?? null) : null);
      dispatchOpenCapture({
        destination: projectId ? { projectId, sectionId } : undefined,
        queueTop,
        seed: captureSeed,
      });
    },
    [canEdit, captureHere, selectedTaskId, tasks, captureSeed],
  );

  // cmd+n / global "+" → capture (this listener is only mounted on /tasks).
  useEffect(() => onCreateNew(() => openCapture()), [openCapture]);

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
      const open = (api.blockersByTask.get(task.id) ?? []).filter((b) => !isClosedTask(b));
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

  // A project's Archive… asks first only when it still has open work
  // (REPLAN 78); otherwise it archives at once, with Undo.
  const requestArchive = useCallback(
    (bucket: Bucket) => {
      if (projectOpenWork(api.tasks, bucket.id).open.length === 0) {
        api.archiveBucket(bucket.id, { kind: "keep" });
        return;
      }
      setProjectDialog({ kind: "archive", bucket, open: true });
    },
    [api],
  );
  const checkProjectAccess = useCallback(
    async (projectId: string) =>
      runtime ? (await runtime.tasks.projectAccess({ projectId })).canManage : true,
    [runtime],
  );
  // The delete toast's "Recently deleted" link (REPLAN 98).
  useEffect(() => {
    api.openTrashRef.current = () => setSelection(TRASH_SELECTION);
    return () => {
      api.openTrashRef.current = null;
    };
  }, [api.openTrashRef]);
  const trashCount = (api.trash?.buckets.length ?? 0) + (api.trash?.tasks.length ?? 0);

  const left = (
    <BucketRail
      mode={mode}
      onModeChange={setMode}
      selection={selection}
      onSelect={pickSelection}
      buckets={buckets}
      areas={api.areas}
      inbox={inbox}
      openCountByBucket={api.openTaskCountByBucket}
      driftCountByBucket={api.driftCountByBucket}
      totalOpenCount={totalOpenCount}
      queueCount={api.queueCount}
      myTasksCount={showMyTasks ? myOpenCount : null}
      canEdit={canEdit}
      hidden={hiddenRows}
      onToggleHidden={toggleHiddenRow}
      pinned={pinnedIds}
      onTogglePin={togglePin}
      collapsed={collapsedGroups}
      onToggleCollapsed={toggleGroup}
      onCreateBucket={(name, areaId) => api.createBucket(name, { areaId })}
      onRenameBucket={api.renameBucket}
      onRequestDelete={(bucket) => setProjectDialog({ kind: "delete", bucket, open: true })}
      onRequestArchive={requestArchive}
      onSetBucketColor={api.setBucketColor}
      onMoveBucket={api.moveBucket}
      onMoveBucketToArea={api.moveBucketToArea}
      onCaptureInto={(id) => {
        // A project's "+" in the sidebar: capture into that project.
        if (canEdit) dispatchOpenCapture({ destination: { projectId: id }, seed: captureSeed });
      }}
      onTriageBucket={(id) => {
        triageFromRef.current = id;
        setTriageBucketId(id);
      }}
      onEditStatuses={canEdit ? (id) => setStatusesEditor({ projectId: id }) : undefined}
      onEditDefaultStatuses={
        canEdit && canManageWorkspace ? () => setStatusesEditor({ projectId: null }) : undefined
      }
      onCreateArea={api.createArea}
      onRenameArea={api.renameArea}
      onSetAreaColor={api.setAreaColor}
      onMoveArea={api.moveArea}
      onDeleteArea={api.deleteArea}
      archivedCount={api.archivedBuckets.length}
      trashCount={trashCount}
      navRef={railNavRef}
      dropAccepts={railAccepts}
    />
  );

  // Resolve the selected task live from the bundle so the rail follows edits and
  // empties when the task is deleted. A task of an archived project (opened
  // from Archived projects, or found by search) opens too, read-only (TV-U6).
  const selectedArchivedTask = useMemo(
    () =>
      selectedTaskId ? (api.archivedTasks.find((t) => t.id === selectedTaskId) ?? null) : null,
    [selectedTaskId, api.archivedTasks],
  );
  const selectedTask = useMemo(
    () =>
      selectedTaskId ? (tasks.find((t) => t.id === selectedTaskId) ?? selectedArchivedTask) : null,
    [selectedTaskId, tasks, selectedArchivedTask],
  );
  const panelCanEdit = canEdit && !selectedArchivedTask;

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
    // Done, Won't do and Backlog tasks arrive after the open ones (the shared
    // store, TV-D11a): a link to one waits for them before it reads as gone.
    if (
      !api.restLoaded &&
      !looksLikeHandle(urlTaskId) &&
      resolveTasksDeepLink(urlTaskId, { tasks, buckets, inboxId }).kind === "none"
    ) {
      return;
    }
    processedUrlIdRef.current = urlTaskId;
    const external = takeEntityOpenIntent(urlTaskId);
    // A handle (`?id=MOD-142`, RF-1): find its task (here, else on the server,
    // which knows the old keys too), then follow the task's own id, keeping a
    // "take me there" mark. A handle you can't open is a "Private item".
    if (looksLikeHandle(urlTaskId)) {
      const handle = urlTaskId;
      handlePendingRef.current = handle;
      const follow = (id: string | null) => {
        if (handlePendingRef.current !== handle) return;
        handlePendingRef.current = null;
        if (latestUrlIdRef.current !== handle) return;
        if (!id) {
          if (external) setPrivateLinkId(handle);
          onUrlTaskIdChange(null);
          return;
        }
        if (external) markEntityOpenIntent(id);
        onUrlTaskIdChange(id);
      };
      const local = taskIdForHandle(handle, tasks, taskKey);
      if (local) follow(local);
      else if (referenceStore) void referenceStore.resolveHandle(handle).then(follow);
      else follow(null);
      return;
    }
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
    api.restLoaded,
    urlTaskId,
    tasks,
    buckets,
    inboxId,
    scopeTasksAll,
    onUrlTaskIdChange,
    taskKey,
    referenceStore,
  ]);

  // Mirror selection → URL (replace) so refresh keeps it. Trailing-debounced:
  // the URL only needs to be right at rest, and WebKit throttles
  // history.replaceState (~100 calls/30s) — an undebounced j/k key-repeat
  // cursor would trip a SecurityError in the desktop webview. Suspended while
  // an inbound id awaits apply — never overwrite a target before honoring it
  // (a handle being looked up included).
  useEffect(() => {
    if (api.loading || inboundPending || handlePendingRef.current) return;
    if ((selectedTaskId ?? null) === (urlTaskId ?? null)) return;
    const handle = window.setTimeout(() => {
      if (handlePendingRef.current) return;
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
    // An archived project is read-only until it's unarchived (TV-U6).
    canEdit: canEdit && !archivedProject,
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
  // Archived projects and Recently deleted open from the sidebar's ⋯ (98).
  const body =
    mode === "plan" && selection === TRASH_SELECTION ? (
      <RecentlyDeletedView
        trash={api.trash}
        bucketName={(id) => {
          const name = bucketNameById(id);
          return name === PRIVATE_PROJECT_LABEL ? null : name;
        }}
        canEdit={canEdit}
        onRestore={(target, label) => void api.restoreFromTrash(target, { label })}
        onDeleteForever={api.deleteForever}
      />
    ) : mode === "plan" && selection === ARCHIVED_SELECTION ? (
      <ArchivedProjectsView
        projects={api.archivedBuckets}
        openCountByProject={(id) => projectOpenWork(api.archivedTasks, id).open.length}
        canEdit={canEdit}
        onOpen={setSelection}
        onUnarchive={(id) => void api.unarchiveBucket(id)}
        onDelete={(bucket) => setProjectDialog({ kind: "delete", bucket, open: true })}
      />
    ) : mode === "execute" ? (
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
        onAddStatus={
          // One project's board only (REPLAN 53a): never All, My tasks, the
          // Queue or the Inbox (which uses the workspace default set).
          canEdit && buckets.some((b) => b.id === selection)
            ? () => setStatusesEditor({ projectId: selection, addingTo: "in_progress" })
            : undefined
        }
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
      {archivedProject && mode === "plan" ? (
        <ArchivedProjectBanner
          project={archivedProject}
          canEdit={canEdit}
          onUnarchive={() => void api.unarchiveBucket(archivedProject.id)}
        />
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
    // A sidebar project being dragged sorts only among the project rows (TV-U6).
    if (asRailProject(args.active.data.current)) return railSortCollision(args);
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
        return STATUS_KEY_LABELS[id.slice("col:status:".length) as StatusKey] ?? null;
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

  // The "← item" stack (SH-1) for references opened from the panel (RF-1). A
  // new selection is a new context, so the stack starts over.
  const panelStack = usePanelStack<{ key: string; type: string; id: string }>();
  const { push: pushPanel, clear: clearPanel } = panelStack;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection is the cue
  useEffect(() => {
    clearPanel();
  }, [selectedTaskId, clearPanel]);
  const latestForHost = useRef({ taskById, selectedTask, inbox, api });
  useLayoutEffect(() => {
    latestForHost.current = { taskById, selectedTask, inbox, api };
  });
  // What references on this page can do: open in the panel, complete a task
  // through the module (so the live gate and Undo see it), and create a task
  // for `/` in a description ("New task “…”", filed with the open task).
  const referenceHost = useMemo<ReferenceHost>(
    () => ({
      openInPanel: (ref: ReferenceRef) =>
        pushPanel({ key: referenceKey(ref), type: ref.type, id: ref.id }),
      setTaskDone: (taskId: string, done: boolean) => {
        const { taskById: byId, api: moduleApi } = latestForHost.current;
        if (byId.has(taskId)) {
          moduleApi.patchTask(taskId, { status: done ? "done" : "todo" });
          return;
        }
        referenceStore?.completeTask(taskId, done).catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Couldn’t change the task.");
        });
      },
      createEntity: async (type: string, title: string) => {
        if (type !== "task") return null;
        const { selectedTask: open, inbox: myInbox, api: moduleApi } = latestForHost.current;
        const bucketId = open?.bucketId ?? myInbox?.id;
        if (!bucketId) return null;
        const saved = await moduleApi.createTask({ bucketId, title });
        return saved ? { type: "task", id: saved.id } : null;
      },
      canEditTasks: canEdit,
    }),
    [pushPanel, referenceStore, canEdit],
  );

  const detailPanel = (
    <TaskDetailPanel
      task={selectedTask}
      buckets={selectedArchivedTask ? [...buckets, ...api.archivedBuckets] : buckets}
      inbox={inbox}
      canEdit={panelCanEdit}
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
    <HubDropZone target={{ type: "task", id: selectedTask.id }} disabled={!panelCanEdit}>
      {detailPanel}
    </HubDropZone>
  ) : (
    detailPanel
  );
  // References opened from the panel stack on top of Details as "← item"
  // (RF-1, SH-1's stack): a task shows its own detail, anything else its card
  // with "Open in …"; the title is what this reader may see ("Private item").
  const stackRefs = useMemo(
    () => panelStack.stack.map((entry) => ({ type: entry.type, id: entry.id })),
    [panelStack.stack],
  );
  const stackState = useReferences(stackRefs);
  const panelItems: PanelItem[] = panelStack.stack.map((entry) => {
    const ref: ReferenceRef = { type: entry.type, id: entry.id };
    const state = stackState(ref);
    const task = referenceKind(entry.type) === "task" ? taskById.get(entry.id) : undefined;
    if (task) {
      return {
        key: entry.key,
        title: task.title || "Untitled task",
        icon: CircleCheck,
        render: () => (
          <TaskDetailPanel
            task={task}
            buckets={buckets}
            inbox={inbox}
            canEdit={canEdit}
            onRequestCapture={openCapture}
            onSelectTask={(id) => pushPanel({ key: `task:${id}`, type: "task", id })}
            api={viewApi}
            runtime={runtime}
            workspaceId={workspaceId}
            onOpenEntity={handleOpenEntity}
          />
        ),
        open: { label: "Open in Tasks", onOpen: () => onUrlTaskIdChange(task.id) },
      };
    }
    return {
      key: entry.key,
      title: referencePanelTitle(ref, state),
      render: () => <ReferencePanelBody reference={ref} />,
      open: referencePanelOpen(ref, state),
    };
  });

  // The right panel's title row names and switches its views (SH-1): Details
  // today; Project, In flight and No date register in panel-views.ts later.
  const right = (
    <RightPanel
      module="tasks"
      views={{ details: () => details }}
      activeId={panelView}
      onChange={setPanelView}
      items={panelItems}
      onBack={panelStack.back}
      onClearItems={panelStack.clear}
    />
  );

  return (
    <ReferenceHostProvider host={referenceHost}>
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
      <StatusesDialog
        open={statusesEditor !== null}
        projectName={statusesEditor?.projectId ? bucketNameById(statusesEditor.projectId) : null}
        statuses={api.statuses.filter((s) => s.projectId === (statusesEditor?.projectId ?? null))}
        canEdit={canEdit}
        addingTo={statusesEditor?.addingTo ?? null}
        onCreate={(category, name) =>
          api.createStatus(statusesEditor?.projectId ?? null, category, name)
        }
        onUpdate={api.updateStatus}
        onDelete={api.deleteStatus}
        onClose={() => setStatusesEditor(null)}
      />
      <DeleteBucketDialog
        bucket={projectDialog?.kind === "delete" ? projectDialog.bucket : null}
        open={projectDialog?.kind === "delete" && projectDialog.open}
        summary={
          projectDialog
            ? projectDeleteSummary(
                [...api.tasks, ...api.archivedTasks],
                projectDialog.bucket.id,
                api.currentUserId,
              )
            : { moving: 0, toYou: 0, finished: 0 }
        }
        checkAccess={checkProjectAccess}
        onConfirm={(bucket) => {
          // Pinned shows live projects only: a deleted one leaves it, a
          // refused delete or a Restore keeps (or brings back) its pin.
          api.deleteBucket(bucket.id);
          if (selection === bucket.id) setSelection("inbox");
        }}
        onClose={() => setProjectDialog((prev) => (prev ? { ...prev, open: false } : prev))}
        onCloseAutoFocus={(event) =>
          restoreNavFocus(event, railNavRef.current, projectDialog?.bucket.id ?? null)
        }
      />
      <ArchiveProjectDialog
        bucket={projectDialog?.kind === "archive" ? projectDialog.bucket : null}
        open={projectDialog?.kind === "archive" && projectDialog.open}
        openCount={
          projectDialog ? projectOpenWork(api.tasks, projectDialog.bucket.id).open.length : 0
        }
        projects={buckets}
        checkAccess={checkProjectAccess}
        onConfirm={(bucket, openTasks) => {
          api.archiveBucket(bucket.id, openTasks);
          if (selection === bucket.id) setSelection("inbox");
        }}
        onClose={() => setProjectDialog((prev) => (prev ? { ...prev, open: false } : prev))}
        onCloseAutoFocus={(event) =>
          restoreNavFocus(event, railNavRef.current, projectDialog?.bucket.id ?? null)
        }
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
    </ReferenceHostProvider>
  );
}
