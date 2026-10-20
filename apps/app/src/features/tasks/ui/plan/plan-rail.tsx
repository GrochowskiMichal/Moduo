// The plan view's left rail: the sidebar's places, wired to the controller.

import { dispatchOpenCapture } from "../../../../components/app/capture-shell";
import { BucketRail } from "../bucket-rail";

import type { PlanController } from "./use-tasks-plan-controller";

export function PlanRail({ c }: { c: PlanController }) {
  const {
    api,
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

  const left = (
    <BucketRail
      selection={selection}
      onSelect={setSelection}
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
      projectOrder={projectOrder}
      onMoveBucket={moveProject}
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
