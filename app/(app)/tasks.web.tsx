import { useMemo } from "react";
import { useAuth } from "../../src/providers/auth-provider";
import { useWorkspace } from "../../src/providers/workspace-provider";
import { useTasks } from "../../src/features/tasks/hooks/use-tasks";
import { TasksWorkspace } from "../../src/features/tasks/ui/tasks-workspace";
import { FeaturePanelsShell } from "../../src/components/app/feature-panels-shell";

export default function TasksWebScreen() {
  const { supabase, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();
  const tasksState = useTasks(supabase, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.tasks,
  });

  const canRender = useMemo(
    () => !!supabase && !!userId && !!selectedWorkspaceId && !configError && modulePermissions.tasks !== "none",
    [configError, modulePermissions.tasks, selectedWorkspaceId, supabase, userId]
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
                  : "Authentication, workspace, or Supabase connection is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  return <TasksWorkspace {...tasksState} />;
}
