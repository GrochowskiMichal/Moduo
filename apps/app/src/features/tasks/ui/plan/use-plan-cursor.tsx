// The selected task, the backstop that keeps it valid in the scope, and the
// deep link's wiring (`useTaskDeepLink`) with its reveal.

import { useEffect, useMemo, useState } from "react";
import { taskLinkId } from "../../../../lib/task-handle";
import { looksLikeHandle } from "../../../spine/grammar";
import { handleLinkStep, resolveTasksDeepLink } from "../../search";
import { backstopPick } from "../../selection";
import { useTasksSelector, useTasksStatus } from "../../tasks-context";
import { ARCHIVED_SELECTION, TEMPLATES_SELECTION, TRASH_SELECTION } from "../bucket-rail";
import type { DeepLinkWorld } from "./deep-link";
import type { PlanActionsCtx } from "./use-plan-actions";
import { useTaskDeepLink } from "./use-task-deep-link";

export function usePlanCursor(c: PlanActionsCtx) {
  const {
    urlTaskId,
    onUrlTaskIdChange,
    canEdit,
    buckets,
    tasks,
    fullPageId,
    selectedTaskId,
    setSelectedTaskId,
    viewOrderRef,
    deepLink,
    inboundPending,
    scrollTargetRef,
    taskKey,
    referenceStore,
    setRevealRequest,
    setPrivateLinkId,
    inboxId,
    selection,
    setSelection,
    place,
    isHiddenByDisplay,
    view,
    scopeTasksAll,
    scopeTasks,
    scopeIdSet,
    taskById,
  } = c;
  const { error, loading, restLoaded } = useTasksStatus();
  const archivedBuckets = useTasksSelector((d) => d.archivedBuckets);
  const archivedTasks = useTasksSelector((d) => d.archivedTasks);
  // Resolve the selected task live from the bundle so the rail follows edits and
  // empties when the task is deleted. A task of an archived project (opened
  // from Archived projects, or found by search) opens too, read-only (TV-U6).
  const selectedArchivedTask = useMemo(
    () => (selectedTaskId ? (archivedTasks.find((t) => t.id === selectedTaskId) ?? null) : null),
    [selectedTaskId, archivedTasks],
  );
  const selectedTask = useMemo(
    () =>
      selectedTaskId ? (tasks.find((t) => t.id === selectedTaskId) ?? selectedArchivedTask) : null,
    [selectedTaskId, tasks, selectedArchivedTask],
  );
  const panelCanEdit = canEdit && !selectedArchivedTask;

  // The List is in the centre (the body's last branch, no full page over it):
  // the backstop picks only rows it shows (MOD-124), and with none shown the
  // panel shows what it shows with nothing selected (MOD-123). Keep it in step
  // with `body` and `centre` below: a new centre branch that isn't the List
  // must be excluded here, or the backstop reads the List's last order.
  const listInCentre =
    !(fullPageId && taskById.has(fullPageId)) &&
    selection !== TEMPLATES_SELECTION &&
    selection !== TRASH_SELECTION &&
    selection !== ARCHIVED_SELECTION &&
    selection !== "today" &&
    view !== "board" &&
    view !== "timeline";
  const [listShowsNothing, setListShowsNothing] = useState(false);

  // Scope-level selection validity (the state lives here, so its backstop does
  // too): when the selected task leaves the scope (archived, moved, deleted,
  // scope/workspace switch), fall back to the first task in scope, or while
  // the List shows, to its first row (`backstopPick`). The List refines this
  // against its collapse-aware visible rows; Board has no own logic and relies
  // on this entirely. A subtask whose *parent* is in scope also counts as
  // in-scope — it can be selected from under the parent (expanded list rows,
  // the detail panel's subtask list) even from another bucket.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the List writes viewOrderRef in its layout effect; read, never a cue
  useEffect(() => {
    if (loading || inboundPending) return;
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
    const pick = backstopPick({
      selectedId: selectedTaskId,
      selectedParentId: selectedTask?.parentId ?? null,
      inScope: (id) => scopeIdSet.has(id),
      // The List wrote what it shows in its layout effect, before this runs.
      listOrder: listInCentre ? viewOrderRef.current : null,
      // Never a completed task Display hides (TV-U1): the Board has no
      // fallback of its own, so it would open the panel on a card it doesn't show.
      firstInScope: scopeTasks.find((t) => !isHiddenByDisplay(t))?.id ?? null,
    });
    if (pick !== undefined) setSelectedTaskId(pick);
  }, [
    loading,
    inboundPending,
    place,
    view,
    selectedTaskId,
    selectedTask,
    scopeTasks,
    scopeIdSet,
    isHiddenByDisplay,
    listInCentre,
    setSelectedTaskId,
  ]);

  // ── DF-1: URL-held selection ─────────────────────────────────────────────────
  // An inbound link is honored once the bundle is CLEANLY loaded (a failed
  // read waits for Retry); `plan/deep-link.ts` decides, this page carries it
  // out. Filters and search are never cleared (they're saved per scope): the
  // target stays listed past them while it's selected (`keepTaskId`, TV-U2).
  // The place snaps to the task's project unless it already shows it; a
  // project link opens that place; a stale id clears quietly and the backstop
  // above picks the default (AC: no crash). The URL names the task by its
  // handle when it has one (`?id=MOD-142`, MOD-28).
  // What a link can open: live tasks and projects, and archived ones (TV-U16).
  const linkable = useMemo(
    () => ({
      tasks: archivedTasks.length > 0 ? [...tasks, ...archivedTasks] : tasks,
      buckets: archivedBuckets.length > 0 ? [...buckets, ...archivedBuckets] : buckets,
      inboxId,
    }),
    [tasks, buckets, inboxId, archivedTasks, archivedBuckets],
  );
  const selectedLinkId = selectedTaskId
    ? taskLinkId(taskKey, { id: selectedTaskId, number: selectedTask?.number })
    : null;
  const linkWorld = useMemo<DeepLinkWorld>(
    () => ({
      ready: !loading && !error,
      restLoaded: restLoaded,
      handleStep: (id) =>
        looksLikeHandle(id)
          ? handleLinkStep(id, { tasks: linkable.tasks, taskKey, restLoaded: restLoaded })
          : null,
      target: (id) => resolveTasksDeepLink(id, linkable),
      inScope: (taskId) => scopeTasksAll.some((t) => t.id === taskId),
      canLookup: referenceStore !== null,
    }),
    [loading, error, restLoaded, linkable, taskKey, scopeTasksAll, referenceStore],
  );
  const lookupHandle = useMemo(
    () => (referenceStore ? (handle: string) => referenceStore.lookupHandle(handle) : null),
    [referenceStore],
  );
  useTaskDeepLink(deepLink, {
    urlTaskId,
    onUrlTaskIdChange,
    world: linkWorld,
    lookup: lookupHandle,
    loaded: !loading,
    selectedTaskId,
    selectedLinkId,
    onPrivate: setPrivateLinkId,
    onApply: (command) => {
      if (command.kind === "gone") {
        // A link someone followed (a notification, a chip) to a task you
        // can't open says so, never lands on another task (AC1.10). A stale
        // id that only comes back on refresh or back/forward clears quietly.
        if (command.external) setPrivateLinkId(command.id);
        return;
      }
      setPrivateLinkId(null);
      if (command.kind === "openPlace") {
        setSelection(command.place);
        // Hand the URL to the backstop's fresh pick — the mirror must not
        // re-publish the previous scope's selection over the project link.
        setSelectedTaskId(null);
        return;
      }
      if (command.snapTo) setSelection(command.snapTo);
      setSelectedTaskId(command.taskId);
      setRevealRequest((prev) => ({ id: command.taskId, seq: (prev?.seq ?? 0) + 1 }));
      scrollTargetRef.current = command.taskId;
    },
  });

  // Reveal the deep-linked row/card/bar once it exists in the DOM — the scope
  // snap, a collapsed group's reveal, and a nested subtask's parent
  // auto-expand settle over a few frames, so poll briefly instead of assuming
  // one. Instant scroll: a programmatic reveal, not an animation. `inline`
  // reveals horizontally too (the Timeline canvas scrolls sideways).
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new link (`urlTaskId`) is the cue; the target rides a ref
  useEffect(() => {
    const id = scrollTargetRef.current;
    if (!id || loading) return;
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
  }, [loading, urlTaskId]);
  return {
    ...c,
    selectedArchivedTask,
    selectedTask,
    panelCanEdit,
    listInCentre,
    listShowsNothing,
    setListShowsNothing,
    linkable,
    selectedLinkId,
    linkWorld,
    lookupHandle,
  };
}

export type PlanCursorCtx = ReturnType<typeof usePlanCursor>;
