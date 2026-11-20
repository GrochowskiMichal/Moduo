// What the plan view does: bulk actions, capture "here", the blocked-by
// frontier offer, rail drops (TV-U4), project archive/state, templates and
// import.

import { isOpenTask, type ProjectState } from "@contracts/vocabularies";
import type { DragEndEvent } from "@dnd-kit/core";
import { useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";

import { dispatchOpenCapture } from "../../../../components/app/capture-shell";
import { onCreateNew } from "../../../../components/app/create-events";
import { useWorkspaceStore } from "../../../../lib/sync/react";
import { UNDO_TOAST_MS, undoToast } from "../../../../lib/undo-toast";
import { tasksWord } from "../../bulk";
import { myTasksScope, openCount } from "../../default-view";
import type { TaskDropWrite } from "../../dnd/drop-write";
import { multiDropWrites } from "../../dnd/multi-drop";
import {
  asRailDropTarget,
  projectMoveWrite,
  railDropAction,
  type RailDropTarget,
} from "../../dnd/rail-drop";
import { type CaptureSeed, seededProject } from "../../filters";
import { todayStr } from "../../helpers";
import { useTaskImport } from "../../importers/ui/use-task-import";
import type { GroupAdd } from "../../list-group-add";
import { type Bucket, isDrifted } from "../../model";
import { inViewOrder } from "../../selection";
import { projectOpenWork } from "../../sidebar";
import {
  useFrontierFor,
  useOpenTrashRef,
  useTaskCommands,
  useTasksSelector,
} from "../../tasks-context";
import { useTemplateActions } from "../../templates/ui/use-template-actions";
import {
  TEMPLATES_SELECTION,
  TRASH_SELECTION,
  UPCOMING_SELECTION,
  WONTDO_SELECTION,
} from "../bucket-rail";
import { asTaskDrag } from "../dnd/task-dnd";
import { useBulkActions } from "../use-bulk-actions";
import { useSavedViews } from "../use-saved-views";
import { EMPTY_IDS, NO_OP } from "./plan-base";
import type { PlanScopeCtx } from "./use-plan-scope";

export function usePlanActions(c: PlanScopeCtx) {
  const {
    workspaceId,
    runtime,
    onUrlTaskIdChange,
    urlViewId,
    onUrlViewConsumed,
    canEdit,
    buckets,
    inbox,
    tasks,
    setProjectDialog,
    triageBucketId,
    frontierOfferTaskId,
    setFrontierOfferTaskId,
    selectedTaskId,
    multiSelect,
    viewOrderRef,
    inboxId,
    bucketIds,
    selection,
    setSelection,
    openFocus,
    startNewView,
    workspaceRole,
    assignees,
    currentUserId,
    canManageWorkspace,
    openViewId,
    openView,
    drafting,
    place,
    archivedProject,
    bucketNameById,
    tasksDisplay,
    filtering,
    scopeTasks,
  } = c;
  // What the plan does reads and writes the Tasks module (A4); these are the
  // store's own commands (the views get the guarded ones, see the layout).
  const {
    addToQueue,
    archiveBucket,
    bulkQueue,
    bulkWrite,
    dropTask,
    focusOnTask: focusOnTaskCommand,
    removeFromQueue,
    setProjectState,
    toggleQueue,
  } = useTaskCommands();
  const archivedTasks = useTasksSelector((d) => d.archivedTasks);
  const allAreas = useTasksSelector((d) => d.areas);
  const blockedTaskIds = useTasksSelector((d) => d.blockedIds);
  const frontierFor = useFrontierFor();
  const openTrashRef = useOpenTrashRef();
  const queuedTaskIds = useTasksSelector((d) => d.queuedTaskIds);
  const allSections = useTasksSelector((d) => d.sections);
  const bulkIds = useMemo(
    () =>
      multiSelect.multi
        ? inViewOrder(
            multiSelect.ids,
            viewOrderRef.current.length > 0 ? viewOrderRef.current : scopeTasks.map((t) => t.id),
          )
        : EMPTY_IDS,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the views write viewOrderRef as they draw; it's read, never a cue
    [multiSelect.multi, multiSelect.ids, scopeTasks],
  );
  // The bottom bar's row, its keys and pickers while several are selected.
  const bulk = useBulkActions({
    ids: bulkIds,
    canEdit: canEdit && !archivedProject,
    bucketNameById,
  });
  // What New pre-fills: the filters you can see (none in Focus), and never
  // someone who can't take the task (a former member a stored filter still
  // names: the server would refuse the save).
  // A Project filter's project (MOD-141) becomes the capture's destination
  // below, never part of the seed.
  const captureSeed = useMemo<CaptureSeed>(() => {
    if (place === "today") return { tagIds: [] };
    const { projectId: _destination, ...seed } = filtering.seed;
    const id = seed.assigneeId;
    if (id && !assignees.some((a) => a.userId === id && a.canTakeTasks)) {
      const { assigneeId: _dropped, ...rest } = seed;
      return rest;
    }
    return seed;
  }, [place, filtering.seed, assignees]);
  // New under "Project is P" files into P (MOD-141), so the task stays in
  // the filtered list; under "Project is Inbox", the capture's own default.
  const filterProjectId = useMemo(
    () => (place === "today" ? null : seededProject(filtering.seed, bucketIds)),
    [place, filtering.seed, bucketIds],
  );

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
  const scopeTitle = openView
    ? openView.name
    : openViewId
      ? ""
      : drafting
        ? "Untitled view"
        : placeTitle;

  // Saved views (TV-U8): the sidebar's Views, Save as view…, Save changes,
  // a new view from the Views header's + (MOD-142), `?view=` links and
  // onboarding's seeded views.
  const savedViews = useSavedViews({
    workspaceId,
    userId: currentUserId,
    place,
    openView,
    drafting,
    onNewView: startNewView,
    prefs: tasksDisplay.prefs,
    dirty: tasksDisplay.dirty,
    revert: tasksDisplay.revert,
    placeTitle,
    projectIds: bucketIds,
    onOpen: setSelection,
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
      // Across projects, the one a Project filter names (MOD-141).
      projectId: project?.id ?? filterProjectId,
      queueTop: place === "today",
    };
  }, [buckets, place, archivedProject, filterProjectId]);

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
      if (!queuedTaskIds.has(id) && blockedTaskIds.has(id) && frontierFor(id).length > 0) {
        setFrontierOfferTaskId(id);
        return;
      }
      toggleQueue(id);
    },
    [queuedTaskIds, blockedTaskIds, frontierFor, toggleQueue, setFrontierOfferTaskId],
  );
  // "Focus on this" (⇧F, the menus, the panel's ▶; call 31) away from Focus
  // says where the session went, with a way there. In Focus the card shows it.
  const focusOnTask = useCallback(
    (id: string) => {
      const started = focusOnTaskCommand(id);
      if (started && selection !== "today") {
        const title = tasks.find((t) => t.id === id)?.title || "Untitled";
        toast(`Focusing on “${title}”`, {
          duration: UNDO_TOAST_MS,
          action: { label: "Open Focus", onClick: openFocus },
        });
      }
      return started;
    },
    [focusOnTaskCommand, selection, tasks, openFocus],
  );

  const frontierOfferTask = useMemo(
    () => (frontierOfferTaskId ? (tasks.find((t) => t.id === frontierOfferTaskId) ?? null) : null),
    [frontierOfferTaskId, tasks],
  );
  const frontierOffer = useMemo(
    () => (frontierOfferTaskId ? frontierFor(frontierOfferTaskId) : []),
    [frontierOfferTaskId, frontierFor],
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
    () => ({ queuedTaskIds: queuedTaskIds, currentUserId, inboxId: inbox?.id ?? null }),
    [queuedTaskIds, currentUserId, inbox],
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
          bulkQueue(bulkIds, { mode: "add" });
          return;
        }
        const write: TaskDropWrite =
          action.kind === "move"
            ? { taskId: task.id, bucketId: action.bucketId }
            : { taskId: task.id, assigneeId: action.userId };
        const writes = multiDropWrites(write, task, bulkIds, tasks);
        if (writes.length === 0) return;
        void bulkWrite(writes, {
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
          void dropTask(
            projectMoveWrite(task, action.bucketId, parent),
            `Moved to ${bucketNameById(action.bucketId)}`,
          );
          return;
        }
        case "queue": {
          // A blocked task opens the frontier offer (its own explicit choice).
          const blocked =
            blockedTaskIds.has(action.taskId) && frontierFor(action.taskId).length > 0;
          if (blocked) {
            guardedToggleQueue(action.taskId);
            return;
          }
          addToQueue(action.taskId, "end", () =>
            undoToast("Added to Focus", {
              onUndo: () => removeFromQueue(action.taskId),
            }),
          );
          return;
        }
        case "assign-me":
          void dropTask({ taskId: action.taskId, assigneeId: action.userId }, "Assigned to you");
          return;
      }
    },
    [
      canEdit,
      taskById,
      railCtx,
      bulkQueue,
      tasks,
      bulkWrite,
      dropTask,
      blockedTaskIds,
      frontierFor,
      addToQueue,
      removeFromQueue,
      bucketNameById,
      guardedToggleQueue,
      multiSelect.ids,
      bulkIds,
    ],
  );

  // A project's Archive… asks first only when it still has open work
  // (REPLAN 78); otherwise it archives at once, with Undo.
  const requestArchive = useCallback(
    (bucket: Bucket) => {
      if (projectOpenWork(tasks, bucket.id).open.length === 0) {
        archiveBucket(bucket.id, { kind: "keep" });
        return;
      }
      setProjectDialog({ kind: "archive", bucket, open: true });
    },
    [tasks, archiveBucket, setProjectDialog],
  );
  // A project's state from its overview (TV-U16): Done with open work asks
  // first, like Archive (REPLAN 78); Active and On hold just save.
  const requestProjectState = useCallback(
    (bucket: Bucket, state: ProjectState) => {
      if (state === "done" && projectOpenWork(tasks, bucket.id).open.length > 0) {
        setProjectDialog({ kind: "done", bucket, open: true });
        return;
      }
      setProjectState(bucket.id, state);
    },
    [tasks, setProjectState, setProjectDialog],
  );
  const checkProjectAccess = useCallback(
    async (projectId: string) =>
      runtime ? (await runtime.tasks.projectAccess({ projectId })).canManage : true,
    [runtime],
  );
  // The delete toast's "Recently deleted" link (REPLAN 98).
  useEffect(() => {
    openTrashRef.current = () => setSelection(TRASH_SELECTION);
    return () => {
      openTrashRef.current = null;
    };
  }, [openTrashRef, setSelection]);

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
    areas: allAreas,
    sections: allSections,
    tasks: tasks,
    onOpenProject: setSelection,
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
    sections: allSections,
    tasks,
    archivedTasks: archivedTasks,
    onOpenProject: setSelection,
  });
  return {
    ...c,
    bulkIds,
    bulk,
    captureSeed,
    filterProjectId,
    placeTitle,
    scopeTitle,
    savedViews,
    captureHere,
    totalOpenCount,
    myOpenCount,
    wontDoCount,
    driftTasks,
    openCapture,
    guardedToggleQueue,
    focusOnTask,
    frontierOfferTask,
    frontierOffer,
    taskById,
    railCtx,
    railAccepts,
    onRailDragEnd,
    requestArchive,
    requestProjectState,
    checkProjectAccess,
    templateStore,
    templateActions,
    offersTemplates,
    taskImport,
  };
}

export type PlanActionsCtx = ReturnType<typeof usePlanActions>;
