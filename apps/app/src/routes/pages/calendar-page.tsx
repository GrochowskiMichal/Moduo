import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import type { CalendarSearch } from "../../features/calendar/search";
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

  // `?event=` deep link (DF-2). Consume-once command: the page navigates to the
  // event's day + selects + opens detail, then clears the param (the anchor day
  // persists per-device, so nothing is lost). Cleared with `replace` — the deep
  // link is a jump, not a history step to walk back through.
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as CalendarSearch;
  const urlEventId = search.event ?? null;
  const clearEventParam = useCallback(() => {
    void navigate({
      to: "/calendar",
      replace: true,
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev };
        delete next.event;
        return next;
      },
    });
  }, [navigate]);

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
      modulePermissions.calendar !== "none",
    [configError, modulePermissions.calendar, runtime, selectedWorkspaceId, userId],
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="calendar"
        hideRight
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-muted-foreground">
            <h2 className="font-display text-2xl text-foreground">Calendar unavailable</h2>
            <p className="text-sm">
              {configError ??
                (modulePermissions.calendar === "none"
                  ? "Your role doesn't include Calendar in this workspace."
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
      runtime={runtime}
      userId={userId as string}
      workspaceId={selectedWorkspaceId as string}
      urlEventId={urlEventId}
      onConsumeEventDeepLink={clearEventParam}
    />
  );
}
