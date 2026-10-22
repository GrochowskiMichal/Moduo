// The plan view's layout: the reference host, one DnD context across the
// rail, centre and panel, and the dialogs. Draws what the controller holds.

import { useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "sonner";

import { FeaturePanelsShell } from "../../../../components/app/feature-panels-shell";
import { truncationNotice } from "../../../../components/app/truncation-notice";
import { type ReferenceHost, ReferenceHostProvider } from "../../../spine/references/context";
import { referenceKey } from "../../../spine/references/kinds";
import type { ReferenceRef } from "../../../spine/references/types";
import {
  TaskCommandsOverride,
  TasksHeld,
  TasksLagged,
  useLandingLag,
  useTaskCommands,
  useTasksSelector,
} from "../../tasks-context";
import { PlanBody } from "./plan-body";
import { PlanDialogs } from "./plan-dialogs";
import { PlanDndHost } from "./plan-dnd-host";
import { PlanPanels } from "./plan-panels";
import { PlanRail } from "./plan-rail";
import type { PlanController } from "./use-tasks-plan-controller";

export function TasksPlanLayout({ c }: { c: PlanController }) {
  const {
    guardedToggleQueue,
    focusOnTask,
    canEdit,
    inbox,
    referenceStore,
    taskById,
    selectedTask,
    pushPanel,
  } = c;
  const { markDone, patchTask, createTask } = useTaskCommands();
  const truncated = useTasksSelector((d) => d.bundle.truncated);
  // Everything under the page reads its commands from context (A4): here
  // queuing goes through the blocked-by offer and "Focus on this" says where
  // it went. One object for the page's life, calling the newest guards, so
  // the commands keep their identity.
  const latestGuards = useRef({ guardedToggleQueue, focusOnTask });
  useLayoutEffect(() => {
    latestGuards.current = { guardedToggleQueue, focusOnTask };
  });
  const pageCommands = useMemo(
    () => ({
      toggleQueue: (id: string) => latestGuards.current.guardedToggleQueue(id),
      focusOnTask: (id: string) => latestGuards.current.focusOnTask(id),
    }),
    [],
  );
  const latestForHost = useRef({ taskById, selectedTask, inbox });
  useLayoutEffect(() => {
    latestForHost.current = { taskById, selectedTask, inbox };
  });
  // What references on this page can do: open in the panel, complete a task
  // through the module (so the live gate and Undo see it), and create a task
  // for `/` in a description ("New task “…”", filed with the open task).
  const referenceHost = useMemo<ReferenceHost>(
    () => ({
      openInPanel: (ref: ReferenceRef) =>
        pushPanel({ key: referenceKey(ref), type: ref.type, id: ref.id }),
      setTaskDone: (taskId: string, done: boolean) => {
        const { taskById: byId } = latestForHost.current;
        if (byId.has(taskId)) {
          // Done through the module's check-off, so its open subtasks finish
          // too (call 87).
          if (done) markDone(taskId);
          else patchTask(taskId, { status: "todo" });
          return;
        }
        referenceStore?.completeTask(taskId, done).catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Couldn’t change the task.");
        });
      },
      createEntity: async (type: string, title: string) => {
        if (type !== "task") return null;
        const { selectedTask: open, inbox: myInbox } = latestForHost.current;
        const bucketId = open?.bucketId ?? myInbox?.id;
        if (!bucketId) return null;
        const saved = await createTask({ bucketId, title });
        return saved ? { type: "task", id: saved.id } : null;
      },
      canEditTasks: canEdit,
    }),
    [pushPanel, referenceStore, canEdit, markDone, patchTask, createTask],
  );

  // The rail and the panel draw the landing of the data one frame after the
  // centre's rows (TS-R1).
  const { snapshot, hold } = useLandingLag();

  return (
    <TaskCommandsOverride commands={pageCommands}>
      <ReferenceHostProvider host={referenceHost}>
        <PlanDndHost c={c}>
          <FeaturePanelsShell
            feature="tasks"
            notice={truncationNotice(truncated)}
            left={
              <TasksHeld hold={hold}>
                <TasksLagged snapshot={snapshot}>
                  <PlanRail c={c} />
                </TasksLagged>
              </TasksHeld>
            }
            center={<PlanBody c={c} />}
            right={
              <TasksHeld hold={hold}>
                <TasksLagged snapshot={snapshot}>
                  <PlanPanels c={c} />
                </TasksLagged>
              </TasksHeld>
            }
          />
        </PlanDndHost>
        <PlanDialogs c={c} />
      </ReferenceHostProvider>
    </TaskCommandsOverride>
  );
}
