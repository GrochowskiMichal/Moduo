import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { useTasksModule } from "../../features/tasks/hooks/use-tasks-module";
import type { TasksSearch } from "../../features/tasks/search";
import { TasksPlanView } from "../../features/tasks/ui/tasks-plan-view";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

export function TasksPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();

  // URL-held task selection (DF-1) — deep links, refresh, and back/forward all
  // resolve to a concrete task. The router coupling stays here so the plan view
  // remains a pure component. Selection writes always `replace`: it's a list
  // cursor (j/k moves it constantly), not a document — back should leave
  // /tasks, not walk the cursor history. The functional updater guards any
  // future /tasks params (an object `search` replaces the whole query string —
  // the gotcha that bit FX-1); today `id` is the only validated param.
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as TasksSearch;
  const urlTaskId = search.id ?? null;
  const onUrlTaskIdChange = useCallback(
    (id: string | null) => {
      void navigate({
        to: "/tasks",
        replace: true,
        search: (prev: Record<string, unknown>) => {
          const next = { ...prev };
          if (id) next.id = id;
          else delete next.id;
          return next;
        },
      });
    },
    [navigate],
  );

  const api = useTasksModule(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.tasks,
    // Recently deleted opens from the Tasks sidebar's ⋯ only (TV-U6).
    includeTrash: true,
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

  return (
    <TasksPlanView
      api={api}
      workspaceId={selectedWorkspaceId as string}
      runtime={runtime}
      urlTaskId={urlTaskId}
      onUrlTaskIdChange={onUrlTaskIdChange}
    />
  );
}
