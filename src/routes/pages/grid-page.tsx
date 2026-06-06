import { useMemo } from "react";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";
import { FeaturePanelsShell } from "../../components/app/feature-panels-shell";
import { useNotes } from "../../features/notes/hooks/use-notes";
import { GridWorkspace } from "../../features/dashboard/ui/grid-workspace";

export function GridPage() {
  const { runtime, userId, configError } = useAuth();
  const { selectedWorkspaceId, modulePermissions } = useWorkspace();

  const notesState = useNotes(runtime, {
    userId,
    workspaceId: selectedWorkspaceId,
    modulePermission: modulePermissions.notes,
  });

  const canRender = useMemo(
    () => !!runtime && !!userId && !!selectedWorkspaceId && !configError,
    [configError, runtime, selectedWorkspaceId, userId]
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="grid"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-[#d4d8e1]">
            <h2>Grid unavailable</h2>
            <p>{configError ?? "Authentication, workspace, or desktop runtime is missing."}</p>
          </div>
        }
      />
    );
  }

  return (
    <GridWorkspace
      runtime={runtime}
      workspaceId={selectedWorkspaceId!}
      notes={notesState.notes}
    />
  );
}
