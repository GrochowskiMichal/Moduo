// Names for task notices whose event carried no title (a comment's notice has
// only an excerpt), so every task card names its task (TV-P0, tasks-v3 AC1.7).
// Looked up in the entity registry, which only answers for items you can see;
// TV-D8 registers every task at creation, so the lookup then always finds it.

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "../../../providers/auth-provider";
import { useWorkspace } from "../../../providers/workspace-provider";
import {
  type NotificationGroup,
  notificationReferences,
  unnamedTaskTargets,
} from "../notifications";
import { useReferences } from "../references/context";
import { plainReferenceName } from "../references/text";
import type { ReferenceRef } from "../references/types";

const NO_LABELS: ReadonlyMap<string, string> = new Map();

/**
 * Names for the references a card's comment excerpt carries (RF-1): the title
 * when this reader can open the item, "Private item" when they can't, "Deleted
 * task" when it's gone. Read through the reference store, which asks the
 * server per reader (row-level security = can_access): a title the reader may
 * not see never reaches the bell's text.
 */
export function useNotificationReferenceNames(
  groups: NotificationGroup[],
): (ref: ReferenceRef) => string {
  const refs = useMemo(() => notificationReferences(groups), [groups]);
  const stateOf = useReferences(refs);
  return useMemo(() => (ref: ReferenceRef) => plainReferenceName(ref, stateOf(ref)), [stateOf]);
}

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
