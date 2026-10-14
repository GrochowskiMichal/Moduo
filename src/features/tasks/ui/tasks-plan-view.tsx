import {
  isBacklogTask,
  isClosedTask,
  isOpenTask,
  type ProjectState,
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
import { TeamMark } from "../../../components/ui/avatar";
import { Button } from "../../../components/ui/button";
import { EmptyState } from "../../../components/ui/empty-state";
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
  currentPreferences,
  type TasksSidebarHideable,
  updatePreferences,
  usePreferencesValue,
} from "../../../lib/preferences";
import type { ModuoRuntime } from "../../../lib/runtime.types";
import { useWorkspaceStore } from "../../../lib/sync/react";
import { UNDO_TOAST_MS, undoToast } from "../../../lib/undo-toast";
import { readViewPrefs, writeViewPrefs } from "../../../lib/view-prefs";
import { HubDropZone } from "../../contacts/ui/hub-drop-zone";
import { consumeFocusViewRequest, FOCUS_VIEW_REQUEST_EVENT } from "../../focus/view-request";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../layout/panel-events";
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
import { tasksWord } from "../bulk";
import { myTasksScope, openCount, resolveDefaultSelection } from "../default-view";
import {
  nextHeaderSort,
  orderTasks,
  sanitizeTasksView,
  type TaskLayout,
  tasksDisplayDefaults,
  tasksDisplayKey,
  tasksViewDefaults,
} from "../display";
import type { TaskDropWrite } from "../dnd/drop-write";
import { multiDropWrites } from "../dnd/multi-drop";
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
import { type CaptureSeed, showsArchived, statusesLetThrough } from "../filters";
import type { InFlightItem } from "../focus-screen";
import { boardFoldKey, listFoldKey } from "../folds";
import { todayStr } from "../helpers";
import type { TasksModuleApi } from "../hooks/use-tasks-module";
import { useTaskImport } from "../importers/ui/use-task-import";
import type { ListExportContext } from "../list-export";
import type { GroupAdd } from "../list-group-add";
import { type Bucket, isDrifted, PRIVATE_PROJECT_LABEL, type Task } from "../model";
import {
  allProjectOrder,
  allView,
  myTasksView,
  orderMyTasks,
  startsFolded,
  TEAM_BLOCK_ROWS,
  teamBlocks,
} from "../my-tasks";
import { defaultRowsFor, firstViewFor, timelineRoleFor } from "../onboarding";
import { showsSortedNote, sortedByLabel } from "../order";
import { IN_FLIGHT_PANEL_VIEW, NO_DATE_PANEL_VIEW } from "../panel-views";
import { handleLabel } from "../row-layout";
import { resolveTasksDeepLink, taskIdForHandle } from "../search";
import { inViewOrder } from "../selection";
import { projectDeleteSummary, projectOpenWork } from "../sidebar";
import { useTemplateActions } from "../templates/ui/use-template-actions";
import { undatedTasks } from "../timeline-rows";
import { dayNumOfKey } from "../timeline-scale";
import { viewIdOf, viewPlace, viewPrefsOf, viewSelection } from "../views";
import { ArchivedProjectBanner, ArchivedProjectsView } from "./archived-projects-view";
import {
  ARCHIVED_SELECTION,
  asRailProject,
  BucketRail,
  parseCollapsedSections,
  TEMPLATES_SELECTION,
  TRASH_SELECTION,
  UPCOMING_SELECTION,
  WONTDO_SELECTION,
} from "./bucket-rail";
import { BulkPanel } from "./bulk-panel";
import { ArchiveProjectDialog, DeleteBucketDialog } from "./delete-bucket-dialog";
import { asTaskDrag, taskDragAnnouncements, useTaskDndSensors } from "./dnd/task-dnd";
import { DriftTriageDialog } from "./drift-triage-dialog";
import { checkBackAt } from "./focus-hand-off";
import { FocusView } from "./focus-view";
import { FrontierOfferDialog } from "./frontier-offer-dialog";
import { InFlightPanel } from "./in-flight-panel";
import { useInboxView } from "./inbox-view";
import type { ListExtraGroup } from "./list-extensions";
import { type PlanHeaderControls, type PlanView, SortedOrderLine } from "./plan-view-header";
import { ProjectPanel } from "./project-panel";
import { RecentlyDeletedView } from "./recently-deleted-view";
import { StatusesDialog } from "./statuses-dialog";
import { TaskBoardView } from "./task-board-view";
import { TASK_DETAIL_REFRESH_EVENT, TaskDetailPanel, TaskGonePanel } from "./task-detail-panel";
import { TaskFullPage } from "./task-full-page";
import { TaskListView } from "./task-list-view";
import { TaskTimelineView } from "./task-timeline-view";
import { TaskListSkeleton } from "./task-view-states";
import { TasksWelcomeDialog } from "./tasks-welcome-dialog";
import { TimelineNoDatePanel } from "./timeline-no-date-panel";
import { useUpcomingView } from "./upcoming-view";
import { boardDropName } from "./use-board-folds";
import { useBulkActions } from "./use-bulk-actions";
import { useInFlight } from "./use-in-flight";
import {
  useEditableProjects,
  useEditableTasks,
  useProjectEditable,
} from "./use-project-overview-data";
import { useSavedViews } from "./use-saved-views";
import { useTaskSelection } from "./use-task-selection";
import { useTasksDisplay } from "./use-tasks-display";
import { useTasksFilters } from "./use-tasks-filters";
import { useTasksWelcome } from "./use-tasks-welcome";
import { TIMELINE_DROP_ID } from "./use-timeline-drop";
import { AllEmpty, MyTasksEmpty, UpcomingEmpty, WontDoEmpty } from "./view-empty-states";
import { ViewExportMenu } from "./view-export-menu";

type Props = {
  api: TasksModuleApi;
  workspaceId: string;
  /** Spine runtime — powers the task detail panel's linked-entity hub (DF-8). */
  runtime: ModuoRuntime | null;
  /** URL-held task selection (?id=, DF-1) — the page owns the router coupling. */
  urlTaskId: string | null;
  onUrlTaskIdChange: (id: string | null) => void;
  /** `?view=<id>` (TV-U8): a saved view's link, opened once, then taken off the URL. */
  urlViewId?: string | null;
  onUrlViewConsumed?: () => void;
};

// The selection→URL mirror writes only at rest (see the mirror effect).
const URL_MIRROR_DEBOUNCE_MS = 250;

const EMPTY_IDS: readonly string[] = [];
const NO_OP = () => {};
const NO_EXTRAS: readonly ListExtraGroup[] = [];

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
function removeLS(workspaceId: string, part: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(lsKey(workspaceId, part));
  } catch {
    /* ignore */
  }
}

export function TasksPlanView({
  api,
  workspaceId,
  runtime,
  urlTaskId,
  onUrlTaskIdChange,
  urlViewId = null,
  onUrlViewConsumed,
}: Props) {
  const { canEdit, buckets, inbox, tasks } = api;

  // The workspace-wide view from before layouts were per scope: a scope
  // that doesn't remember a layout yet starts with it.
  const [legacyLayout] = useState<TaskLayout>(() => {
    const stored = readLS(workspaceId, "view");
    return stored === "board" || stored === "timeline" ? stored : "list";
  });
  // Provisional selection (last-opened place); the default is resolved once the
  // bundle has loaded (see effect below). A device left in the retired "Plan ·
  // Focus" switch's Focus mode opens Focus, which is now the sidebar's (TV-F7).
  const [selection, setSelection] = useState<string>(() =>
    readLS(workspaceId, "mode") === "execute"
      ? "today"
      : (readLS(workspaceId, "lastBucket") ?? "inbox"),
  );
  useEffect(() => {
    removeLS(workspaceId, "mode");
    // The Timeline's zoom is per scope in Display since TV-TL1.
    removeLS(workspaceId, "timelineZoom");
  }, [workspaceId]);
  // Which right-panel view is showing (views: features/tasks/panel-views.ts).
  const [panelView, setPanelView] = useState("details");
  // The task that fills the centre (call 32), or null for the view.
  const [fullPageId, setFullPageId] = useState<string | null>(null);
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
  const preferences = usePreferencesValue();
  const sidebarPrefs = preferences.tasksSidebar;
  // The role question's answer (TV-U17): where Tasks first opens, the rows.
  const onboardingRole = preferences.tasksOnboarding.role;
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
  // A project's id, or a saved view's `view:<id>` (TV-U8).
  const togglePin = useCallback(
    (pinId: string) => {
      const mine = sidebarPrefs.pinned[workspaceId] ?? [];
      const next = mine.includes(pinId) ? mine.filter((id) => id !== pinId) : [...mine, pinId];
      updatePreferences({
        tasksSidebar: { ...sidebarPrefs, pinned: { ...sidebarPrefs.pinned, [workspaceId]: next } },
      });
    },
    [sidebarPrefs, workspaceId],
  );
  // A project's Delete…, Archive… and Done confirms (REPLAN 78), from the
  // sidebar, Archived projects or the overview (TV-U16). The project is kept
  // while the dialog closes.
  const [projectDialog, setProjectDialog] = useState<{
    kind: "delete" | "archive" | "done";
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
  // Several selected (TV-U12): a set beside the cursor (selection.ts); the
  // views pass their order with each gesture.
  const multiSelect = useTaskSelection(selectedTaskId, setSelectedTaskId);
  // The order the List or the Board shows now (they write it as they draw):
  // the Inbox's cursor after a triage, and a selection's order.
  const viewOrderRef = useRef<readonly string[]>([]);
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

  // Persist preferences (the Timeline's zoom is per scope now, in Display: TV-TL1).
  useEffect(
    () => writeLS(workspaceId, collapseKey, JSON.stringify([...collapsedGroups])),
    [workspaceId, collapseKey, collapsedGroups],
  );

  // Remember where you were, so the next open lands back on it (REPLAN 30);
  // Archived projects and Recently deleted aren't places to reopen.
  useEffect(() => {
    if (
      selection === ARCHIVED_SELECTION ||
      selection === TRASH_SELECTION ||
      selection === WONTDO_SELECTION ||
      selection === TEMPLATES_SELECTION
    )
      return;
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

  // The top-bar timer's "open Focus" (and a "Focus on this" toast's Open)
  // opens the sidebar's Focus (TV-F7; it was the Plan · Focus switch). The
  // one-shot flag covers a fresh mount (clicked from another route, the event
  // fired before this listener existed); the event covers a /tasks already
  // open. Both consume the flag, so a stale one can't force Focus on a later,
  // unrelated visit.
  const openFocus = useCallback(() => {
    setFullPageId(null);
    pickSelection("today");
  }, [pickSelection]);
  useEffect(() => {
    if (consumeFocusViewRequest()) openFocus();
    const onRequest = () => {
      consumeFocusViewRequest();
      openFocus();
    };
    window.addEventListener(FOCUS_VIEW_REQUEST_EVENT, onRequest);
    return () => window.removeEventListener(FOCUS_VIEW_REQUEST_EVENT, onRequest);
  }, [openFocus]);

  // Tasks' welcome and the role question (TV-U17). A role's first view can
  // be a project's Board: that project's Display remembers Board, then it
  // opens.
  const workspaceRole = useContext(WorkspaceContext)?.selectedWorkspace?.role ?? null;
  const isWorkspaceOwner = workspaceRole === "owner";
  const openFirstView = useCallback(
    ({ selection: place, board }: { selection: string; board: boolean }) => {
      if (board) {
        const key = tasksDisplayKey(workspaceId, place);
        const defaults = tasksViewDefaults(
          place,
          legacyLayout,
          defaultRowsFor(currentPreferences().tasksOnboarding.role),
        );
        const prefs = readViewPrefs(key, defaults, (raw, d) => sanitizeTasksView(raw, d, place));
        writeViewPrefs(key, { ...prefs, layout: "board" });
      }
      setFullPageId(null);
      pickSelection(place);
    },
    [workspaceId, legacyLayout, pickSelection],
  );
  const welcome = useTasksWelcome({
    api,
    runtime,
    workspaceId,
    isOwner: isWorkspaceOwner,
    onFirstView: openFirstView,
  });
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
    // Saved views reopen too (TV-U8): their selections count as places.
    const bucketIds = [
      inboxId,
      ...buckets.map((b) => b.id),
      ...(api.views ?? []).map((v) => viewSelection(v.id)),
    ].filter(Boolean) as string[];
    setSelection(
      resolveDefaultSelection({
        lastBucket: readLS(workspaceId, "lastBucket"),
        bucketIds,
        inboxId,
        // A first open follows onboarding (TV-U17): the role's first view.
        firstOpen: onboardingRole
          ? firstViewFor(
              onboardingRole,
              buckets.map((b) => b.id),
            ).selection
          : null,
      }),
    );
  }, [api.loading, workspaceId, inboxId, buckets, api.views, inboundPending, onboardingRole]);

  // My tasks is always in the sidebar (tasks-v3 §3; TV-U15 retires
  // tasks-v2's "two or more members" rule): its status groups answer "what am
  // I on" even alone.
  const { assignees, currentUserId } = useAssignees();
  // Owners and admins edit the workspace's default statuses (TV-D9). Read
  // without useWorkspace so the page renders where no provider is mounted.
  const canManageWorkspace = useContext(WorkspaceContext)?.canManageWorkspace ?? false;

  // A saved view (TV-U8) is the selection `view:<id>`: it shows its place
  // (All, My tasks, Upcoming or its project) through its own Filter and
  // Display. Everything about the centre reads `place`; the sidebar's
  // highlight, the URL and remembering where you were read `selection`.
  const openViewId = viewIdOf(selection);
  const views = api.views;
  const openView = useMemo(
    () => (openViewId ? (views?.find((v) => v.id === openViewId) ?? null) : null),
    [openViewId, views],
  );
  const place = openView ? viewPlace(openView) : selection;

  // Keep selection valid; "inbox" resolves against the seeded Inbox bucket.
  // A view waits for the server before it counts as gone.
  useEffect(() => {
    if (openViewId) {
      if (!openView && api.reachedServer) setSelection("inbox");
      return;
    }
    if (
      selection === "all" ||
      selection === "inbox" ||
      selection === "today" ||
      selection === UPCOMING_SELECTION ||
      selection === WONTDO_SELECTION ||
      selection === "mine" ||
      selection === ARCHIVED_SELECTION ||
      selection === TRASH_SELECTION ||
      selection === TEMPLATES_SELECTION
    )
      return;
    if (inboxId && selection === inboxId) return;
    // An archived project opens read-only from Archived projects (TV-U6).
    if (api.archivedBuckets.some((b) => b.id === selection)) return;
    if (!buckets.some((b) => b.id === selection)) setSelection("inbox");
  }, [selection, buckets, inboxId, api.archivedBuckets, openViewId, openView, api.reachedServer]);
  /** The archived project open now (read-only), if any. */
  const archivedProject = useMemo(
    () => api.archivedBuckets.find((b) => b.id === place) ?? null,
    [api.archivedBuckets, place],
  );

  // A task can sit in a project you can't see (it was assigned to you): that
  // project reads "Private project", never "Inbox" (TV-P0, AC1.10).
  // An archived project's tasks show only when you open it or search, and
  // its name says so (REPLAN 78: search finds them, labelled "Archived").
  // A task you made that sits in someone else's Inbox (TV-D13, 20a: you keep
  // it while it's there, the Inbox itself stays theirs) reads "Mike's Inbox":
  // a task you can see in a project you can't, made by you and assigned to
  // someone else, can only be that.
  const handedInboxes = useMemo(() => {
    const known = new Set([
      ...(inbox ? [inbox.id] : []),
      ...buckets.map((b) => b.id),
      ...api.archivedBuckets.map((b) => b.id),
    ]);
    const out = new Map<string, string>();
    for (const t of tasks) {
      if (known.has(t.bucketId) || out.has(t.bucketId)) continue;
      if (!currentUserId || t.creatorId !== currentUserId) continue;
      if (!t.assigneeId || t.assigneeId === currentUserId) continue;
      const person = assignees.find((a) => a.userId === t.assigneeId);
      const name = (person?.fullName || person?.name || "").trim().split(/\s+/)[0];
      if (name) out.set(t.bucketId, `${name}’s Inbox`);
    }
    return out;
  }, [tasks, buckets, inbox, api.archivedBuckets, currentUserId, assignees]);
  const bucketNameById = useCallback(
    (id: string) => {
      if (inbox && id === inbox.id) return "Inbox";
      const live = buckets.find((b) => b.id === id);
      if (live) return live.name;
      const archived = api.archivedBuckets.find((b) => b.id === id);
      if (archived) return `${archived.name} · Archived`;
      return handedInboxes.get(id) ?? PRIVATE_PROJECT_LABEL;
    },
    [buckets, inbox, api.archivedBuckets, handedInboxes],
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
  const groupChoices = useMemo(
    () => ({ teams: api.teams.length > 0, areas: api.areas.length > 0 }),
    [api.teams.length, api.areas.length],
  );
  // The Inbox opened by its id is still the Inbox: its Display (no Section
  // grouping, its own saved choices) is the Inbox's.
  const displayScope = inboxId && place === inboxId ? "inbox" : place;
  const viewRows = defaultRowsFor(onboardingRole);
  const savedView = useMemo(
    () => (openView ? { id: openView.id, prefs: viewPrefsOf(openView, viewRows) } : null),
    [openView, viewRows],
  );
  const tasksDisplay = useTasksDisplay(
    workspaceId,
    displayScope,
    tasks,
    linkedTaskId,
    legacyLayout,
    groupChoices,
    // A view that remembers no Display starts on the role's rows (TV-U17).
    viewRows,
    // …and the Timeline on the role's Due per week (TV-TL1).
    timelineRoleFor(onboardingRole),
    savedView,
  );
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

  // The views built on the List (TV-U15): Upcoming's days, the Inbox's
  // triage, My tasks' team block. Each hands the List what differs.
  const isInboxScope = place === "inbox" || (inboxId !== null && place === inboxId);
  const projectIds = useMemo(() => buckets.map((b) => b.id), [buckets]);
  const upcoming = useUpcomingView({ api, canEdit, inboxId, projectIds });
  // The Inbox's rows as the List shows them (set below, once filtered): the
  // cursor after a triage moves to the next of these.
  const inboxRowsRef = useRef<readonly Task[]>([]);
  const inboxView = useInboxView({
    api,
    runtime,
    workspaceId,
    // A selection owns the bar and the keys while it lasts (TV-U12).
    enabled: isInboxScope && !multiSelect.multi,
    canEdit,
    selectedTaskId,
    onSelectTask: setSelectedTaskId,
    visibleRows: inboxRowsRef,
  });
  // My tasks' team block (54): your teams' tasks nobody has taken yet.
  const blocks = useMemo(
    () => teamBlocks(tasks, api.teams, api.teamMembers, currentUserId),
    [tasks, api.teams, api.teamMembers, currentUserId],
  );
  const waitingIds = useMemo(
    () => new Set((api.waiting ?? []).map((w) => w.taskId)),
    [api.waiting],
  );
  const myOrder = tasksDisplay.display.order;
  // The block's groups change only when what they show does: an edit to any
  // other task makes `blocks` anew, and a new group array re-measures the
  // whole List.
  const blocksKey = blocks
    .map(
      (b) =>
        `${b.team.id}:${b.team.name}:${b.team.mark}:${b.team.color}:${b.tasks.map((t) => t.id).join(",")}`,
    )
    .join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names what the ids depend on.
  const takeableIds = useMemo(
    () => new Set(blocks.flatMap((b) => b.tasks.map((t) => t.id))),
    [blocksKey],
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key names what the groups show.
  const mineExtraGroups = useMemo<readonly ListExtraGroup[]>(
    () =>
      blocks.map((b) => ({
        key: `team:${b.team.id}`,
        place: "lead" as const,
        label: `For ${b.team.name}`,
        leading: (
          <TeamMark name={b.team.name} id={b.team.id} letters={b.team.mark} color={b.team.color} />
        ),
        sub: `· ${b.tasks.length} unclaimed`,
        count: null,
        taskIds: b.tasks.map((t) => t.id),
        limit: TEAM_BLOCK_ROWS,
        add: canEdit
          ? { kind: "add" as const, add: { seed: { teamId: b.team.id } } }
          : { kind: "none" as const },
      })),
    [blocksKey, canEdit],
  );
  // Take it (54): TV-D13's claim op makes the task yours and keeps its team
  // (it refuses one somebody took first), with Undo while it's still yours.
  const takeRef = useRef({ api, currentUserId });
  useLayoutEffect(() => {
    takeRef.current = { api, currentUserId };
  });
  const takeTask = useCallback((id: string) => {
    const { api: moduleApi, currentUserId: me } = takeRef.current;
    if (!me) return;
    // The toast once the server took it (a refused claim says so instead).
    moduleApi.claimTask(id, () =>
      undoToast("Taken · it’s yours", {
        onUndo: () => {
          // Never over a newer change: only while it's still yours.
          const now = takeRef.current.api.tasks.find((t) => t.id === id);
          if (now?.assigneeId === me) takeRef.current.api.patchTask(id, { assigneeId: null });
        },
      }),
    );
  }, []);
  // All (research §8): projects in the sidebar's order, area by area; a
  // project's header names its area and an On hold or Done state, and those
  // start folded (never hidden, 16).
  const allBuckets = useMemo(() => {
    const order = allProjectOrder(
      buckets,
      api.areas.map((a) => a.id),
    );
    const byId = new Map(buckets.map((b) => [b.id, b]));
    return order.flatMap((id) => {
      const b = byId.get(id);
      return b ? [b] : [];
    });
  }, [buckets, api.areas]);
  const allFolded = useCallback(
    (key: string) => startsFolded(buckets.find((b) => b.id === key)),
    [buckets],
  );
  const allGroupSub = useCallback(
    (key: string) => {
      const bucket = buckets.find((b) => b.id === key);
      if (!bucket) return undefined;
      const area = bucket.areaId ? api.areas.find((a) => a.id === bucket.areaId)?.name : null;
      const state =
        bucket.status === "on_hold" ? "On hold" : bucket.status === "done" ? "Done" : null;
      const parts = [area, state].filter((p): p is string => !!p);
      return parts.length > 0 ? `· ${parts.join(" · ")}` : undefined;
    },
    [buckets, api.areas],
  );

  const scopeTasksAll = useMemo(() => {
    if (place === "today") return api.queuedTasks;
    if (place === ARCHIVED_SELECTION || place === TRASH_SELECTION || place === TEMPLATES_SELECTION)
      return [];
    const live = (t: Task) => t.status !== "archived" || withArchived || t.id === keptArchivedId;
    // All: every task in projects you can see, never your Inbox (20).
    if (place === "all") return allView(tasks, inboxId, live);
    // Won't do, reachable, each with Reopen (§2).
    if (place === WONTDO_SELECTION) return tasks.filter((t) => t.status === "archived");
    if (place === UPCOMING_SELECTION) {
      // One just marked Won't do here stays until the scope changes (TV-U1).
      const kept = keptArchivedId ? tasks.find((t) => t.id === keptArchivedId) : undefined;
      return kept && !upcoming.scope.includes(kept) ? [...upcoming.scope, kept] : upcoming.scope;
    }
    if (archivedProject) {
      return api.archivedTasks.filter((t) => t.bucketId === archivedProject.id && live(t));
    }
    if (place === "mine") {
      // Yours, Backlog in (the List folds it behind its line), in its own
      // order: date, then priority, waiting at the end (call 84). The team
      // block's tasks lead (they're in no status group).
      const mine = myTasksView(
        tasks,
        currentUserId,
        (t) => withArchived || t.id === keptArchivedId,
      );
      const ordered = myOrder === "manual" ? orderMyTasks(mine, waitingIds) : mine;
      return [...blocks.flatMap((b) => b.tasks), ...ordered];
    }
    const bucketId = isInboxScope ? inboxId : place;
    if (!bucketId) return [];
    const inProject = tasks.filter((t) => t.bucketId === bucketId && live(t));
    return isInboxScope ? inboxView.scope(inProject) : inProject;
  }, [
    place,
    tasks,
    inboxId,
    isInboxScope,
    api.queuedTasks,
    currentUserId,
    keptArchivedId,
    withArchived,
    archivedProject,
    api.archivedTasks,
    upcoming.scope,
    inboxView.scope,
    blocks,
    waitingIds,
    myOrder,
  ]);
  // Search in All also finds archived projects' tasks, labelled (REPLAN 78).
  const archivedSearchTasks = useMemo(
    () => (place === "all" ? api.archivedTasks.filter((t) => t.status !== "archived") : []),
    [place, api.archivedTasks],
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
    // Focus has no toolbar: no Filter, no search (TV-F7).
    enabled: place !== "today",
    // A deep-linked task, or the selected one just marked Won't do, stays
    // listed past this scope's filters and search while it's selected; a link
    // never clears saved filters (TV-U2).
    keepTaskId: linkedTaskId ?? keptArchivedId,
    searchExtra: archivedSearchTasks,
  });
  const scopeTasks = filtering.tasks;
  useLayoutEffect(() => {
    if (!isInboxScope) {
      inboxRowsRef.current = [];
      return;
    }
    // The rows as the List shows them (grouped or not, TV-U12); before it has
    // drawn, the flat order.
    const byId = new Map(scopeTasks.map((t) => [t.id, t]));
    const shown = view === "list" ? viewOrderRef.current.flatMap((id) => byId.get(id) ?? []) : [];
    inboxRowsRef.current =
      shown.length > 0
        ? shown
        : orderTasks(scopeTasks, tasksDisplay.display.order, tasksDisplay.display.orderDir);
  });
  // A selection lasts within one place and one layout; tasks that leave the
  // scope leave it (a set of ids: rows scrolled away stay in it).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new place or layout is the cue
  useEffect(() => {
    multiSelect.clear();
  }, [selection, view, workspaceId]);
  useEffect(() => {
    if (multiSelect.multi && selectedTaskId && !multiSelect.ids.has(selectedTaskId)) {
      multiSelect.clear();
    }
  }, [selectedTaskId, multiSelect]);
  const scopeIdSet = useMemo(() => new Set(scopeTasks.map((t) => t.id)), [scopeTasks]);
  useEffect(() => {
    multiSelect.prune((id) => scopeIdSet.has(id), viewOrderRef.current);
  }, [scopeIdSet, multiSelect.prune]);
  const bulkIds = useMemo(
    () =>
      multiSelect.multi
        ? inViewOrder(
            multiSelect.ids,
            viewOrderRef.current.length > 0 ? viewOrderRef.current : scopeTasks.map((t) => t.id),
          )
        : EMPTY_IDS,
    [multiSelect.multi, multiSelect.ids, scopeTasks],
  );
  // The bottom bar's row, its keys and pickers while several are selected.
  const bulk = useBulkActions({
    api,
    ids: bulkIds,
    canEdit: canEdit && !archivedProject,
    bucketNameById,
  });
  // What New pre-fills: the filters you can see (none in Focus), and never
  // someone who can't take the task (a former member a stored filter still
  // names: the server would refuse the save).
  const captureSeed = useMemo<CaptureSeed>(() => {
    if (place === "today") return { tagIds: [] };
    const seed = filtering.seed;
    const id = seed.assigneeId;
    if (id && !assignees.some((a) => a.userId === id && a.canTakeTasks)) {
      const { assigneeId: _dropped, ...rest } = seed;
      return rest;
    }
    return seed;
  }, [place, filtering.seed, assignees]);

  // The place's own name; an open view shows its name instead.
  const placeTitle =
    place === TEMPLATES_SELECTION
      ? "Templates"
      : place === "all"
        ? "All"
        : place === "mine"
          ? "My tasks"
          : place === "today"
            ? "Focus"
            : place === UPCOMING_SELECTION
              ? "Upcoming"
              : place === WONTDO_SELECTION
                ? "Won’t do"
                : place === "inbox"
                  ? "Inbox"
                  : archivedProject
                    ? archivedProject.name
                    : bucketNameById(place);
  const scopeTitle = openView ? openView.name : openViewId ? "" : placeTitle;

  // Saved views (TV-U8): the sidebar's Views, Save as view…, Save changes,
  // `?view=` links and onboarding's seeded views.
  const savedViews = useSavedViews({
    api,
    workspaceId,
    userId: currentUserId,
    place,
    openView,
    prefs: tasksDisplay.prefs,
    dirty: tasksDisplay.dirty,
    revert: tasksDisplay.revert,
    placeTitle,
    projectIds,
    onOpen: pickSelection,
    urlViewId,
    onUrlViewConsumed: onUrlViewConsumed ?? NO_OP,
    canShare: canEdit,
    canModerate: workspaceRole === "owner" || workspaceRole === "admin",
  });

  // ⌘N, "+ New" and `c` capture "here" (tasks-v3 call 90, TV-U14): in a
  // project, that project; with a task of a section selected there, that
  // section (TV-U10's group "+" passes its own); in Focus or the Queue, the
  // top of Up next. Anywhere else, the capture's own default: your Inbox.
  const captureHere = useMemo(() => {
    // An archived project's page, Upcoming, Archived and Recently deleted
    // aren't places to file into: the capture's own default (your Inbox).
    const project = archivedProject
      ? null
      : (buckets.find((b) => b.id === place && !b.isSystem) ?? null);
    return {
      projectId: project?.id ?? null,
      queueTop: place === "today",
    };
  }, [buckets, place, archivedProject]);

  // All's count is what All lists: never your Inbox (TV-U15).
  const totalOpenCount = useMemo(
    () => tasks.filter((t) => isOpenTask(t) && t.bucketId !== inboxId).length,
    [tasks, inboxId],
  );
  const myOpenCount = useMemo(
    () => openCount(myTasksScope(tasks, currentUserId)),
    [tasks, currentUserId],
  );
  const wontDoCount = useMemo(() => tasks.filter((t) => t.status === "archived").length, [tasks]);

  // Drifted tasks for the bucket currently being triaged (recomputed live so the
  // dialog empties as the user triages).
  const driftTasks = useMemo(() => {
    if (!triageBucketId) return [];
    const now = new Date();
    return tasks.filter((t) => t.bucketId === triageBucketId && isDrifted(t, now));
  }, [triageBucketId, tasks]);

  const openCapture = useCallback(
    (at?: GroupAdd) => {
      if (!canEdit) return;
      const { queueTop } = captureHere;
      // A List group's "+" (TV-U10) names its own project, section and value.
      const projectId = at?.projectId ?? captureHere.projectId;
      const open = selectedTaskId ? tasks.find((t) => t.id === selectedTaskId) : null;
      const sectionId =
        at?.sectionId !== undefined
          ? at.sectionId
          : projectId && open?.bucketId === projectId
            ? (open.sectionId ?? null)
            : null;
      dispatchOpenCapture({
        destination: projectId ? { projectId, sectionId } : undefined,
        queueTop,
        seed: {
          ...captureSeed,
          // Upcoming's New dates the task today, so it lands where you are
          // looking (TV-U15); a day's "+" names its own day.
          ...(place === UPCOMING_SELECTION && !at ? { dueDay: todayStr() } : {}),
          ...at?.seed,
        },
      });
    },
    [canEdit, captureHere, selectedTaskId, tasks, captureSeed, place],
  );

  // cmd+n / global "+" → capture (this listener is only mounted on /tasks).
  useEffect(() => onCreateNew(() => openCapture()), [openCapture]);

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
  // "Focus on this" (⇧F, the menus, the panel's ▶; call 31) away from Focus
  // says where the session went, with a way there. In Focus the card shows it.
  const focusOnTask = useCallback(
    (id: string) => {
      const started = api.focusOnTask(id);
      if (started && selection !== "today") {
        const title = tasks.find((t) => t.id === id)?.title || "Untitled";
        toast(`Focusing on “${title}”`, {
          duration: UNDO_TOAST_MS,
          action: { label: "Open Focus", onClick: openFocus },
        });
      }
      return started;
    },
    [api, selection, tasks, openFocus],
  );
  // The views see the guarded toggle through an otherwise-unchanged api facade.
  const viewApi = useMemo<TasksModuleApi>(
    () => ({ ...api, toggleQueue: guardedToggleQueue, focusOnTask }),
    [api, guardedToggleQueue, focusOnTask],
  );

  const frontierOfferTask = useMemo(
    () => (frontierOfferTaskId ? (tasks.find((t) => t.id === frontierOfferTaskId) ?? null) : null),
    [frontierOfferTaskId, tasks],
  );
  const frontierOffer = useMemo(
    () => (frontierOfferTaskId ? api.frontierFor(frontierOfferTaskId) : []),
    [frontierOfferTaskId, api],
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
      // A row of a selection carries the selection (TV-U12): one write, one Undo.
      if (multiSelect.ids.size >= 2 && multiSelect.ids.has(task.id)) {
        if (action.kind === "queue") {
          // A drop only ever adds (the bar's Q is the toggle); blocked ones are
          // added and named, as "Queue anyway" would.
          api.bulkQueue(bulkIds, { mode: "add" });
          return;
        }
        const write: TaskDropWrite =
          action.kind === "move"
            ? { taskId: task.id, bucketId: action.bucketId }
            : { taskId: task.id, assigneeId: action.userId };
        const writes = multiDropWrites(write, task, bulkIds, api.tasks);
        if (writes.length === 0) return;
        void api.bulkWrite(writes, {
          label: (n) =>
            action.kind === "move"
              ? `Moved ${tasksWord(n)} to ${bucketNameById(action.bucketId)}`
              : `Assigned ${tasksWord(n)} to you`,
        });
        return;
      }
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
            undoToast("Added to Focus", {
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
    [canEdit, taskById, railCtx, api, bucketNameById, guardedToggleQueue, multiSelect.ids, bulkIds],
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
  // A project's state from its overview (TV-U16): Done with open work asks
  // first, like Archive (REPLAN 78); Active and On hold just save.
  const requestProjectState = useCallback(
    (bucket: Bucket, state: ProjectState) => {
      if (state === "done" && projectOpenWork(api.tasks, bucket.id).open.length > 0) {
        setProjectDialog({ kind: "done", bucket, open: true });
        return;
      }
      api.setProjectState(bucket.id, state);
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

  // Templates and "Duplicate project…" (TV-D15): the dialogs, the Templates
  // page, and what a copy settles into the shared store in one step.
  const templateStore = useWorkspaceStore(runtime, currentUserId, workspaceId);
  const templateActions = useTemplateActions({
    runtime,
    store: templateStore,
    workspaceId,
    userId: currentUserId,
    canEdit,
    isAdmin: canManageWorkspace,
    active: selection === TEMPLATES_SELECTION,
    buckets,
    areas: api.areas,
    sections: api.sections,
    tasks: api.tasks,
    onOpenProject: pickSelection,
    onOpenTask: (id) => onUrlTaskIdChange(id),
  });
  const offersTemplates = templateActions.supported && canEdit;
  // "Import tasks…" (TV-U18): the hairline ⋯ opens it.
  const taskImport = useTaskImport({
    runtime,
    store: templateStore,
    workspaceId,
    userId: currentUserId,
    canEdit,
    buckets,
    sections: api.sections,
    tasks,
    archivedTasks: api.archivedTasks,
    onOpenProject: pickSelection,
  });

  const left = (
    <BucketRail
      selection={selection}
      onSelect={pickSelection}
      buckets={buckets}
      areas={api.areas}
      inbox={inbox}
      openCountByBucket={api.openTaskCountByBucket}
      driftCountByBucket={api.driftCountByBucket}
      totalOpenCount={totalOpenCount}
      queueCount={api.queueCount}
      myTasksCount={myOpenCount}
      canEdit={canEdit}
      hidden={hiddenRows}
      onToggleHidden={toggleHiddenRow}
      pinned={pinnedIds}
      onTogglePin={togglePin}
      views={views}
      viewActions={savedViews.viewActions}
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
      wontDoCount={wontDoCount}
      templates={
        offersTemplates
          ? {
              onDuplicate: templateActions.requestDuplicate,
              onSaveAsTemplate: templateActions.requestSaveProject,
              onNewFromTemplate: templateActions.requestNewFromTemplate,
            }
          : undefined
      }
      onOpenWelcome={welcome.reopen}
      onImport={taskImport.supported ? taskImport.open : undefined}
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
    // Focus shows more than its line-up (the Now task's subtasks, today's
    // scheduled tasks), and its screen picks Now itself: a task stays selected
    // while it exists (TV-F7).
    if (place === "today") {
      if (selectedTaskId && !selectedTask) setSelectedTaskId(null);
      return;
    }
    // The Timeline's rows are projects and sections too (TV-TL1): nothing
    // selected is a place of its own there (a project row, Esc), never a
    // task picked for you that the canvas doesn't show.
    if (view === "timeline") {
      if (selectedTaskId && !scopeTasks.some((t) => t.id === selectedTaskId)) {
        setSelectedTaskId(null);
      }
      return;
    }
    if (selectedTaskId && scopeTasks.some((t) => t.id === selectedTaskId)) return;
    if (selectedTask?.parentId && scopeTasks.some((t) => t.id === selectedTask.parentId)) return;
    // Never a completed task Display hides (TV-U1): the Board has no
    // fallback of its own, so it would open the panel on a card it doesn't show.
    setSelectedTaskId(scopeTasks.find((t) => !isHiddenByDisplay(t))?.id ?? null);
  }, [
    api.loading,
    inboundPending,
    place,
    view,
    selectedTaskId,
    selectedTask,
    scopeTasks,
    isHiddenByDisplay,
  ]);

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
  // What a link can open: live tasks and projects, and archived ones (TV-U16).
  const linkable = useMemo(
    () => ({
      tasks: api.archivedTasks.length > 0 ? [...tasks, ...api.archivedTasks] : tasks,
      buckets: api.archivedBuckets.length > 0 ? [...buckets, ...api.archivedBuckets] : buckets,
      inboxId,
    }),
    [tasks, buckets, inboxId, api.archivedTasks, api.archivedBuckets],
  );
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
      resolveTasksDeepLink(urlTaskId, linkable).kind === "none"
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
    // An archived project's task opens too, in its project, read-only (search
    // finds it, labelled "Archived": REPLAN 78, TV-U16).
    const target = resolveTasksDeepLink(urlTaskId, linkable);
    if (target.kind === "none") {
      // A link someone followed (a notification, a chip) to a task you can't
      // open says so, never lands on another task (AC1.10). A stale id that
      // only comes back on refresh or back/forward clears quietly.
      if (external) setPrivateLinkId(urlTaskId);
      onUrlTaskIdChange(null);
      return;
    }
    setPrivateLinkId(null);
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
    linkable,
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
  // Getting the list out (TV-D14, default f): what the view shows, in its order.
  const exportContext: ListExportContext = {
    projectName: bucketNameById,
    assigneeName: (id) => {
      if (!id) return null;
      const person = assignees.find((a) => a.userId === id);
      return person ? person.fullName || person.name : null;
    },
    handleOf: (task) => handleLabel(taskKey, task.number),
  };
  const shownTasks = () =>
    orderTasks(
      scopeTasks.filter((t) => !isHiddenByDisplay(t)),
      display.order,
      display.orderDir,
    );
  // The view's extra groups (My tasks' team block, the Inbox's snoozed) are
  // around the view, not in its count (TV-U15).
  const viewExtraGroups: readonly ListExtraGroup[] =
    place === "mine" ? mineExtraGroups : isInboxScope ? inboxView.extraGroups : NO_EXTRAS;
  const extraTaskIds = new Set(viewExtraGroups.flatMap((g) => g.taskIds));
  const header: PlanHeaderControls = {
    // Won't do counts what it lists (none of it is open); a saved view, the
    // tasks it shows ("Done last week" counts its done ones).
    count:
      place === WONTDO_SELECTION
        ? scopeTasksAll.length
        : openView
          ? scopeTasks.filter((t) => !extraTaskIds.has(t.id) && !isHiddenByDisplay(t)).length
          : openCount(
              extraTaskIds.size === 0
                ? scopeTasksAll
                : scopeTasksAll.filter((t) => !extraTaskIds.has(t.id)),
            ),
    search: filtering.search,
    filter: filtering.filter,
    display: tasksDisplay.displayControl,
    more: (
      <ViewExportMenu
        tasks={shownTasks}
        title={scopeTitle}
        context={exportContext}
        saveAsView={savedViews.saveAsMenu}
      />
    ),
    activeFilters: filtering.activeFilters,
    viewChanges: savedViews.viewChanges,
    sortedNote:
      view !== "timeline" && order !== "manual" && showsSortedNote(place, order) ? (
        <SortedOrderLine label={sortedByLabel(order)} onManualOrder={backToManualOrder} />
      ) : null,
  };

  const sharedViewProps = {
    tasks: scopeTasks,
    multiSelect,
    orderRef: viewOrderRef,
    scopeTitle,
    // The views read the place: a saved view of a project is that project.
    selection: place,
    view,
    onViewChange: setView,
    buckets: place === "all" ? allBuckets : buckets,
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
  // The List's own wiring (TV-U10), kept in one place: handles, sections
  // and teams, the Detailed headers' sort, section edits, remembered folds.
  const projectScope = buckets.some((b) => b.id === place);
  const listExtras = {
    taskKey,
    sections: api.sections,
    teams: api.teams,
    filteredOut: filtering.active
      ? {
          hidden: scopeTasksAll.length - scopeTasks.length,
          filters: tasksDisplay.filters.length + (filtering.searching ? 1 : 0),
        }
      : undefined,
    onSort: (column: Parameters<typeof nextHeaderSort>[1]) =>
      setDisplay({
        ...display,
        ...nextHeaderSort(display, column, tasksDisplayDefaults(displayScope).order),
      }),
    onAddSection:
      projectScope && canEdit ? (name: string) => void api.createSection(place, name) : undefined,
    // ⏎ opens the selected task's full page (decision 22; the panel's
    // "↑↓ to move · ⏎ to open").
    onOpenTask: setFullPageId,
    onRenameSection: canEdit ? api.renameSection : undefined,
    onDeleteSection: canEdit ? api.deleteSection : undefined,
    // Folds follow the person (TV-U8); a saved view keeps its own.
    collapseKey: listFoldKey(workspaceId, selection, tasksDisplay.display.group),
  };

  // What each view built on the List hands it (TV-U15): Upcoming its days and
  // keys, the Inbox its triage and snoozed, My tasks its team block, All its
  // area words and folds; each its own teaching empty state.
  const viewExtras =
    place === UPCOMING_SELECTION
      ? {
          grouping: upcoming.grouping,
          onViewKey: upcoming.onViewKey,
          subtasks: "flat" as const,
          emptyState: <UpcomingEmpty canEdit={canEdit} onAddToday={() => openCapture()} />,
        }
      : isInboxScope
        ? {
            extraGroups: inboxView.extraGroups,
            onViewKey: inboxView.onViewKey,
            sourceOf: inboxView.sourceOf,
            note: inboxView.note,
            emptyState: inboxView.emptyState,
          }
        : place === "mine"
          ? {
              extraGroups: mineExtraGroups,
              onTake: takeTask,
              takeableIds,
              emptyState: <MyTasksEmpty canEdit={canEdit} onAdd={() => openCapture()} />,
            }
          : place === "all"
            ? {
                defaultFolded: allFolded,
                groupSub: allGroupSub,
                emptyState: <AllEmpty hasProjects={buckets.length > 0} />,
              }
            : place === WONTDO_SELECTION
              ? {
                  countEvery: true,
                  // Won't do tasks arrive after the open ones (TV-D11a): not
                  // "nothing" until they're in.
                  emptyState: api.restLoaded ? <WontDoEmpty /> : <TaskListSkeleton />,
                }
              : {};

  // A selection's keys come first (TV-U12), then the view's own.
  const ownViewKey = "onViewKey" in viewExtras ? viewExtras.onViewKey : undefined;
  const onViewKey = (event: React.KeyboardEvent<HTMLDivElement>, selected: Task | null) =>
    bulk.onKey(event) || (ownViewKey?.(event, selected) ?? false);

  // ── The Timeline's No date view (TV-TL2, REPLAN 70) ─────────────────────────
  // The centre shows the Timeline (not Focus, Templates, Trash or Archived).
  const timelineShown =
    view === "timeline" &&
    selection !== "today" &&
    selection !== TEMPLATES_SELECTION &&
    selection !== TRASH_SELECTION &&
    selection !== ARCHIVED_SELECTION;
  // Its drags need Edit: the workspace's, and inside a project the project's
  // own (shared view-only, D15-11's question, asked once). A person who can't
  // gets no handles anywhere, the No date view's rows included.
  const timelineProjectId =
    timelineShown && buckets.some((b) => b.id === selection && !b.isSystem) ? selection : "";
  const timelineProjectAccess = useProjectEditable(
    timelineProjectId,
    canEdit && timelineProjectId !== "",
  );
  const timelineCanDrag =
    canEdit && !archivedProject && (timelineProjectId === "" || timelineProjectAccess === true);
  // Across projects (All, My tasks) the same question per project, all at
  // once: a project shared with you view-only shows no handles there either.
  // Your own projects and Inboxes aren't asked (a task you handed on, sitting
  // in someone's Inbox, stays yours to move; the server decides).
  const timelineAskIds = useMemo(
    () =>
      timelineShown && timelineProjectId === "" && canEdit
        ? buckets
            .filter(
              (b) => !b.isSystem && !b.deletedAt && !b.archivedAt && b.ownerId !== currentUserId,
            )
            .map((b) => b.id)
        : [],
    [timelineShown, timelineProjectId, canEdit, buckets, currentUserId],
  );
  const timelineProjectAnswer = useEditableProjects(
    workspaceId,
    timelineAskIds,
    timelineAskIds.length > 0,
  );
  const timelineCanDragIn = useMemo(() => {
    const asked = new Set(timelineAskIds);
    return (projectId: string) =>
      !asked.has(projectId) || timelineProjectAnswer(projectId) === true;
  }, [timelineAskIds, timelineProjectAnswer]);
  // A task: its project's answer, else its own. A task you're on in a project
  // you can only view is asked once by itself: assignment there usually keeps
  // you Edit on it, but not always (the server decides; a few tasks at most).
  const timelineAskTaskIds = useMemo(
    () =>
      timelineAskIds.length > 0 && currentUserId
        ? api.tasks
            .filter(
              (t) =>
                t.assigneeId === currentUserId &&
                !t.deletedAt &&
                timelineProjectAnswer(t.bucketId) === false,
            )
            .map((t) => t.id)
        : [],
    [timelineAskIds, currentUserId, api.tasks, timelineProjectAnswer],
  );
  const timelineTaskAnswer = useEditableTasks(
    workspaceId,
    timelineAskTaskIds,
    timelineAskTaskIds.length > 0,
  );
  const timelineCanDragTask = useCallback(
    (task: Task) => timelineCanDragIn(task.bucketId) || timelineTaskAnswer(task.id) === true,
    [timelineCanDragIn, timelineTaskAnswer],
  );
  // "No date · n" opens the panel on that view (the panel too, if it's closed).
  const openNoDate = useCallback(() => {
    setPanelView(NO_DATE_PANEL_VIEW);
    const state = readFeaturePanelState("tasks");
    if (!state.right) dispatchLayoutPanelsSet({ feature: "tasks", left: state.left, right: true });
  }, []);
  // Focus's "2 in flight" opens In flight the same way (TV-F8).
  const openInFlight = useCallback(() => {
    setPanelView(IN_FLIGHT_PANEL_VIEW);
    const state = readFeaturePanelState("tasks");
    if (!state.right) dispatchLayoutPanelsSet({ feature: "tasks", left: state.left, right: true });
  }, []);
  // The offer's Shrink shows the task's Details (TV-F8).
  const showDetails = useCallback((id: string) => {
    setPanelView("details");
    setSelectedTaskId(id);
  }, []);
  // In flight (TV-F8): what I'm waiting on, and my agents' work.
  const inFlight = useInFlight(api);
  // Pick up: the wait is over, the task goes back to the top of Focus.
  const pickUpInFlight = useCallback(
    (item: InFlightItem) => {
      const id = item.task.id;
      const waits = item.waiting;
      const wasQueued = api.queuedTaskIds.has(id);
      for (const w of waits) api.removeWaiting(w.id);
      api.addToQueue(id, "top");
      undoToast("Back in Focus", {
        onUndo: () => {
          for (const w of waits) api.addWaiting(id, { kind: w.kind, ref: w.ref, label: w.label });
          if (!wasQueued) api.removeFromQueue(id);
        },
      });
    },
    [api],
  );
  // Still waiting: check back tomorrow morning (a new check-back un-brightens the card).
  const checkBackLater = useCallback(
    (item: InFlightItem) => {
      const at = checkBackAt("tomorrow", new Date());
      if (!at) return;
      if (api.addReminder(item.task.id, "at", at.toISOString())) toast("Checking back tomorrow");
    },
    [api],
  );
  // The place's open tasks with no date and no session (the button's count).
  const undated = useMemo(
    () =>
      timelineShown
        ? undatedTasks(scopeTasks, api.sessions, dayNumOfKey(todayStr()) ?? 0, Date.now())
        : [],
    [timelineShown, scopeTasks, api.sessions],
  );

  // The "← item" stack (SH-1) for references opened from the panel (RF-1). A
  // new selection is a new context, so the stack starts over.
  const panelStack = usePanelStack<{ key: string; type: string; id: string }>();
  const { push: pushPanel, clear: clearPanel } = panelStack;
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new selection is the cue
  useEffect(() => {
    clearPanel();
  }, [selectedTaskId, clearPanel]);
  // A task opened from the panel (a subtask, a blocker, the parent) or from
  // Focus's subtask list stacks on top as "← item" (call 65a), never moving
  // the page's selection.
  const openTaskInPanel = useCallback(
    (id: string) => pushPanel({ key: `task:${id}`, type: "task", id }),
    [pushPanel],
  );
  const panelTop = panelStack.stack[panelStack.stack.length - 1];
  const panelTopTaskId = panelTop && referenceKind(panelTop.type) === "task" ? panelTop.id : null;

  // Focus is its own screen in the centre (TV-F7); the rails stay.
  // Archived projects and Recently deleted open from the sidebar's ⋯ (98).
  const body =
    selection === TEMPLATES_SELECTION ? (
      templateActions.page
    ) : selection === TRASH_SELECTION ? (
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
    ) : selection === ARCHIVED_SELECTION ? (
      <ArchivedProjectsView
        projects={api.archivedBuckets}
        openCountByProject={(id) => projectOpenWork(api.archivedTasks, id).open.length}
        canEdit={canEdit}
        onOpen={setSelection}
        onUnarchive={(id) => void api.unarchiveBucket(id)}
        onDelete={(bucket) => setProjectDialog({ kind: "delete", bucket, open: true })}
      />
    ) : selection === "today" ? (
      <FocusView
        api={viewApi}
        workspaceId={workspaceId}
        runtime={runtime}
        canEdit={canEdit}
        bucketNameById={bucketNameById}
        selectedTaskId={selectedTaskId}
        onSelectTask={setSelectedTaskId}
        onOpenTask={openTaskInPanel}
        panelTaskId={panelTopTaskId}
        onRequestCapture={openCapture}
        onShowInFlight={openInFlight}
        onShowDetails={showDetails}
      />
    ) : view === "board" ? (
      <TaskBoardView
        {...sharedViewProps}
        {...displayProps}
        dndMode="external"
        boardGroupBy={tasksDisplay.display.boardGroup}
        lanes={tasksDisplay.display.boardLanes}
        description={tasksDisplay.display.cardDescription === "preview"}
        statusFilter={statusFilter}
        onManualOrder={backToManualOrder}
        onAddStatus={
          // One project's board only (REPLAN 53a): never All, My tasks, the
          // Queue or the Inbox (which uses the workspace default set).
          canEdit && buckets.some((b) => b.id === place)
            ? () => setStatusesEditor({ projectId: place, addingTo: "in_progress" })
            : undefined
        }
        onEditStatuses={
          canEdit && buckets.some((b) => b.id === place)
            ? () => setStatusesEditor({ projectId: place, addingTo: null })
            : undefined
        }
        // The Board's own wiring (TV-U11): handles, ⏎ to the full page, folds.
        taskKey={taskKey}
        onOpenTask={setFullPageId}
        onViewKey={bulk.onKey}
        foldKey={boardFoldKey(workspaceId, selection, tasksDisplay.display.boardGroup)}
      />
    ) : view === "timeline" ? (
      <TaskTimelineView
        {...sharedViewProps}
        // The Timeline's own wiring (TV-TL1): its Display, Show done, ⏎ to the
        // full page, a project row's ⏎ to that project.
        workspaceId={workspaceId}
        display={tasksDisplay.display}
        onDisplayChange={setDisplay}
        completed={displayProps.completed}
        stayingIds={displayProps.stayingIds}
        taskKey={taskKey}
        onOpenTask={setFullPageId}
        onOpenProject={pickSelection}
        // TV-TL2: a selection's bar keys (never Upcoming's or the Inbox's own),
        // and "No date · n" opening the right panel's view.
        onViewKey={bulk.onKey}
        onOpenNoDate={openNoDate}
        canDrag={timelineCanDrag}
        canDragIn={timelineCanDragIn}
        canDragTask={timelineCanDragTask}
      />
    ) : (
      <TaskListView
        {...sharedViewProps}
        {...displayProps}
        dndMode="external"
        groupBy={tasksDisplay.display.group}
        onManualOrder={backToManualOrder}
        revealRequest={revealRequest}
        {...listExtras}
        {...viewExtras}
        onViewKey={onViewKey}
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
      {archivedProject ? (
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
  // pattern). The Timeline (TV-TL2) is one too, for one drag only: a task from
  // the right panel's No date view onto its canvas (one droppable, the day from
  // the raw pointer at the drop). Its own marks drag with plain pointer events
  // (`use-timeline-canvas.ts`), never through this context.
  const pageSensors = useTaskDndSensors();
  // Refs so the collision fn (stable, empty-deps) always reads the live surface;
  // neither can change mid-drag (switching view/scope remounts the body).
  const viewRef = useRef(view);
  const selectionRef = useRef(place);
  useEffect(() => {
    viewRef.current = view;
    selectionRef.current = place;
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
    // The Timeline's canvas takes a No date task only while the pointer is on it.
    if (viewRef.current === "timeline") {
      const canvas = centerContainers.filter((c) => c.id === TIMELINE_DROP_ID);
      return canvas.length > 0 ? pointerWithin({ ...args, droppableContainers: canvas }) : [];
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
      if (id === `${RAIL_DROP_PREFIX}queue`) return "Focus";
      if (id === `${RAIL_DROP_PREFIX}mine`) return "My tasks";
      if (id.startsWith("link:")) return "the open task, to link them";
      // A Board column or lane cell: the name the board registered (TV-U11).
      if (id.startsWith("col:")) return boardDropName(id);
      if (id === TIMELINE_DROP_ID) return "the timeline, to give it a due date";
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
          // Done through the module's check-off, so its open subtasks finish
          // too (call 87).
          if (done) moduleApi.markDone(taskId);
          else moduleApi.patchTask(taskId, { status: "todo" });
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
      onOpenTask={openTaskInPanel}
      onOpenFullPage={selectedTask ? () => setFullPageId(selectedTask.id) : undefined}
      api={viewApi}
      runtime={runtime}
      workspaceId={workspaceId}
      onOpenEntity={handleOpenEntity}
      onSaveAsTemplate={offersTemplates ? templateActions.requestSaveTask : undefined}
    />
  );
  // The hub is a drop target within the ONE page-level DndContext (below); no
  // own context — that's exactly what let center rows reach it (DF-22).
  const bulkTasks = useMemo(
    () => bulkIds.flatMap((id) => taskById.get(id) ?? []),
    [bulkIds, taskById],
  );
  const details = multiSelect.multi ? (
    <BulkPanel
      tasks={bulkTasks}
      statusById={api.statusById}
      bucketNameById={bucketNameById}
      sections={api.sections}
      teams={api.teams}
      tagsByTask={api.tagsByTask}
      canEdit={canEdit && !archivedProject}
      onPick={bulk.openPicker}
    />
  ) : privateLinkId ? (
    <TaskGonePanel
      taskId={privateLinkId}
      api={api}
      canEdit={canEdit}
      onBack={() => setPrivateLinkId(null)}
    />
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
            onSelectTask={openTaskInPanel}
            onOpenTask={openTaskInPanel}
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

  // ── the full page (call 32) ───────────────────────────────────────────────
  const fullPageTask = fullPageId ? (taskById.get(fullPageId) ?? null) : null;
  // A task that left (deleted, moved out of reach) or a new scope closes it.
  useEffect(() => {
    if (fullPageId && !api.loading && !taskById.has(fullPageId)) setFullPageId(null);
  }, [fullPageId, api.loading, taskById]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new scope is the cue
  useEffect(() => {
    setFullPageId(null);
  }, [selection]);
  const pageOrder = scopeTasks.filter((t) => !t.parentId && !isHiddenByDisplay(t));
  const pageIndex = fullPageTask ? pageOrder.findIndex((t) => t.id === fullPageTask.id) : -1;
  const goToPage = (index: number) => {
    const next = pageOrder[index];
    if (!next) return;
    setFullPageId(next.id);
    setSelectedTaskId(next.id);
  };
  const viewName = view === "board" ? "Board" : view === "timeline" ? "Timeline" : "List";

  // ── the Project view (default p) ────────────────────────────────────────────
  // Its project: the open task's, else the project open in the sidebar.
  const scopeProject =
    buckets.find((b) => b.id === place && !b.isSystem) ?? archivedProject ?? null;
  const panelProject = selectedTask
    ? (buckets.find((b) => b.id === selectedTask.bucketId && !b.isSystem) ??
      // A task of an archived project shows that project, read-only (TV-U16).
      api.archivedBuckets.find((b) => b.id === selectedTask.bucketId) ??
      null)
    : scopeProject;
  const projectView = panelProject ? (
    <ProjectPanel
      project={panelProject}
      tasks={panelProject.archivedAt ? api.archivedTasks : api.tasks}
      sections={api.sections}
      completions={api.completions}
      waiting={api.waiting}
      canEdit={canEdit}
      onSetState={requestProjectState}
      onEdit={(id, patch) => void api.updateProjectFields(id, patch)}
      onOpenTask={(id) => {
        setPanelView("details");
        onUrlTaskIdChange(id);
      }}
      onArchive={requestArchive}
      onDuplicate={offersTemplates ? templateActions.requestDuplicate : undefined}
    />
  ) : null;
  // Nothing selected inside a project, or a task in the centre: the panel
  // shows Project (the one exception to "the panel remembers its view").
  // The Timeline's No date stays open while you work the canvas (TV-TL2).
  const panelActive = multiSelect.multi
    ? "details"
    : panelView === NO_DATE_PANEL_VIEW && timelineShown && !fullPageTask
      ? NO_DATE_PANEL_VIEW
      : projectView && (fullPageTask || (!selectedTask && !privateLinkId && scopeProject))
        ? "project"
        : panelView;

  // The right panel's title row names and switches its views (SH-1): Details
  // and Project (TV-U13), In flight (TV-F8), No date beside the Timeline (TV-TL2).
  const right = (
    <RightPanel
      module="tasks"
      views={{
        details: () =>
          fullPageTask ? (
            <EmptyState
              title="Shown in the centre"
              description="This task fills the centre. Esc goes back."
            />
          ) : (
            details
          ),
        // Always listed, so the menu keeps its shape; with no project (an
        // Inbox task) it says so.
        project: () =>
          projectView ?? <ProjectPanel project={null} tasks={api.tasks} sections={api.sections} />,
        // Always listed (an alongside view): hand-offs and my agents' work.
        [IN_FLIGHT_PANEL_VIEW]: () => (
          <InFlightPanel
            items={inFlight.items}
            canEdit={canEdit}
            bucketNameById={bucketNameById}
            onOpenTask={openTaskInPanel}
            onPickUp={pickUpInFlight}
            onLater={checkBackLater}
            fileCounts={api.attachmentCounts}
          />
        ),
        // Listed only while the Timeline shows (the registry hides a view a
        // page can't render).
        [NO_DATE_PANEL_VIEW]: timelineShown
          ? () => (
              <TimelineNoDatePanel
                tasks={undated}
                projects={buckets}
                inboxId={inbox?.id ?? null}
                canEdit={timelineCanDrag}
                canMove={timelineCanDragTask}
                selectedTaskId={selectedTaskId}
                onOpen={(id) => {
                  setPanelView("details");
                  setSelectedTaskId(id);
                }}
              />
            )
          : undefined,
      }}
      activeId={panelActive}
      onChange={setPanelView}
      items={panelItems}
      onBack={panelStack.back}
      onClearItems={panelStack.clear}
    />
  );
  const centre = fullPageTask ? (
    <TaskFullPage
      backLabel={`${viewName} · ${scopeTitle}`}
      position={pageIndex >= 0 ? { index: pageIndex, total: pageOrder.length } : null}
      onPrev={pageIndex > 0 ? () => goToPage(pageIndex - 1) : null}
      onNext={
        pageIndex >= 0 && pageIndex < pageOrder.length - 1 ? () => goToPage(pageIndex + 1) : null
      }
      onClose={() => setFullPageId(null)}
    >
      <TaskDetailPanel
        key={fullPageTask.id}
        task={fullPageTask}
        buckets={buckets}
        inbox={inbox}
        // A task of an archived project stays read-only here too (TV-U6).
        canEdit={canEdit && !api.archivedTasks.some((t) => t.id === fullPageTask.id)}
        onRequestCapture={openCapture}
        onSelectTask={setSelectedTaskId}
        onOpenTask={openTaskInPanel}
        onCloseFullPage={() => setFullPageId(null)}
        layout="page"
        api={viewApi}
        runtime={runtime}
        workspaceId={workspaceId}
        onOpenEntity={handleOpenEntity}
        onSaveAsTemplate={offersTemplates ? templateActions.requestSaveTask : undefined}
      />
    </TaskFullPage>
  ) : (
    center
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
          center={centre}
          right={right}
        />
      </DndContext>
      {upcoming.dialogs}
      {inboxView.dialogs}
      {bulk.dialogs}
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
          // A saved view of it goes too (its place is gone).
          if (place === bucket.id) setSelection("inbox");
        }}
        onClose={() => setProjectDialog((prev) => (prev ? { ...prev, open: false } : prev))}
        onCloseAutoFocus={(event) =>
          restoreNavFocus(event, railNavRef.current, projectDialog?.bucket.id ?? null)
        }
      />
      <ArchiveProjectDialog
        bucket={projectDialog?.kind === "done" ? projectDialog.bucket : null}
        open={projectDialog?.kind === "done" && projectDialog.open}
        intent="done"
        openCount={
          projectDialog ? projectOpenWork(api.tasks, projectDialog.bucket.id).open.length : 0
        }
        projects={buckets}
        onConfirm={(bucket, openTasks) => api.setProjectState(bucket.id, "done", openTasks)}
        onClose={() => setProjectDialog((prev) => (prev ? { ...prev, open: false } : prev))}
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
          if (place === bucket.id) setSelection("inbox");
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
      {templateActions.dialogs}
      {taskImport.dialog}
      {savedViews.dialog}
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
      <TasksWelcomeDialog welcome={welcome} />
    </ReferenceHostProvider>
  );
}
