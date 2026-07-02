import { useMemo } from "react";

import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { CalendarPageView } from "../../features/calendar/ui/calendar-page-view";
import { useTasksModule } from "../../features/tasks/hooks/use-tasks-module";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

// Calendar rides the Tasks permission lane at alpha (specs/calendar.md,
// assumption 3 — the same call CT-1/CO-1 made): the grid is a lens on tasks,
// and native-event tables reuse the lane server-side.
export function CalendarPage() {
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
        feature="calendar"
        hideRight
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <h2 className="font-display text-2xl text-foreground">
              Calendar unavailable
            </h2>
            <p className="text-sm">
              {configError ??
                (modulePermissions.tasks === "none"
                  ? "You do not have Calendar access in this workspace."
                  : "Authentication, workspace, or runtime is missing.")}
            </p>
          </div>
        }
      />
    );
  }

  return (
    <CalendarPageView
      api={api}
      userId={userId as string}
      workspaceId={selectedWorkspaceId as string}
    />
  );
}
