// The plan view's dialogs: statuses, delete/archive/done, drift triage,
// templates, import, views, the frontier offer and the welcome.

import { restoreNavFocus } from "../../../../components/ui/nav-row";
import { projectDeleteSummary, projectOpenWork } from "../../sidebar";
import { useTaskCommands, useTasksSelector, useTasksUserId } from "../../tasks-context";
import { ArchiveProjectDialog, DeleteBucketDialog } from "../delete-bucket-dialog";
import { DriftTriageDialog } from "../drift-triage-dialog";
import { FrontierOfferDialog } from "../frontier-offer-dialog";
import { StatusesDialog } from "../statuses-dialog";
import { TasksWelcomeDialog } from "../tasks-welcome-dialog";
import type { PlanController } from "./use-tasks-plan-controller";

export function PlanDialogs({ c }: { c: PlanController }) {
  const {
    canEdit,
    buckets,
    tasks,
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
  const {
    addToQueue,
    archiveBucket,
    archiveTask,
    createStatus,
    deleteBucket,
    deleteStatus,
    rescheduleScheduledAt,
    setProjectState,
    unscheduleTask,
    updateStatus,
  } = useTaskCommands();
  const archivedTasks = useTasksSelector((d) => d.archivedTasks);
  const moduleUserId = useTasksUserId();
  const statuses = useTasksSelector((d) => d.statuses);
  return (
    <>
      {upcoming.dialogs}
      {inboxView.dialogs}
      {bulk.dialogs}
      <StatusesDialog
        open={statusesEditor !== null}
        projectName={statusesEditor?.projectId ? bucketNameById(statusesEditor.projectId) : null}
        statuses={statuses.filter((s) => s.projectId === (statusesEditor?.projectId ?? null))}
        canEdit={canEdit}
        addingTo={statusesEditor?.addingTo ?? null}
        onCreate={(category, name) =>
          createStatus(statusesEditor?.projectId ?? null, category, name)
        }
        onUpdate={updateStatus}
        onDelete={deleteStatus}
        onClose={() => setStatusesEditor(null)}
      />
      <DeleteBucketDialog
        bucket={projectDialog?.kind === "delete" ? projectDialog.bucket : null}
        open={projectDialog?.kind === "delete" && projectDialog.open}
        summary={
          projectDialog
            ? projectDeleteSummary(
                [...tasks, ...archivedTasks],
                projectDialog.bucket.id,
                moduleUserId,
              )
            : { moving: 0, toYou: 0, finished: 0 }
        }
        checkAccess={checkProjectAccess}
        onConfirm={(bucket) => {
          // Pinned shows live projects only: a deleted one leaves it, a
          // refused delete or a Restore keeps (or brings back) its pin.
          deleteBucket(bucket.id);
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
        openCount={projectDialog ? projectOpenWork(tasks, projectDialog.bucket.id).open.length : 0}
        projects={buckets}
        onConfirm={(bucket, openTasks) => setProjectState(bucket.id, "done", openTasks)}
        onClose={() => setProjectDialog((prev) => (prev ? { ...prev, open: false } : prev))}
      />
      <ArchiveProjectDialog
        bucket={projectDialog?.kind === "archive" ? projectDialog.bucket : null}
        open={projectDialog?.kind === "archive" && projectDialog.open}
        openCount={projectDialog ? projectOpenWork(tasks, projectDialog.bucket.id).open.length : 0}
        projects={buckets}
        checkAccess={checkProjectAccess}
        onConfirm={(bucket, openTasks) => {
          archiveBucket(bucket.id, openTasks);
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
        onReschedule={(id, days) => rescheduleScheduledAt(id, days)}
        onArchive={archiveTask}
        onIgnore={unscheduleTask}
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
        onQueueTask={addToQueue}
        onQueueAnyway={() => {
          if (frontierOfferTaskId) addToQueue(frontierOfferTaskId);
        }}
      />
      <TasksWelcomeDialog welcome={welcome} />
    </>
  );
}
