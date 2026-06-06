import { useMemo } from "react";

import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { useTasksModule } from "../../features/tasks/hooks/use-tasks-module";
import { TasksPlanView } from "../../features/tasks/ui/tasks-plan-view";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

export function TasksPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();

  const api = useTasksModule(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.tasks,
  });

  const canRender = useMemo(
    () =>
      !!runtime &&
      !!userId &&
      !!selectedWorkspaceId &&
      !configError &&
      modulePermissions.tasks !== "none",
    [configError, modulePermissions.tasks, runtime, selectedWorkspaceId, userId],
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="tasks"
        hideRight
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <h2 className="font-display text-2xl text-foreground">Tasks unavailable</h2>
            <p className="text-sm">
              {configError ??
                (modulePermissions.tasks === "none"
                  ? "You do not have Tasks access in this workspace."
                  : "Authentication, workspace, or runtime is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  return <TasksPlanView api={api} workspaceId={selectedWorkspaceId as string} />;
}
