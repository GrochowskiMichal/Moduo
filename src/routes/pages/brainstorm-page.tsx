import { BrainstormWorkspace } from "../../features/brainstorm/ui/brainstorm-workspace";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

export function BrainstormPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const { runtime } = useAuth();

  if (!selectedWorkspaceId || !runtime) {
    return null;
  }

  return <BrainstormWorkspace workspaceId={selectedWorkspaceId} runtime={runtime} />;
}
