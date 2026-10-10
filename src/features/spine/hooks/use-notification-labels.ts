// Names for task notices whose event carried no title (a comment's notice has
// only an excerpt), so every task card names its task (TV-P0, tasks-v3 AC1.7).
// Looked up in the entity registry, which only answers for items you can see;
// TV-D8 registers every task at creation, so the lookup then always finds it.

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import { type NotificationGroup, unnamedTaskTargets } from "../notifications";

const NO_LABELS: ReadonlyMap<string, string> = new Map();

export function useNotificationLabels(groups: NotificationGroup[]): ReadonlyMap<string, string> {
  const { runtime } = useAuth();
  const { selectedWorkspaceId } = useWorkspace();
  // A stable key, so a re-render with the same cards doesn't look them up again.
  const key = useMemo(() => unnamedTaskTargets(groups).sort().join(","), [groups]);
  const [labels, setLabels] = useState<ReadonlyMap<string, string>>(NO_LABELS);

  useEffect(() => {
    if (!runtime || !selectedWorkspaceId || !key) return;
    let cancelled = false;
    const refs = key.split(",").map((id) => ({ type: "task" as const, id }));
    runtime.spine
      .getEntities({ workspaceId: selectedWorkspaceId, refs })
      .then((records) => {
        if (cancelled) return;
        const named = records.filter((r) => !r.deletedAt && r.label.trim());
        setLabels(new Map(named.map((r) => [r.id, r.label])));
      })
      .catch(() => {
        // Quiet: an unnamed card keeps its plain sentence.
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, selectedWorkspaceId, key]);

  return labels;
}
