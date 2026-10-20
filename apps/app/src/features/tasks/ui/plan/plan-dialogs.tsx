// The plan view's dialogs: statuses, delete/archive/done, drift triage,
// templates, import, views, the frontier offer and the welcome.

import { restoreNavFocus } from "../../../../components/ui/nav-row";
import { projectDeleteSummary, projectOpenWork } from "../../sidebar";
import { ArchiveProjectDialog, DeleteBucketDialog } from "../delete-bucket-dialog";
import { DriftTriageDialog } from "../drift-triage-dialog";
import { FrontierOfferDialog } from "../frontier-offer-dialog";
import { StatusesDialog } from "../statuses-dialog";
import { TasksWelcomeDialog } from "../tasks-welcome-dialog";

import type { PlanController } from "./use-tasks-plan-controller";

export function PlanDialogs({ c }: { c: PlanController }) {
  const {
    api,
    canEdit,
    buckets,
    projectDialog,
    setProjectDialog,
    triageBucketId,
    setTriageBucketId,
    statusesEditor,
    setStatusesEditor,
    railNavRef,
    triageFromRef,
    frontierOfferTaskId,
    setFrontierOfferTaskId,
    setSelection,
    welcome,
    place,
    bucketNameById,
    upcoming,
    inboxView,
    bulk,
    savedViews,
    driftTasks,
    frontierOfferTask,
    frontierOffer,
    checkProjectAccess,
    templateActions,
    taskImport,
  } = c;
  return (
    <>
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
    </>
  );
}
