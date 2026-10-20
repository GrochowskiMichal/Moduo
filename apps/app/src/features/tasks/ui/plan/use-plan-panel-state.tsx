// What the right panel and the full page show: opening a linked entity, the
// panel's task, the full page and its paging, and the Project view's pick.
// Last in `useTasksPlanController`'s chain.

import { useCallback, useEffect } from "react";
import type { EntityRef } from "../../../../lib/entity-links";
import { ENTITY_OPEN_EVENT } from "../../../../lib/entity-open";
import { activePanelView, panelTaskOf } from "../../panel-views";
import type { PlanCentreCtx } from "./use-plan-centre";

export function usePlanPanelState(c: PlanCentreCtx) {
  const {
    api,
    onUrlTaskIdChange,
    buckets,
    panelView,
    fullPageId,
    setFullPageId,
    setSelectedTaskId,
    multiSelect,
    privateLinkId,
    selection,
    place,
    archivedProject,
    isHiddenByDisplay,
    view,
    scopeTasks,
    taskById,
    selectedTask,
    listInCentre,
    listShowsNothing,
    askedProjectId,
    timelineShown,
  } = c;

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
  // None while the List shows no row (every group folded): the panel reads as
  // with nothing selected, never a task you can't see (MOD-123).
  const panelTask = panelTaskOf(selectedTask, {
    inCentre: listInCentre,
    showsNothing: listShowsNothing,
  });
  // ── the full page (call 32) ───────────────────────────────────────────────
  const fullPageTask = fullPageId ? (taskById.get(fullPageId) ?? null) : null;
  // A task that left (deleted, moved out of reach) or a new scope closes it.
  useEffect(() => {
    if (fullPageId && !api.loading && !taskById.has(fullPageId)) setFullPageId(null);
  }, [fullPageId, api.loading, taskById, setFullPageId]);
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
  // The title's ask wins (MOD-95): the project the centre is titled with.
  const askedProject = askedProjectId
    ? (buckets.find((b) => b.id === askedProjectId) ??
      api.archivedBuckets.find((b) => b.id === askedProjectId) ??
      null)
    : null;
  const panelProject =
    askedProject ??
    (panelTask
      ? (buckets.find((b) => b.id === panelTask.bucketId && !b.isSystem) ??
        // A task of an archived project shows that project, read-only (TV-U16).
        api.archivedBuckets.find((b) => b.id === panelTask.bucketId) ??
        null)
      : scopeProject);
  // The panel remembers its view; the title's ask shows Project only while
  // it stands (MOD-131). Nothing selected inside a project (or every List
  // group folded, MOD-123), or a task in the centre, shows Project too; the
  // Timeline's No date stays open while you work the canvas (TV-TL2). The
  // rule: `activePanelView`. Worked out before the Project view itself, so the
  // overview's chat lines read only while it shows (CV-13).
  const panelActive = activePanelView({
    asked: askedProject !== null,
    multi: multiSelect.multi,
    remembered: panelView,
    noDateShown: timelineShown && !fullPageTask,
    projectInstead: Boolean(
      panelProject && (fullPageTask || (!panelTask && !privateLinkId && scopeProject)),
    ),
  });
  return {
    ...c,
    handleOpenEntity,
    panelTask,
    fullPageTask,
    pageOrder,
    pageIndex,
    goToPage,
    viewName,
    scopeProject,
    askedProject,
    panelProject,
    panelActive,
  };
}

export type PlanPanelStateCtx = ReturnType<typeof usePlanPanelState>;
