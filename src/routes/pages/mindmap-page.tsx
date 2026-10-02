import { MindmapWorkspace } from "../../features/mindmap/ui/mindmap-workspace";
import { useAuth } from "../../providers/auth-provider";
import { useWorkspace } from "../../providers/workspace-provider";

export function MindmapPage() {
  const { selectedWorkspaceId } = useWorkspace();
  const { runtime } = useAuth();

  if (!selectedWorkspaceId || !runtime) {
    return null;
  }

  return <MindmapWorkspace workspaceId={selectedWorkspaceId} runtime={runtime} />;
}
