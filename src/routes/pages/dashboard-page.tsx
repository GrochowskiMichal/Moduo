import { useMemo } from "react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { useNotes } from "../../features/notes/hooks/use-notes";
import { useTasks } from "../../features/tasks/hooks/use-tasks";
import { DashboardWorkspace } from "../../features/dashboard/ui/dashboard-workspace";

export function DashboardPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();

  const notesState = useNotes(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.notes,
  });

  const tasksState = useTasks(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.tasks,
  });

  const canRender = useMemo(
    () => !!runtime && !!userId && !!selectedWorkspaceId && !configError,
    [configError, runtime, selectedWorkspaceId, userId]
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="dashboard"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-[#d4d8e1]">
            <h2>Dashboard unavailable</h2>
            <p>{configError ?? "Authentication, workspace, or desktop runtime is missing."}</p>
          </div>
        }
      />
    );
  }

  return (
    <DashboardWorkspace
      runtime={runtime}
      workspaceId={selectedWorkspaceId!}
      notes={notesState.notes}
      tasks={tasksState.tasks}
      projects={tasksState.projects}
      states={tasksState.states}
    />
  );
}
