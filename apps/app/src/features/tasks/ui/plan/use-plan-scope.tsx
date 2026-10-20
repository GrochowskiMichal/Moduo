// What the open place shows: saved views, Display and filters, the views
// built on the List (Upcoming, the Inbox, My tasks, All), the scope's tasks,
// and the multi-select's pruning.

import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { TeamMark } from "../../../../components/ui/avatar";
import { undoToast } from "../../../../lib/undo-toast";
import { useStartConversation } from "../../../chat/start-conversation";
import { WorkspaceContext } from "../../../workspaces/workspace-context";
import { useAssignees } from "../../assignees";
import { orderTasks } from "../../display";
import { offersProjectFilter, showsArchived, statusesLetThrough } from "../../filters";
import { PRIVATE_PROJECT_LABEL, type Task } from "../../model";
import {
  allProjectOrder,
  allView,
  myTasksView,
  orderMyTasks,
  startsFolded,
  TEAM_BLOCK_ROWS,
  teamBlocks,
} from "../../my-tasks";
import { defaultRowsFor, timelineRoleFor } from "../../onboarding";
import { sidebarProjects } from "../../sidebar";
import { newViewPrefs, viewIdOf, viewPlace, viewPrefsOf } from "../../views";
import {
  ARCHIVED_SELECTION,
  NEW_VIEW_SELECTION,
  TEMPLATES_SELECTION,
  TRASH_SELECTION,
  UPCOMING_SELECTION,
  WONTDO_SELECTION,
} from "../bucket-rail";
import { useInboxView } from "../inbox-view";
import type { ListExtraGroup } from "../list-extensions";
import type { PlanView } from "../plan-view-header";
import { useUpcomingView } from "../upcoming-view";
import { useTasksDisplay } from "../use-tasks-display";
import { useTasksFilters } from "../use-tasks-filters";
import type { PlanSelectionCtx } from "./use-plan-selection";

export function usePlanScope(c: PlanSelectionCtx) {
  const {
    api,
    workspaceId,
    runtime,
    canEdit,
    buckets,
    inbox,
    tasks,
    legacyLayout,
    onboardingRole,
    projectOrder,
    selectedTaskId,
    setSelectedTaskId,
    multiSelect,
    viewOrderRef,
    taskKey,
    revealRequest,
    inboxId,
    bucketIds,
    selection,
    newViewSeq,
  } = c;

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
  // A new view before it's saved (MOD-142, the Views header's +) shows All
  // through its own blank Filter and Display.
  const drafting = selection === NEW_VIEW_SELECTION;
  const place = openView ? viewPlace(openView) : drafting ? "all" : selection;

  /** Chat's "Start a conversation for X" (CV-13), null when chat is off for you. */
  const startConversation = useStartConversation();
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
  // A new view works on its own blank copy (MOD-142), never All's own Filter
  // and Display; each + starts a fresh one.
  const savedView = useMemo(
    () =>
      openView
        ? { id: openView.id, prefs: viewPrefsOf(openView, viewRows) }
        : drafting
          ? { id: `${NEW_VIEW_SELECTION}:${newViewSeq}`, prefs: newViewPrefs(viewRows) }
          : null,
    [openView, drafting, newViewSeq, viewRows],
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
  const upcoming = useUpcomingView({ api, canEdit, inboxId, projectIds: bucketIds });
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

  // Filter → Project, where more than one project shows (MOD-141): the
  // projects as your sidebar lists them (area-less first, then each area,
  // each in your own order), and your Inbox where the place lists it (All
  // never does).
  const projectFilter = useMemo(
    () =>
      offersProjectFilter(place)
        ? { projects: sidebarProjects(buckets, api.areas, projectOrder), inbox: place !== "all" }
        : null,
    [place, buckets, api.areas, projectOrder],
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
    // "MOD-99" finds that task (MOD-126).
    taskKey,
    projects: projectFilter,
    inboxId,
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: the views write viewOrderRef as they draw; read, never a cue
  useEffect(() => {
    multiSelect.prune((id) => scopeIdSet.has(id), viewOrderRef.current);
  }, [scopeIdSet, multiSelect.prune]);
  return {
    ...c,
    assignees,
    currentUserId,
    canManageWorkspace,
    openViewId,
    views,
    openView,
    drafting,
    place,
    startConversation,
    archivedProject,
    handedInboxes,
    bucketNameById,
    selectedTaskForScope,
    archivedPinRef,
    keptArchivedId,
    linkedTaskId,
    groupChoices,
    displayScope,
    viewRows,
    savedView,
    tasksDisplay,
    isHiddenByDisplay,
    view,
    setView,
    withArchived,
    statusFilter,
    isInboxScope,
    upcoming,
    inboxRowsRef,
    inboxView,
    blocks,
    waitingIds,
    myOrder,
    blocksKey,
    takeableIds,
    mineExtraGroups,
    takeRef,
    takeTask,
    allBuckets,
    allFolded,
    allGroupSub,
    scopeTasksAll,
    archivedSearchTasks,
    projectFilter,
    filtering,
    scopeTasks,
    scopeIdSet,
  };
}

export type PlanScopeCtx = ReturnType<typeof usePlanScope>;
