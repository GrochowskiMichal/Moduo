// The plan view's left rail: the sidebar's places, wired to the controller.

import { dispatchOpenCapture } from "../../../../components/app/capture-shell";
import { useDriftCountByBucket, useTaskCommands, useTasksSelector } from "../../tasks-context";
import { BucketRail } from "../bucket-rail";
import type { PlanController } from "./use-tasks-plan-controller";

export function PlanRail({ c }: { c: PlanController }) {
  const {
    canEdit,
    buckets,
    inbox,
    collapsedGroups,
    toggleGroup,
    hiddenRows,
    pinnedIds,
    toggleHiddenRow,
    projectOrder,
    moveProject,
    togglePin,
    setProjectDialog,
    setTriageBucketId,
    setStatusesEditor,
    railNavRef,
    triageFromRef,
    selection,
    setSelection,
    welcome,
    canManageWorkspace,
    views,
    captureSeed,
    savedViews,
    totalOpenCount,
    myOpenCount,
    wontDoCount,
    railAccepts,
    requestArchive,
    templateActions,
    offersTemplates,
    taskImport,
  } = c;
  const {
    createArea,
    createBucket,
    deleteArea,
    moveArea,
    moveBucketToArea,
    renameArea,
    renameBucket,
    setAreaColor,
    setBucketColor,
  } = useTaskCommands();
  const allAreas = useTasksSelector((d) => d.areas);
  const driftCountByBucket = useDriftCountByBucket();
  const openTaskCountByBucket = useTasksSelector((d) => d.openTaskCountByBucket);
  const queueCount = useTasksSelector((d) => d.queueCount);

  const left = (
    <BucketRail
      selection={selection}
      onSelect={setSelection}
      buckets={buckets}
      areas={allAreas}
      inbox={inbox}
      openCountByBucket={openTaskCountByBucket}
      driftCountByBucket={driftCountByBucket}
      totalOpenCount={totalOpenCount}
      queueCount={queueCount}
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
      onCreateBucket={(name, areaId) => createBucket(name, { areaId })}
      onRenameBucket={renameBucket}
      onRequestDelete={(bucket) => setProjectDialog({ kind: "delete", bucket, open: true })}
      onRequestArchive={requestArchive}
      onSetBucketColor={setBucketColor}
      projectOrder={projectOrder}
      onMoveBucket={moveProject}
      onMoveBucketToArea={moveBucketToArea}
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
      onCreateArea={createArea}
      onRenameArea={renameArea}
      onSetAreaColor={setAreaColor}
      onMoveArea={moveArea}
      onDeleteArea={deleteArea}
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
  return left;
}
