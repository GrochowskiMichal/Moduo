import { useMemo } from "react";
import { useAuth } from "../../src/providers/auth-provider";
import { useWorkspace } from "../../src/providers/workspace-provider";
import { FeaturePanelsShell } from "../../src/components/app/feature-panels-shell";
import { useForms } from "../../src/features/forms/hooks/use-forms";
import { FormsWorkspace } from "../../src/features/forms/ui/forms-workspace";

export default function FormWebScreen() {
  const { supabase, userId, configError } = useAuth();
  const { selectedWorkspace, selectedWorkspaceId } = useWorkspace();

  const canEdit =
    selectedWorkspace?.role === "owner" ||
    selectedWorkspace?.role === "admin" ||
    selectedWorkspace?.role === "editor";

  const state = useForms(supabase, {
    userId,
    workspaceId: selectedWorkspaceId,
    canEdit,
  });

  const canRender = useMemo(
    () => !!supabase && !!selectedWorkspaceId && !configError,
    [configError, selectedWorkspaceId, supabase]
  );

  if (!canRender) {
    return (
      <FeaturePanelsShell
        feature="form"
        center={
          <div className="grid h-full place-content-center gap-2 text-center text-[#d4d8e1]">
            <h2>Forms unavailable</h2>
            <p>{configError ?? "Authentication, workspace, or Supabase connection is missing."}</p>
          </div>
        }
      />
    );
  }

  return <FormsWorkspace state={state} />;
}
