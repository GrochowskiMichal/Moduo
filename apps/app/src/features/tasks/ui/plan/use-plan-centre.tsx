// The centre's wiring: the toolbar, the props every view shares, the List's
// and each built-on view's extras, the Timeline's permissions and No date,
// In flight, and the panel stack.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { usePanelStack } from "../../../../components/app/right-panel";
import { undoToast } from "../../../../lib/undo-toast";
import { dispatchLayoutPanelsSet, readFeaturePanelState } from "../../../layout/panel-events";
import { referenceKind } from "../../../spine/references/kinds";
import { openCount } from "../../default-view";
import { nextHeaderSort, orderTasks, tasksDisplayDefaults } from "../../display";
import type { InFlightItem } from "../../focus-screen";
import { listFoldKey } from "../../folds";
import { todayStr } from "../../helpers";
import type { ListExportContext } from "../../list-export";
import type { Task } from "../../model";
import { showsSortedNote, sortedByLabel } from "../../order";
import {
  askedProjectFor,
  IN_FLIGHT_PANEL_VIEW,
  NO_DATE_PANEL_VIEW,
  type ProjectAsk,
} from "../../panel-views";
import { handleLabel } from "../../row-layout";
import { useTaskCommands, useTasksSelector, useTasksStatus } from "../../tasks-context";
import { undatedTasks } from "../../timeline-rows";
import { dayNumOfKey } from "../../timeline-scale";
import {
  ARCHIVED_SELECTION,
  TEMPLATES_SELECTION,
  TRASH_SELECTION,
  UPCOMING_SELECTION,
  WONTDO_SELECTION,
} from "../bucket-rail";
import { checkBackAt } from "../focus-hand-off";
import type { ListExtraGroup } from "../list-extensions";
import { type PlanHeaderControls, SortedOrderLine } from "../plan-view-header";
import { TaskListSkeleton } from "../task-view-states";
import { useInFlight } from "../use-in-flight";
import {
  useEditableProjects,
  useEditableTasks,
  useProjectEditable,
} from "../use-project-overview-data";
import type { MultiSelect } from "../use-task-selection";
import { AllEmpty, MyTasksEmpty, UpcomingEmpty, WontDoEmpty } from "../view-empty-states";
import { ViewExportMenu } from "../view-export-menu";
import { NO_EXTRAS } from "./plan-base";
import type { PlanCursorCtx } from "./use-plan-cursor";

export function usePlanCentre(c: PlanCursorCtx) {
  const {
    workspaceId,
    canEdit,
    buckets,
    inbox,
    tasks,
    setPanelView,
    setFullPageId,
    selectedTaskId,
    setSelectedTaskId,
    multiSelect,
    viewOrderRef,
    taskKey,
    selection,
    assignees,
    currentUserId,
    openView,
    drafting,
    place,
    archivedProject,
    bucketNameById,
    displayScope,
    tasksDisplay,
    isHiddenByDisplay,
    view,
    setView,
    isInboxScope,
    upcoming,
    inboxView,
    takeableIds,
    mineExtraGroups,
    takeTask,
    allBuckets,
    allFolded,
    allGroupSub,
    scopeTasksAll,
    filtering,
    scopeTasks,
    bulk,
    scopeTitle,
    savedViews,
    openCapture,
  } = c;
  // What the centre reads from the Tasks module (A4).
  const {
    addReminder,
    addToQueue,
    addWaiting,
    createSection,
    deleteSection,
    removeFromQueue,
    removeWaiting,
    renameSection,
  } = useTaskCommands();
  const { restLoaded } = useTasksStatus();
  const queuedTaskIds = useTasksSelector((d) => d.queuedTaskIds);
  const allSections = useTasksSelector((d) => d.sections);
  const sessions = useTasksSelector((_, snap) => snap.sessions);
  const allTeams = useTasksSelector((d) => d.teams);

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
  // The "← item" stack (SH-1) for references opened from the panel (RF-1).
  // Up here: the views opened from the centre (the title, No date, In flight)
  // clear it, or the item on top would still cover the view they ask for.
  const panelStack = usePanelStack<{ key: string; type: string; id: string }>();
  const { push: pushPanel, clear: clearPanel } = panelStack;
  // A project's title opens Project details in the right panel (MOD-95), the
  // way the panel shows it when nothing is selected, the panel too if it's
  // closed. A saved view's title is the view's name, so it stays plain.
  const titleProjectId = !openView
    ? (buckets.find((b) => b.id === place && !b.isSystem)?.id ?? archivedProject?.id ?? null)
    : null;
  // What the title asked for: that project's overview, over an item stacked
  // in the panel and over a multi-selection's bulk panel, until the cursor or
  // the place moves, a task is clicked or a view is picked (then the panel
  // follows the selection again, on the view it remembers).
  const [projectAsk, setProjectAsk] = useState<ProjectAsk | null>(null);
  const askedProjectId = askedProjectFor(projectAsk, selectedTaskId, place);
  // The ask is only a look, never the panel's pick (MOD-131): setting the
  // panel's view here left it on Project for every task clicked after.
  const openProjectDetails = useCallback(() => {
    if (!titleProjectId) return;
    clearPanel();
    setProjectAsk({ projectId: titleProjectId, taskId: selectedTaskId, place });
    const state = readFeaturePanelState("tasks");
    if (!state.right) dispatchLayoutPanelsSet({ feature: "tasks", left: state.left, right: true });
  }, [titleProjectId, selectedTaskId, place, clearPanel]);
  // A view picked (the panel's menu, ⌥1–4, No date · n, In flight, a task
  // opened from a panel) ends the ask, then is the one the panel remembers.
  const pickPanelView = useCallback(
    (id: string) => {
      setProjectAsk(null);
      setPanelView(id);
    },
    [setPanelView],
  );
  // A click on a task in the centre ends the ask too, on the selected task as
  // well, which moves no cursor (MOD-131). Only a gesture comes through the
  // views' `select`; the cursor's own fallbacks don't.
  const selectInView = multiSelect.select;
  const selectEndingAsk = useCallback<MultiSelect["select"]>(
    (id, mods, order) => {
      setProjectAsk(null);
      selectInView(id, mods, order);
    },
    [selectInView],
  );
  const viewMultiSelect = useMemo(
    () => ({ ...multiSelect, select: selectEndingAsk }),
    [multiSelect, selectEndingAsk],
  );
  const header: PlanHeaderControls = {
    // Won't do counts what it lists (none of it is open); a saved view (or a
    // new one), the tasks it shows ("Done last week" counts its done ones).
    count:
      place === WONTDO_SELECTION
        ? scopeTasksAll.length
        : openView || drafting
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
    viewSave: savedViews.viewSave,
    sortedNote:
      view !== "timeline" && order !== "manual" && showsSortedNote(place, order) ? (
        <SortedOrderLine label={sortedByLabel(order)} onManualOrder={backToManualOrder} />
      ) : null,
    // Statuses… lives in the Project view's ⋯ now (MOD-150).
    project: titleProjectId ? { onOpenDetails: openProjectDetails } : undefined,
  };

  const sharedViewProps = {
    tasks: scopeTasks,
    multiSelect: viewMultiSelect,
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
  };
  // List and Board follow Display; the Timeline keeps its own rules.
  const displayProps = tasksDisplay.viewProps;
  // The List's own wiring (TV-U10), kept in one place: handles, sections
  // and teams, the Detailed headers' sort, section edits, remembered folds.
  const projectScope = buckets.some((b) => b.id === place);
  const listExtras = {
    taskKey,
    // Display → Columns (MOD-128, MOD-136): Detailed's own columns that are on.
    detailedColumns: display.detailedColumns,
    sections: allSections,
    teams: allTeams,
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
      projectScope && canEdit ? (name: string) => void createSection(place, name) : undefined,
    // ⏎ opens the selected task's full page (decision 22; the panel's
    // "↑↓ to move · ⏎ to open").
    onOpenTask: setFullPageId,
    onRenameSection: canEdit ? renameSection : undefined,
    onDeleteSection: canEdit ? deleteSection : undefined,
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
                  emptyState: restLoaded ? <WontDoEmpty /> : <TaskListSkeleton />,
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
        ? tasks
            .filter(
              (t) =>
                t.assigneeId === currentUserId &&
                !t.deletedAt &&
                timelineProjectAnswer(t.bucketId) === false,
            )
            .map((t) => t.id)
        : [],
    [timelineAskIds, currentUserId, tasks, timelineProjectAnswer],
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
    clearPanel();
    pickPanelView(NO_DATE_PANEL_VIEW);
    const state = readFeaturePanelState("tasks");
    if (!state.right) dispatchLayoutPanelsSet({ feature: "tasks", left: state.left, right: true });
  }, [clearPanel, pickPanelView]);
  // Focus's "2 in flight" opens In flight the same way (TV-F8).
  const openInFlight = useCallback(() => {
    clearPanel();
    pickPanelView(IN_FLIGHT_PANEL_VIEW);
    const state = readFeaturePanelState("tasks");
    if (!state.right) dispatchLayoutPanelsSet({ feature: "tasks", left: state.left, right: true });
  }, [clearPanel, pickPanelView]);
  // The offer's Shrink shows the task's Details (TV-F8).
  const showDetails = useCallback(
    (id: string) => {
      pickPanelView("details");
      setSelectedTaskId(id);
    },
    [pickPanelView, setSelectedTaskId],
  );
  // In flight (TV-F8): what I'm waiting on, and my agents' work.
  const inFlight = useInFlight();
  // Pick up: the wait is over, the task goes back to the top of Focus.
  const pickUpInFlight = useCallback(
    (item: InFlightItem) => {
      const id = item.task.id;
      const waits = item.waiting;
      const wasQueued = queuedTaskIds.has(id);
      for (const w of waits) removeWaiting(w.id);
      addToQueue(id, "top");
      undoToast("Back in Focus", {
        onUndo: () => {
          for (const w of waits) addWaiting(id, { kind: w.kind, ref: w.ref, label: w.label });
          if (!wasQueued) removeFromQueue(id);
        },
      });
    },
    [queuedTaskIds, removeWaiting, addToQueue, addWaiting, removeFromQueue],
  );
  // Still waiting: check back tomorrow morning (a new check-back un-brightens the card).
  const checkBackLater = useCallback(
    (item: InFlightItem) => {
      const at = checkBackAt("tomorrow", new Date());
      if (!at) return;
      if (addReminder(item.task.id, "at", at.toISOString())) toast("Checking back tomorrow");
    },
    [addReminder],
  );
  // The place's open tasks with no date and no session (the button's count).
  const undated = useMemo(
    () =>
      timelineShown
        ? undatedTasks(scopeTasks, sessions, dayNumOfKey(todayStr()) ?? 0, Date.now())
        : [],
    [timelineShown, scopeTasks, sessions],
  );

  // The "← item" stack's reset: a new selection is a new context, so the
  // stack starts over.
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
  return {
    ...c,
    order,
    setDisplay,
    display,
    backToManualOrder,
    exportContext,
    shownTasks,
    viewExtraGroups,
    extraTaskIds,
    panelStack,
    pushPanel,
    clearPanel,
    titleProjectId,
    projectAsk,
    setProjectAsk,
    askedProjectId,
    openProjectDetails,
    pickPanelView,
    selectInView,
    selectEndingAsk,
    viewMultiSelect,
    header,
    sharedViewProps,
    displayProps,
    projectScope,
    listExtras,
    viewExtras,
    ownViewKey,
    onViewKey,
    timelineShown,
    timelineProjectId,
    timelineProjectAccess,
    timelineCanDrag,
    timelineAskIds,
    timelineProjectAnswer,
    timelineCanDragIn,
    timelineAskTaskIds,
    timelineTaskAnswer,
    timelineCanDragTask,
    openNoDate,
    openInFlight,
    showDetails,
    inFlight,
    pickUpInFlight,
    checkBackLater,
    undated,
    openTaskInPanel,
    panelTop,
    panelTopTaskId,
  };
}

export type PlanCentreCtx = ReturnType<typeof usePlanCentre>;
