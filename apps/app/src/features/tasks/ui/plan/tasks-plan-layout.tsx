// The plan view's layout: the reference host, one DnD context across the
// rail, centre and panel, and the dialogs. Draws what the controller holds.

import { useLayoutEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import { FeaturePanelsShell } from "../../../../components/app/feature-panels-shell";
import { truncationNotice } from "../../../../components/app/truncation-notice";
import { type ReferenceHost, ReferenceHostProvider } from "../../../spine/references/context";
import { referenceKey } from "../../../spine/references/kinds";
import type { ReferenceRef } from "../../../spine/references/types";
import { TaskCommandsOverride } from "../../tasks-context";

import { PlanBody } from "./plan-body";
import { PlanDialogs } from "./plan-dialogs";
import { PlanDndHost } from "./plan-dnd-host";
import { PlanPanels } from "./plan-panels";
import { PlanRail } from "./plan-rail";
import type { PlanController } from "./use-tasks-plan-controller";

export function TasksPlanLayout({ c }: { c: PlanController }) {
  const { api, viewApi, canEdit, inbox, referenceStore, taskById, selectedTask, pushPanel } = c;
  // The detail panel reads its commands from context (A4): here queuing goes
  // through the blocked-by offer and "Focus on this" says where it went, as
  // everywhere else on the page (`viewApi`). One object for the page's life,
  // calling the newest `viewApi`, so the commands keep their identity.
  const latestViewApi = useRef(viewApi);
  useLayoutEffect(() => {
    latestViewApi.current = viewApi;
  });
  const pageCommands = useMemo(
    () => ({
      toggleQueue: (id: string) => latestViewApi.current.toggleQueue(id),
      focusOnTask: (id: string) => latestViewApi.current.focusOnTask(id),
    }),
    [],
  );
  const latestForHost = useRef({ taskById, selectedTask, inbox, api });
  useLayoutEffect(() => {
    latestForHost.current = { taskById, selectedTask, inbox, api };
  });
  // What references on this page can do: open in the panel, complete a task
  // through the module (so the live gate and Undo see it), and create a task
  // for `/` in a description ("New task “…”", filed with the open task).
  const referenceHost = useMemo<ReferenceHost>(
    () => ({
      openInPanel: (ref: ReferenceRef) =>
        pushPanel({ key: referenceKey(ref), type: ref.type, id: ref.id }),
      setTaskDone: (taskId: string, done: boolean) => {
        const { taskById: byId, api: moduleApi } = latestForHost.current;
        if (byId.has(taskId)) {
          // Done through the module's check-off, so its open subtasks finish
          // too (call 87).
          if (done) moduleApi.markDone(taskId);
          else moduleApi.patchTask(taskId, { status: "todo" });
          return;
        }
        referenceStore?.completeTask(taskId, done).catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Couldn’t change the task.");
        });
      },
      createEntity: async (type: string, title: string) => {
        if (type !== "task") return null;
        const { selectedTask: open, inbox: myInbox, api: moduleApi } = latestForHost.current;
        const bucketId = open?.bucketId ?? myInbox?.id;
        if (!bucketId) return null;
        const saved = await moduleApi.createTask({ bucketId, title });
        return saved ? { type: "task", id: saved.id } : null;
      },
      canEditTasks: canEdit,
    }),
    [pushPanel, referenceStore, canEdit],
  );

  return (
    <TaskCommandsOverride commands={pageCommands}>
      <ReferenceHostProvider host={referenceHost}>
        <PlanDndHost c={c}>
          <FeaturePanelsShell
            feature="tasks"
            notice={truncationNotice(api.truncated)}
            left={<PlanRail c={c} />}
            center={<PlanBody c={c} />}
            right={<PlanPanels c={c} />}
          />
        </PlanDndHost>
        <PlanDialogs c={c} />
      </ReferenceHostProvider>
    </TaskCommandsOverride>
  );
}
