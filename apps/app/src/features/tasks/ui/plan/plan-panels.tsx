// The plan view's right panel: Details (or the bulk panel, or "Private
// item"), the "← item" stack, Project, In flight and No date.

import { CircleCheck } from "lucide-react";
import { useMemo } from "react";
import { type PanelItem, RightPanel } from "../../../../components/app/right-panel";
import { EmptyState } from "../../../../components/ui/empty-state";
import { useItemChatSlots } from "../../../chat/mentioned-in";
import { HubDropZone } from "../../../contacts/ui/hub-drop-zone";
import { useReferences } from "../../../spine/references/context";
import { referenceKind } from "../../../spine/references/kinds";
import type { ReferenceRef } from "../../../spine/references/types";
import {
  ReferencePanelBody,
  referencePanelOpen,
  referencePanelTitle,
} from "../../../spine/references/ui/reference-panel";
import { IN_FLIGHT_PANEL_VIEW, NO_DATE_PANEL_VIEW, panelTitleOf } from "../../panel-views";
import { useTaskCommands, useTasksSelector, useTaskTagIndex } from "../../tasks-context";
import { BulkPanel } from "../bulk-panel";
import { InFlightPanel } from "../in-flight-panel";
import { ProjectPanel } from "../project-panel";
import { TaskDetailPanel, TaskGonePanel } from "../task-detail-panel";
import { TimelineNoDatePanel } from "../timeline-no-date-panel";
import type { PlanController } from "./use-tasks-plan-controller";

export function PlanPanels({ c }: { c: PlanController }) {
  const {
    workspaceId,
    runtime,
    onUrlTaskIdChange,
    canEdit,
    buckets,
    tasks,
    inbox,
    setFullPageId,
    setStatusesEditor,
    selectedTaskId,
    setSelectedTaskId,
    multiSelect,
    privateLinkId,
    setPrivateLinkId,
    startConversation,
    archivedProject,
    bucketNameById,
    bulkIds,
    bulk,
    openCapture,
    taskById,
    requestArchive,
    requestProjectState,
    templateActions,
    offersTemplates,
    selectedArchivedTask,
    panelCanEdit,
    panelStack,
    pickPanelView,
    timelineShown,
    timelineCanDrag,
    timelineCanDragTask,
    inFlight,
    pickUpInFlight,
    checkBackLater,
    undated,
    openTaskInPanel,
    handleOpenEntity,
    panelTask,
    fullPageTask,
    panelProject,
    panelActive,
  } = c;
  const { updateProjectFields } = useTaskCommands();
  const { tagsByTask } = useTaskTagIndex();
  const archivedBuckets = useTasksSelector((d) => d.archivedBuckets);
  const archivedTasks = useTasksSelector((d) => d.archivedTasks);
  const attachmentCounts = useTasksSelector((_, snap) => snap.attachmentCounts);
  const completions = useTasksSelector((_, snap) => snap.completions);
  const allSections = useTasksSelector((d) => d.sections);
  const statusById = useTasksSelector((d) => d.statusById);
  const allTeams = useTasksSelector((d) => d.teams);
  const waiting = useTasksSelector((_, snap) => snap.waiting);
  const detailPanel = (
    <TaskDetailPanel
      task={panelTask}
      buckets={selectedArchivedTask ? [...buckets, ...archivedBuckets] : buckets}
      canEdit={panelCanEdit}
      onRequestCapture={openCapture}
      onSelectTask={setSelectedTaskId}
      onOpenTask={openTaskInPanel}
      onOpenFullPage={panelTask ? () => setFullPageId(panelTask.id) : undefined}
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
      statusById={statusById}
      bucketNameById={bucketNameById}
      sections={allSections}
      teams={allTeams}
      tagsByTask={tagsByTask}
      canEdit={canEdit && !archivedProject}
      onPick={bulk.openPicker}
    />
  ) : privateLinkId ? (
    <TaskGonePanel taskId={privateLinkId} canEdit={canEdit} onBack={() => setPrivateLinkId(null)} />
  ) : panelTask ? (
    <HubDropZone target={{ type: "task", id: panelTask.id }} disabled={!panelCanEdit}>
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
            canEdit={canEdit}
            onRequestCapture={openCapture}
            onSelectTask={openTaskInPanel}
            onOpenTask={openTaskInPanel}
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

  // The overview's conversation and decision lines, from one read (CV-13, CV-14),
  // only while the Project view shows.
  const projectChat = useItemChatSlots(
    "project",
    panelActive === "project" && panelProject ? panelProject.id : "",
  );
  const projectView = panelProject ? (
    <ProjectPanel
      project={panelProject}
      tasks={panelProject.archivedAt ? archivedTasks : tasks}
      sections={allSections}
      completions={completions}
      waiting={waiting}
      canEdit={canEdit}
      onSetState={requestProjectState}
      onEdit={(id, patch) => void updateProjectFields(id, patch)}
      onOpenTask={(id) => {
        pickPanelView("details");
        onUrlTaskIdChange(id);
      }}
      onArchive={requestArchive}
      onDuplicate={offersTemplates ? templateActions.requestDuplicate : undefined}
      chat={projectChat}
      // The title row's ⋯ → Statuses… (MOD-150, from the plan header's ⋯);
      // an archived project is read-only (TV-U6).
      onEditStatuses={
        canEdit && !panelProject.archivedAt
          ? (p) => setStatusesEditor({ projectId: p.id })
          : undefined
      }
      // Chat's "Start a conversation for X" (CV-13), moved with Statuses… into
      // this ⋯ (MOD-150); the server checks edit rights.
      onStartConversation={
        startConversation && canEdit && !panelProject.archivedAt
          ? (p) => startConversation("bucket", p.id)
          : undefined
      }
    />
  ) : null;
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
          projectView ?? <ProjectPanel project={null} tasks={tasks} sections={allSections} />,
        // Always listed (an alongside view): hand-offs and my agents' work.
        [IN_FLIGHT_PANEL_VIEW]: () => (
          <InFlightPanel
            items={inFlight.items}
            canEdit={canEdit}
            bucketNameById={bucketNameById}
            onOpenTask={openTaskInPanel}
            onPickUp={pickUpInFlight}
            onLater={checkBackLater}
            fileCounts={attachmentCounts}
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
                  pickPanelView("details");
                  setSelectedTaskId(id);
                }}
              />
            )
          : undefined,
      }}
      activeId={panelActive}
      // "4 tasks ▾" while several are selected (MOD-109, round-2b frame 1's
      // title row); the full page's Details is "Shown in the centre" instead.
      title={fullPageTask ? undefined : panelTitleOf(panelActive, bulkTasks.length)}
      onChange={pickPanelView}
      items={panelItems}
      onBack={panelStack.back}
      onClearItems={panelStack.clear}
    />
  );
  return right;
}
