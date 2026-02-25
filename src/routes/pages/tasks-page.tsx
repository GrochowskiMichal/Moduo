import { useMemo } from "react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { useTasks } from "../../features/tasks/hooks/use-tasks";
import { TasksWorkspace } from "../../features/tasks/ui/tasks-workspace";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";

export function TasksPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const tasksState = useTasks(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.tasks,
  });

  const canRender = useMemo(
    () => !!runtime && !!userId && !!selectedWorkspaceId && !configError && modulePermissions.tasks !== "none",
    [configError, modulePermissions.tasks, runtime, selectedWorkspaceId, userId]
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="tasks"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-[#d4d8e1]">
            <h2>Tasks unavailable</h2>
            <p>
              {configError ??
                (modulePermissions.tasks === "none"
                  ? "You do not have Tasks access in this workspace."
                  : "Authentication, workspace, or desktop runtime is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  return <TasksWorkspace {...tasksState} />;
}
