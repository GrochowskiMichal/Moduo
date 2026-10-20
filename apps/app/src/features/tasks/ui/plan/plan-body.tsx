// The plan view's centre: the view switch (Templates, Recently deleted,
// Archived, Focus, Board, Timeline, List), its error and archived banners, and
// the full page over it.

import { Button } from "../../../../components/ui/button";
import { boardFoldKey } from "../../folds";
import { PRIVATE_PROJECT_LABEL } from "../../model";
import { projectOpenWork } from "../../sidebar";
import { ArchivedProjectBanner, ArchivedProjectsView } from "../archived-projects-view";
import { ARCHIVED_SELECTION, TEMPLATES_SELECTION, TRASH_SELECTION } from "../bucket-rail";
import { FocusView } from "../focus-view";
import { RecentlyDeletedView } from "../recently-deleted-view";
import { TaskBoardView } from "../task-board-view";
import { TaskDetailPanel } from "../task-detail-panel";
import { TaskFullPage } from "../task-full-page";
import { TaskListView } from "../task-list-view";
import { TaskTimelineView } from "../task-timeline-view";

import type { PlanController } from "./use-tasks-plan-controller";

export function PlanBody({ c }: { c: PlanController }) {
  const {
    api,
    workspaceId,
    runtime,
    canEdit,
    buckets,
    inbox,
    setFullPageId,
    setProjectDialog,
    setStatusesEditor,
    selectedTaskId,
    setSelectedTaskId,
    taskKey,
    revealRequest,
    selection,
    setSelection,
    place,
    archivedProject,
    bucketNameById,
    tasksDisplay,
    view,
    statusFilter,
    bulk,
    scopeTitle,
    openCapture,
    viewApi,
    templateActions,
    offersTemplates,
    setListShowsNothing,
    setDisplay,
    backToManualOrder,
    sharedViewProps,
    displayProps,
    listExtras,
    viewExtras,
    onViewKey,
    timelineCanDrag,
    timelineCanDragIn,
    timelineCanDragTask,
    openNoDate,
    openInFlight,
    showDetails,
    openTaskInPanel,
    panelTopTaskId,
    handleOpenEntity,
    fullPageTask,
    pageOrder,
    pageIndex,
    goToPage,
    viewName,
  } = c;

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
        onOpenProject={setSelection}
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
        onShowsNothing={setListShowsNothing}
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
  return centre;
}
